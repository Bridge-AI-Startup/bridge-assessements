# Bridge capture kit (experimental)

Hooks-first capture of a candidate's AI-collaboration workflow — the alternative
to screen recording. The candidate works in **their own environment** with
**their own AI tool subscription**; we capture the conversation and the code,
not the desktop.

Status: **prototype.** Claude Code only. Server routes are off unless
`WORKFLOW_CAPTURE_ENABLED=true`.

## Why hooks and not a proxy

A proxy (`ANTHROPIC_BASE_URL` pointed at us) yields unforgeable server-side
truth, but it puts us in the critical path of someone else's machine and means
handling their API keys. Hooks invert both: nothing about their setup changes
except one config file inside the assessment repo, they keep their own
subscription and model choice, and a capture outage never blocks their work.

The tradeoff is that hooks are removable — a candidate *can* delete
`.claude/settings.json`. That is acceptable here: in a consented, identified
hiring context, a stripped or truncated record is itself visible to the
reviewer. We optimise for a cooperative candidate, not an adversarial one.

## Live tester (fastest way to see it work)

First put the flag in `server/config.env` (not just inline on one command — an
already-running dev server will not have it, and every `/api/workflow-capture`
route including the tester 404s without it):

```
WORKFLOW_CAPTURE_ENABLED=true
```

Restart the dev server, then open:

```
http://localhost:5050/api/workflow-capture/tester
```

Polls every 2s and shows the timeline, stats, code state, **and a screen
recording synced to the timeline**. Click any event and the player jumps to that
moment. Dev-only — not mounted when `NODE_ENV=production`.

Order of operations: click **Start screen recording** first (the recording's
start instant is the sync origin), then run setup and work in Claude Code, then
stop recording. Events that happened outside the recording window show `—`
instead of a video offset — they are real events, there is just no footage of
them.

### How the sync works

`video.startedAt` is recorded server-side when recording begins; an event's
position is simply `event.at − video.startedAt`. Nothing about the video is
analysed — no frames, no OCR, no vision model. The video is there so a human can
*watch* the moment; all the analysis comes from the hook stream.

Chunks are merged and **remuxed through ffmpeg** on first playback, then cached.
The remux is not optional: raw concatenated MediaRecorder output plays but is not
seekable, which would defeat the entire point of a clickable timeline.

## Try it locally in 3 commands

```bash
# 1. terminal one — server (needs WORKFLOW_CAPTURE_ENABLED=true in config.env)
cd server && npm run dev
```

```bash
# 2. terminal two — any scratch git repo
node /path/to/bridge-assessements/capture-kit/setup.js --local
```

```bash
# 3. work normally, then read your own record back
claude
node .bridge/view.js
```

`--local` targets `http://localhost:$PORT` and creates a session not linked to
any assessment. `view.js` prints the timeline plus which files were
agent-written vs hand-written. Add `--full` for untruncated text, `--json` for raw.

## Candidate flow

```bash
node capture-kit/setup.js <submission-token>   # discloses, asks consent, wires hooks
claude                                          # work normally; trust the folder when asked
```

`setup.js` writes:

| Path | Purpose |
|---|---|
| `.bridge/config.json` | API base + capture token (gitignored) |
| `.bridge/bridge-capture.js` | the hook script Claude Code invokes |
| `.bridge/sent.jsonl` | **local mirror of everything sent** — candidate-readable |
| `.bridge/queue.jsonl` | offline queue, flushed on the next hook |
| `.claude/settings.json` | the hooks themselves; delete to stop capturing |

Claude Code's **workspace-trust prompt** on first launch is what actually
activates project hooks. That prompt is a feature, not an obstacle: it is the
candidate re-confirming consent at the tool boundary, in the tool's own UI.

## What gets captured

| Hook | Event | Carries |
|---|---|---|
| `SessionStart` / `SessionEnd` | `session_start` / `session_end` | session boundaries |
| `UserPromptSubmit` | `user_prompt` | the candidate's prompt, verbatim |
| `PreToolUse` | `tool_use` | tool name + full input (for `Write`, the file contents) |
| `PostToolUse` | `tool_result` | command output, test results, errors |
| `Stop` | `assistant_message` | the assistant's reply |

On `Stop` the kit also posts a **git-derived snapshot** of changed files, which
catches work the agent never touched — hand edits, terminal-driven changes.
That is why code state stays accurate even when the candidate stops using the
agent entirely.

## Design rules for the hook script

The script runs inside someone else's editing loop, so it is written defensively:

1. **Always `exit 0`.** A capture failure must never fail their turn.
2. **One short-timeout request** (4s), then done — no blocking their session.
3. **Offline-safe.** Failed sends stay in `queue.jsonl` and flush on the next hook.
4. **Idempotent.** Events carry a monotonic `seq`; the server dedupes on
   `(sessionId, seq)`, so retries can never double-insert.
5. **Transparent.** Everything sent is mirrored to `.bridge/sent.jsonl`.
6. **Self-excluding.** `.bridge/` is skipped by the snapshot — we never send our
   own queue back as if it were candidate code.
7. **Never uploads secrets.** The snapshot skips `.env*`, keys/certs
   (`*.pem`, `*.key`, `id_rsa*`), lockfiles, logs, and anything that sniffs as
   binary. Capture is consented for their *work*, not their credentials — a
   candidate's `.env` holds their own API keys and must never reach our server.

## Server API

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/workflow-capture/sessions` | none | create session; **requires `consentGranted: true`** |
| `POST /api/workflow-capture/events` | Bearer capture token | batch ingest (idempotent) |
| `POST /api/workflow-capture/snapshot` | Bearer capture token | changed-file snapshot |
| `POST /api/workflow-capture/complete` | Bearer capture token | close the session |
| `GET /api/workflow-capture/agent-context` | `X-Agent-Secret` | **live** context for the interviewer agent |
| `GET /api/workflow-capture/sessions/:id` | Firebase auth | full timeline for employer review |

`agent-context` is the real-time read path: recent conversation in chronological
order plus current code state, so the voice interviewer can ask about what the
candidate just did while they are still doing it.

## Turning it on

Two switches, both required:

1. **Server:** `WORKFLOW_CAPTURE_ENABLED=true` (master switch; off by default).
2. **Per assessment:** the *How we observe the session* setting in the editor —
   `Screen recording` (default, unchanged), `Workflow capture`, or `Both`.

The master switch always wins downward: an assessment set to workflow capture on
a deployment where it is disabled falls back to screen recording rather than
collecting nothing. Existing assessments are untouched — they have no
`evidenceMode` field and resolve to `screen`.

## Video + timeline sync ("Both" mode)

`Both` keeps the screen recording for human playback but **skips the AI video
transcript entirely** — no frame extraction, no OCR, no Gemini pass. The
analysis comes from the hook stream instead, which is both richer and ~$3–22
cheaper per session.

The two records align on wall-clock time, so `GET /sessions/:id` stamps each
event with `videoOffsetSeconds` — its position in the recording. A reviewer can
click a prompt in the timeline and seek the player to the moment it happened.
Events outside the recording window (agent started before screen consent, work
continued after it stopped) get `null` rather than a bogus seek target, and the
response carries a `video` block with the merged recording's status and duration.

## Other AI tools

`setup.js` installs adapters for all three into `.bridge/`. Claude Code streams
live; Codex and Cursor are imported from the stores those tools already keep.

| Tool | Mechanism | Live? | Command |
|---|---|---|---|
| **Claude Code** | hooks (`.claude/settings.json`) | ✅ real time | automatic |
| **Codex CLI** | reads `~/.codex/sessions/**/rollout-*.jsonl` | on import | `node .bridge/codex-adapter.js` |
| **Cursor** | reads `state.vscdb` (SQLite) | on import | `node .bridge/cursor-adapter.js` |

Both adapters support `--probe` (report what's there, **send nothing**) and
`--watch` (poll while you work, so it feels live).

### Codex

Verified against real rollout files (Aug 2026). Each record is
`{timestamp, type, payload}`; the conversation lives in `response_item` records
with `payload.role` of user/assistant. We read only those — `event_msg` records
duplicate the same messages and would double every turn. `developer`-role
records are injected system context, not the candidate, and are skipped.

**Only rollouts whose recorded `cwd` matches the current folder are imported**,
so running the adapter never uploads unrelated Codex work from other projects.

`setup.js` also writes `.codex/hooks.json` for live capture, but that schema is
**unverified** — Codex's repo-local hooks are trust-gated and we could not
confirm the format against a running install. The file-based adapter does not
depend on it. Check with `/hooks` inside Codex; if the hooks fire, live capture
works too, and if they do not, the adapter still gets everything.

### Cursor

Schema confirmed on a real install: `cursorDiskKV` holds `bubbleId:*` (one row
per message) and `composerData:*` (per session). Cursor has no hooks and routes
its model traffic through its own backend, so this store is the only capture
surface — and it is **reverse-engineered**, having already changed key names
between Cursor 2.6 and 3.0. Always run `--probe` after a Cursor update: it
reports whether the expected keys are still present, and extraction degrades to
returning nothing (falling back to the git snapshot) rather than corrupting the
timeline.

**Project scoping is the important part.** Cursor keeps every conversation from
every project in one global database. The adapter finds this folder's workspace
via `workspaceStorage/<hash>/workspace.json`, looks up that workspace's
conversations in `composerHeaders`, and reads **only those** — on a real install
that was 222 of 517 conversations, with the other 295 never touched. If no
workspace matches this folder it imports nothing, rather than falling back to
"recent messages" and hoovering up unrelated work.

The store is opened **read-only** (`file:…?mode=ro`) so a running Cursor is
unaffected and the candidate's database can never be written or locked. Reading
in place also matters for speed: the store is multi-gigabyte, and copying it
first took 43s versus 0.02s read-only. A copy is still used as a fallback if the
read-only open is refused.

## Known gaps

- **Claude Code only.** Codex, Gemini CLI, Aider, and Continue all have
  equivalent hook/telemetry surfaces and are straightforward ports. Cursor,
  Windsurf, and Amp route through vendor backends and cannot be captured this
  way at all — those candidates need the screen-recording path.
- `Edit`/`MultiEdit` carry only a diff, so file contents for those come from the
  next snapshot rather than the event itself.
- The offline queue is not concurrency-locked; two hooks firing in the same
  millisecond could re-send an event (harmless — ingest is idempotent).
- No UI yet. The captured timeline is API-only.
