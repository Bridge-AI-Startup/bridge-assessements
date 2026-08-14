# Post-Submission Runtime Setup ("Railway-esque") — Implementation Plan

Status: proposal / not yet built
Owner: TBD
Last updated: 2026-08-12

## 1. Goal

After a candidate submits their code, give them a **persistent, resumable "runtime setup" phase** where they configure how their project runs (install / build / start / port / env), press **Run**, and watch it come up live in an isolated sandbox. They have effectively unlimited wall-clock time — they can close the tab and come back until they explicitly **Finalize setup**.

The output is a **saved, deterministic runtime config + a verified-runnable code snapshot**. Recruiters later replay that exact config in a fresh sandbox to run the project themselves — no README-guessing, no "works on my machine."

This replaces the auto-planner guesswork (`behavioralGrading/planner.ts`) with candidate-authored, verified config, while reusing almost all of the existing execution machinery.

## 2. Why this is mostly reuse

The engine that runs projects already exists in the behavioral grader:

- `submissionCode/snapshot.ts` + `storage.ts` — load the candidate's submitted code (extracted upload archive or GitHub snapshot).
- `e2b/graderSandbox.ts` — create an E2B sandbox (currently always kills it after).
- `behavioralGrading/executor.ts` — run `install` / `build` / `start` steps, compute a `baseUrl`.
- `behavioralGrading/sandboxAppUrl.ts` — discover the port and expose the **E2B public URL**.
- `behavioralGrading/setupHealth.ts` — confirm the app came up.

The **persistent, pausable lifecycle** we need also already exists — in Shorts (`services/shorts/sandbox.ts`, `services/shorts/sessions.ts`): create → pause on idle → resume → snapshot-restore if the box died, with a concurrency cap.

**This feature ≈ grader's executor (run) + Shorts' lifecycle (persist/pause/resume) + a config form + a safety layer.** Little is net-new.

## 3. UX / flow

1. Candidate submits code (existing flow) → submission `status` unchanged (`submitted`), new `runtimeSetup.status = in_progress`.
2. Candidate lands on a new **Runtime Setup** screen (after `CandidateSubmitted`).
3. They fill a Railway/Vercel-style config form (section 5). Config **autosaves** on every change.
4. **Run** → backend loads the snapshot into an E2B sandbox, runs install → build → start, streams logs, and returns the live preview URL. Candidate sees the app in an embedded iframe + a log console + health status.
5. They iterate: edit config, re-run, as many times as they want.
6. They can close the tab at any point. On return, the screen reconnects to a still-warm/paused sandbox, or offers "Start environment" to rebuild from the snapshot. **The config and code are never lost** (persisted in Mongo); only the ephemeral sandbox may need recreating.
7. **Finalize setup** → mark `verified`, persist the final config, tear the sandbox down. Setup phase closes.

"As much time as possible" is achieved by decoupling durability from the sandbox: the *work* (config + snapshot) lives in the DB indefinitely; the *sandbox* is disposable and recreated from the snapshot on demand.

## 4. Data model changes

### Submission (new fields)

```
runtimeConfig: {
  rootDir: string,                 // monorepo subdir, default "."
  runtime: enum,                   // "node20" | "python312" | "auto" | ...  (maps to base image)
  installCommand: string,          // e.g. "npm ci" / "pip install -r requirements.txt"
  buildCommand: string | null,     // optional
  startCommand: string,            // e.g. "npm run start" / "uvicorn app:app --port $PORT"
  port: number | null,             // app listen port; null => health-based discovery
  healthPath: string | null,       // e.g. "/health"
  executionProfile: enum,          // "server" | "script" | "build-only"  (reuse schema.ts enum)
  envVars: [{ key, value, secret: bool }],
  declaredEgressDomains: string[], // domains the app legitimately needs at runtime (see safety)
}
runtimeSetup: {
  status: enum,                    // "not_started" | "in_progress" | "finalized"
  verified: bool,                  // last run reached healthy/started
  lastRunAt: Date,
  lastRunResult: { ok, exitCode, error, startedAt, endedAt },
  finalizedAt: Date | null,
  snapshotSha256: string,          // hash of the code the config was verified against (integrity)
}
```

### New model: RuntimeSetupSession (mirrors PlayBuildSession)

Tracks the ephemeral sandbox so a tab reload can reconnect:

```
submissionId (indexed), token,
e2bSandboxId | null, status ("provisioning"|"running"|"paused"|"dead"),
port, previewUrl, logsKey (storage), startedAt, lastActiveAt, pausedAt,
cpu, memMiB, error
```

Sessions are ephemeral/derived; the durable record is `Submission.runtimeConfig` + the stored snapshot.

## 5. Runtime config form (candidate-facing)

Mirrors Railway/Render service config. Prefill from the existing auto-planner (`planner.ts`) as a starting guess the candidate corrects:

- Root directory (monorepo support)
- Runtime / base image (or auto-detect)
- Install command
- Build command (optional)
- Start command
- Port (or "detect from health check")
- Health check path (optional)
- Environment variables (key/value; per-row **secret** toggle → write-only)
- Declared outbound domains the app needs at runtime (optional; drives egress allowlist)

## 6. Backend service + endpoints

New service `services/runtimeSetup/` that forks the grader's executor into a **persistent** run (does not kill), applies the candidate's `runtimeConfig` instead of a planned runbook, streams logs, and manages pause/resume like Shorts.

Candidate endpoints (token-based, no auth — same pattern as other candidate submission routes):

- `PUT  /api/submissions/token/:token/runtime/config` — autosave config
- `POST /api/submissions/token/:token/runtime/session` — create or resume the setup session (loads snapshot into a sandbox; reconnects paused/running box; recreates from snapshot if dead)
- `POST /api/submissions/token/:token/runtime/run` — apply config → install → build → start; returns previewUrl; begins log stream
- `GET  /api/submissions/token/:token/runtime/status` — session state + previewUrl + health + last run result
- `GET  /api/submissions/token/:token/runtime/logs` — stream/poll build+runtime logs (SSE or chunked poll)
- `POST /api/submissions/token/:token/runtime/pause` / `.../resume`
- `POST /api/submissions/token/:token/runtime/finalize` — persist config, mark verified, tear down sandbox

Recruiter side (later): `POST /api/submissions/:submissionId/runtime/preview` runs the **finalized** config in a fresh sandbox from the stored snapshot (deterministic replay; never reuses the candidate's box).

## 7. Lifecycle & cost control (the "unlimited time" trick)

- Config + snapshot persist in Mongo indefinitely → the window is effectively open until Finalize (or, optionally, the assessment's review deadline).
- The E2B sandbox is disposable:
  - **Idle → pause** after `RUNTIME_SETUP_IDLE_PAUSE_MS` (e.g. 3–5 min). E2B pause snapshots the FS to storage and **stops compute billing** — you pay only cheap storage while paused.
  - **Longer idle / TTL → kill.** On return, resume the paused box, or recreate from the snapshot.
- Concurrency cap (`RUNTIME_SETUP_MAX_CONCURRENT`) + per-candidate run rate limit, reusing the `BEHAVIORAL_GRADING_MAX_CONCURRENT` / `SHORTS_MAX_CONCURRENT_SESSIONS` patterns.
- A reaper job kills orphaned sandboxes (cost + safety).

Cost note: install time dominates a run (~1–3¢ each at 2 vCPU/4 GiB); a warm preview is ~$0.166/hr, but pause-on-idle keeps real spend near zero between interactions.

## 8. Safety (running arbitrary candidate code — pip installs, scripts, servers)

This is the crux of the request. Candidate code is untrusted; assume hostile.

### 8.1 Isolation (foundation)
- Run **only** inside E2B (Firecracker microVMs, per-sandbox isolation, ephemeral). **Never** run candidate install/start commands on the app host, CI, or a shared container.
- One sandbox per submission session. No shared volumes, no host mounts.
- Keep platform secrets OUT of the sandbox (the grader already does this — the E2B key and DB creds are never written in). Maintain that invariant.

### 8.2 Network egress (recommended policy)
E2B now supports `allowInternetAccess`, allow/deny egress lists (IP/CIDR), and **`updateNetwork` to change rules on a running sandbox without restart**. Use a two-phase policy:

- **Install/build phase:** internet ON (allow egress). Registry CDNs (npm/PyPI/apt) resolve to broad, shifting IP ranges, so an IP allowlist for registries is brittle — instead allow general egress **only during this timeboxed phase**, under tight timeouts.
- **Runtime/preview phase:** before `start`, call `updateNetwork` to **deny all egress (0.0.0.0/0)** except any domains the candidate explicitly **declared** the app needs (`declaredEgressDomains`, surfaced to the recruiter). This blocks data exfil, crypto-mining C2, and SSRF-to-metadata while the app is publicly reachable.
- Optional hardening: force all egress through a filtering **proxy with a domain allowlist** (more robust than IP rules) if registry-scoped install-phase filtering is ever required.

### 8.3 Resource limits
- CPU/RAM ceilings per sandbox (default 2 vCPU / 4 GiB; cap the max a config can request).
- Disk quota (reuse `SUBMISSION_UPLOAD_MAX_EXTRACTED_*`); refuse oversized snapshots.
- Process/pid limits where available to blunt fork bombs.

### 8.4 Time limits
- `installTimeoutMs`, `buildTimeoutMs`, per-run `runMaxMs`, absolute sandbox TTL, idle auto-pause. Kills runaway loops, miners, and hung installs (executor already threads `timeoutMs`).

### 8.5 Secrets handling
- Env vars flagged `secret` are **write-only** in the UI, never returned by any GET, and **redacted in logs** (scrub values before persisting log chunks).
- Secrets exist only inside the sandbox at runtime; not echoed to preview or status responses.

### 8.6 Preview exposure
- The preview URL is candidate code served on a public E2B host for the session's life. Use unguessable hostnames, keep it live only while the session is active, and **kill on finalize/idle**. Consider a lightweight access gate so a leaked URL isn't world-open indefinitely.

### 8.7 Abuse / quota
- Per-candidate: max concurrent sessions = 1, capped runs per hour, capped total setup sandbox-minutes.
- Global concurrency cap + reaper. Alert on sandboxes exceeding TTL.

### 8.8 Integrity (for downstream recruiter trust)
- Store `snapshotSha256` with the finalized config. Recruiter replay runs the **stored snapshot** in a **fresh** sandbox with the finalized config — never the candidate's still-warm box. Flag if the snapshot the recruiter runs differs from what was verified.

## 9. Frontend

- New candidate route/phase **RuntimeSetup** after `CandidateSubmitted`.
- Components: config form, Run button, embedded preview iframe (E2B public URL), live log console, health/status pill, Save (autosave) + Finalize.
- On mount: `GET status` → reconnect to running/paused session or show "Start environment."
- Heavy reuse of Shorts Build patterns (preview iframe, session polling, waiting/booting card).

## 10. Config / env vars

```
RUNTIME_SETUP_ENABLED=false            # feature gate
RUNTIME_SETUP_MAX_CONCURRENT=3
RUNTIME_SETUP_SANDBOX_TTL_MS=1800000   # 30m hard cap per live sandbox
RUNTIME_SETUP_IDLE_PAUSE_MS=240000     # 4m idle -> pause
RUNTIME_SETUP_INSTALL_TIMEOUT_MS=600000
RUNTIME_SETUP_BUILD_TIMEOUT_MS=600000
RUNTIME_SETUP_RUN_MAX_MS=900000
RUNTIME_SETUP_CPU=2
RUNTIME_SETUP_MEM_MIB=4096
RUNTIME_SETUP_DENY_EGRESS_AT_RUNTIME=true
```

## 11. Milestones

1. **Data model + config autosave** — Submission fields, RuntimeSetupSession model, `PUT config`, resumable state. No run yet.
2. **Run pipeline** — load snapshot → install/build/start in persistent E2B → preview URL + streaming logs (fork of executor).
3. **Lifecycle** — pause/resume, idle reaper, Finalize teardown, tab-reconnect.
4. **Safety hardening** — two-phase egress via `updateNetwork`, resource/time caps, secret redaction, preview scoping, reaper alerts.
5. **Frontend RuntimeSetup phase.**
6. **Recruiter replay** — dashboard "Run project" from finalized config in a fresh sandbox.
7. **Tests** — config validation (unit), E2B integration smoke, and safety tests: install timeout, fork-bomb/mem cap, runtime egress blocked, secret never leaks to GET/logs.

## 12. Open items to verify before build

- E2B pause/resume API specifics and billing-while-paused confirmation.
- Exact `updateNetwork` semantics mid-session (timing relative to the `start` command) and whether a domain-allowlist proxy is needed for install-phase registry scoping.
- Whether the E2B public preview URL can be access-gated, or if we front it with our own proxy.
- Log streaming transport (SSE vs chunked polling) given Render/infra constraints.
```
