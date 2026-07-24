# Bridge Play

Consumer-facing daily build challenge (Wordle-style) that showcases Bridge's thesis: evaluating how well people can build with AI, not Leetcode-style puzzles. This product is **separate** from the hiring assessments app.

## Layout

| Path | Purpose |
|------|---------|
| `play/client/` | Vite React app — **separate Vercel project** |
| `play/challenges/` | Challenge seed JSON files |
| `play/e2b-template/` | Custom E2B image (Claude Code + static preview; no code-server) |
| `server/src/routes/play.ts` | API namespace `/api/play/*` on the **existing Render service** |
| `server/src/models/play/` | Mongo models on `bridge-play` database |
| `server/src/services/play/` | Challenge + session + sandbox helpers |

## Local development

**Terminal 1 — API**

```bash
cd server
# Set PLAY_ENABLED=true in config.env to exercise feature routes beyond /health
npm run dev
```

**Terminal 2 — Play client**

```bash
cd play/client
npm install
npm run dev   # http://localhost:5174
```

**Terminal 3 — Assessments client (unchanged)**

```bash
cd client
npm run dev   # http://localhost:5173
```

**Seed today's challenge**

```bash
cd server
npx tsx src/scripts/seedPlayChallenge.ts ../play/challenges/counter-widget.json
```

The JSON may omit `challengeDate` to default to UTC today. Re-running upserts by `slug`.

**Smoke checks**

```bash
curl http://localhost:5050/api/play/health
# → {"ok":true,"product":"play"}

curl http://localhost:5050/api/play/today
# → challenge JSON (404 if none published for UTC today)
```

**Admin UI**

- Open `http://localhost:5174/Admin` (not linked from public Home nav)
- Sign in with the Bridge Firebase account matching `PLAY_ADMIN_EMAIL`
- Today's challenge is the default editor; expand **Challenge history** to browse past/future days

## Environment variables

### Server (`server/config.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAY_ENABLED` | `false` | Gate feature routes (`/today`, `/admin/*`, `/vote`, etc.). `/health` is always on. |
| `PLAY_DB_NAME` | `bridge-play` | Separate Mongo database on the same Atlas cluster |
| `PLAY_FRONTEND_URL` | — | Production CORS origin (e.g. `https://play.bridge-jobs.com`) |
| `PLAY_ADMIN_EMAIL` | `saaz.m@icloud.com` | Firebase user email allowed to manage challenges |
| `PLAY_E2B_TEMPLATE_ID` | `bridge-play-dev` | E2B custom template name (build via `play/e2b-template`) |
| `PLAY_MAX_CONCURRENT_SESSIONS` | `5` | Soft cap on globally **running** (non-paused) Play sessions |
| `PLAY_BUILD_TIME_LIMIT_MINUTES` | `10` | Wall-clock build window from start (capped by period end); override per challenge via `timeLimitMinutes` |
| `PLAY_CHALLENGE_CADENCE` | `weekly` | `weekly` = one challenge per Mon–Sun UTC week (`challengeDate` = Monday); `daily` = one per UTC day |

### Play client (`play/client/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend base URL without `/api` (default: `http://localhost:5050` in dev) |
| `VITE_FIREBASE_API_KEY` | Same Firebase project as assessments (optional — hardcoded fallback in dev) |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |

## API (Phase A + build sessions)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/play/health` | — | Always on; `{ ok: true, product: "play" }` |
| GET | `/api/play/today` | — | Published challenge for the **current period** (week or day); 404 `no_challenge_today` if none |
| GET | `/api/play/period` | — | `{ cadence, periodKey, periodEndsAt, label }` — switch via `PLAY_CHALLENGE_CADENCE` |
| GET | `/api/play/admin/challenges` | Firebase + admin | List challenges (newest first) |
| GET | `/api/play/admin/challenges/:slug` | Firebase + admin | Single challenge |
| POST | `/api/play/admin/challenges` | Firebase + admin | Create challenge |
| PATCH | `/api/play/admin/challenges/:slug` | Firebase + admin | Update challenge |
| POST | `/api/play/session` | — | Create or resume E2B build session (`{ anonymousId }`). Full: **503** `session_queue` waitlist payload |
| GET | `/api/play/session/:id` | — | Get session (`?anonymousId=`) |
| GET | `/api/play/session/:id/usage` | — | Token meter (`?anonymousId=`) → `{ tokensUsed, tokenBudget, remaining, exhausted }` |
| GET | `/api/play/session/:id/files` | — | List project files for Monaco tree (`?anonymousId=`) |
| GET | `/api/play/session/:id/file` | — | Read one file (`?anonymousId=&path=`) |
| PUT | `/api/play/session/:id/file` | — | Write one file (`{ anonymousId, path, content }`) → E2B |
| POST | `/api/play/session/:id/llm/v1/messages` | Bearer `llmProxyToken` | Anthropic-compatible Messages proxy (Claude Code in E2B); meters `tokensUsed`; **429** when over budget |
| POST | `/api/play/session/:id/claude/message` | — | Phase 2 chat relay: run `claude -p` in sandbox (`{ anonymousId, prompt }`) |
| POST | `/api/play/session/:id/terminal*` | — | PTY APIs still on server; **not used** by current Build UI |
| GET | `/api/play/session/:id/workspace-revision` | — | Workspace fingerprint for preview refresh |
| POST | `/api/play/submit` | — | Snapshot project files + kill sandbox (`{ sessionId, anonymousId, displayName }`). Rejects starter-only / near-empty snapshots with **400** `{ code: "starter_only" }` |
| GET | `/api/play/submissions` | — | Public gallery list (`challengeDate`, `limit`, `anonymousId`); omit `files`; includes `previewRevision` |
| GET | `/api/play/submissions/:id` | — | Public submission detail (`previewRevision`; `includeFiles` default true) |
| GET | `/api/play/preview/:id/:revision` | — | Serve stored `index.html` (immutable revision = `submittedAt` ms) |
| GET | `/api/play/preview/:id/:revision/*` | — | Serve stored snapshot asset by exact relative path |
| GET | `/api/play/vote/next` | — | Next pairwise pair (`anonymousId`, optional `challengeDate`, `preferId`, `includeFiles`); requires same-day submit |
| POST | `/api/play/vote` | — | Cast pairwise vote; Bayesian rating update; optional `includeFiles`; every 5th vote returns round recap |
| GET | `/api/play/leaderboard` | — | Rankings by conservative Bayesian score (`challengeDate`, `limit`, `anonymousId`) |
| GET | `/api/play/admin/submissions` | Firebase + admin | List submissions (omit files; filter `challengeDate`) |
| GET | `/api/play/admin/submissions/:id` | Firebase + admin | Full submission including `files[]` |

### Voting + leaderboard

- **Browse** (`/Gallery`): date-scoped gallery; detail (`/Submission?id=`) previews via API-origin iframes by default (`GET /api/play/preview/:id/:revision/*`). Build-time live previews still use E2B.
- **Preview mode toggle:** one hard-coded line in `play/client/src/config/submissionPreview.js` — `SUBMISSION_PREVIEW_MODE = "api"` (shipped) or `"blob"` (legacy client blob URLs; rollback = flip that line + redeploy Play client only). Shared hook: `play/client/src/lib/useSubmissionPreview.js`. Keep `previewBlob.js` intact for blob mode.
- **Rate limit:** Play preview routes use a dedicated **3000 req / 15 min / IP** bucket (not the general 100/15 Play API limit).
- **Known limitations:** API-mode localStorage is on the API origin (shared across submissions; blank on first switch from blob); relative asset paths only (root-absolute `/main.js` hits the API host root); text-only snapshots (no binary images/fonts/wasm).
- **Vote** (`/Vote`): pairwise A/B (must have submitted that day). Visible **`n / 5` round counter**; fifth vote shows ranking-impact recap. Up to **25 weighted votes/day** (5 rounds). Swiss-style matchmaking (similar skill + exposure).
- **Ranking**: TrueSkill-style Bayesian 1v1 (`ratingMean` μ, `ratingDeviation` σ); sort by `μ − 3σ`; public `score ≈ 1000 + 40·(μ−3σ)`; provisional until 5 matches.
- No self-votes; one vote per unordered pair per voter per day.
### Claude Code + token budget

AI is the primary Build UX (chat panel). Claude Code still runs **inside E2B**; Bridge holds `ANTHROPIC_API_KEY` and proxies Anthropic Messages with a hard `tokenBudget`.

| Env | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Org key on Bridge only (never written into the sandbox) |
| `PLAY_LLM_PROXY_PUBLIC_URL` | Public base URL E2B can reach (e.g. Render). **Required for Claude** — sandboxes cannot call `localhost` |
| `PLAY_ANTHROPIC_MODEL` | Default Claude model (e.g. `claude-sonnet-4-6`) |

On session create, Bridge provisions:

- `ANTHROPIC_BASE_URL=https://<host>/api/play/session/<id>/llm`
- `ANTHROPIC_AUTH_TOKEN=<llmProxyToken>` (per-session Bearer)
- Claude onboarding/settings so no Anthropic login is required

**Local testing:** set `PLAY_LLM_PROXY_PUBLIC_URL` to your Render URL or an ngrok/cloudflared tunnel to `:5050`. Without a public URL, chat Claude cannot reach the proxy.

**Build page:** Left stack (drag-reorder + resize): **Monaco editor** | **Claude Code** chat; **Preview** iframe on the right. Manual edits save to E2B (debounced) and into a session `workspaceSnapshot`; Claude edits refresh that snapshot. Chat turns are stored on the session and restored on reload. Session lasts until **submit** or the **wall-clock build limit** (`timeLimitMinutes` / `PLAY_BUILD_TIME_LIMIT_MINUTES`, default 10, never past period end). Build UI shows a **Time left** meter. Leaving Build **pauses** the E2B sandbox (after ~45s hidden / on navigate away); paused sessions don’t consume concurrent seats; returning **resumes** it. If the box is gone mid-window, resume recreates it and restores the snapshot. No user-facing terminal — Claude runs shell commands inside the sandbox. code-server is **not** in the Play template.

**Local build flow:** Home → Start building → `/Build` provisions an E2B sandbox, opens editor + Claude + preview. **Submit** asks for a display name, snapshots `/home/user/project` into Mongo (`PlaySubmission`), and kills the sandbox. Admin → **Submissions** tab lists entries with file viewer + iframe preview (API URL by default; still loads `files` for the inspector).

**Deploy / rollback for saved previews:** Deploy backend (additive `/preview` route) first, then Play client with `SUBMISSION_PREVIEW_MODE = "api"`. Rollback never requires reverting API/Mongo — set the constant to `"blob"` and redeploy the Play client only (`includeFiles` defaults true for old clients).

Requires `PLAY_ENABLED=true`, `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `PLAY_LLM_PROXY_PUBLIC_URL`, and a built `PLAY_E2B_TEMPLATE_ID`. One active session per `localStorage` anonymous id + UTC challenge date.

```bash
curl -X POST http://localhost:5050/api/play/session \
  -H 'Content-Type: application/json' \
  -d '{"anonymousId":"test-1"}'
# → sessionId, previewUrl, expiresAt, challenge

curl -X POST http://localhost:5050/api/play/submit \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<id>","anonymousId":"test-1","displayName":"Saaz"}'
# → submissionId, fileCount, …
```

## E2B Play sandbox (template spike)

Custom template with a **static preview** (:8080) and **Claude Code CLI** (code-server removed). The preview server sends `Cache-Control: no-store` so rebuilt JavaScript and CSS are never replaced by stale browser-cached starter assets. Grading still uses the default E2B image; Play uses `PLAY_E2B_TEMPLATE_ID`.

```bash
# Build template (once, or when start.sh / starter changes)
cd play/e2b-template
npm install
npx tsx build.dev.ts   # → bridge-play-dev

# Smoke test (from server/)
cd ../../server
# Set PLAY_E2B_TEMPLATE_ID=bridge-play-dev in config.env
npx tsx src/scripts/play-sandbox-smoke.ts
npx tsx src/scripts/play-sandbox-smoke.ts --keep   # leave URLs up for manual check
```

See [`play/e2b-template/README.md`](e2b-template/README.md) for ports, rebuild notes, and Claude install details.

## Deployment

### MongoDB Atlas

- Same cluster as assessments; `bridge-play` is created on first write.
- No connection string change — only `PLAY_DB_NAME=bridge-play` on Render.

### Render (existing backend — no new service)

1. Add env vars: `PLAY_ENABLED`, `PLAY_DB_NAME`, `PLAY_FRONTEND_URL`, `PLAY_ADMIN_EMAIL`
2. Redeploy the existing web service
3. Verify: `curl https://<your-render-url>/api/play/health`

### Vercel (new project)

1. Import the same GitHub repo
2. **Root Directory:** `play/client`
3. Build: `npm run build`, Output: `dist`
4. Env: `VITE_API_URL=https://<your-render-url>` plus Firebase vars if needed
5. Domain: `play.bridge-jobs.com` (optional)
6. Set `PLAY_FRONTEND_URL` on Render to match, then redeploy Render

Assessments Vercel project (`client/`) is unchanged.

## Future implementation

- Automatic challenge rotation / calendar seed (still manual Admin or seed script)
- Flip `PLAY_CHALLENGE_CADENCE=daily` when ready to go Wordle-daily again
- Optional end-of-day Top 8 finals bracket
- Share cards / streaks
- **Head-to-head:** live 1v1 build duel (same prompt, timed, spectators / rematch) — backlog, not scheduled