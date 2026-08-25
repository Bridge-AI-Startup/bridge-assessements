# Bridge Shorts

Consumer-facing daily build challenge (Wordle-style) that showcases Bridge's thesis: evaluating how well people can build with AI, not Leetcode-style puzzles. This product is **separate** from the hiring assessments app.

> **Naming:** the product is **Shorts** (formerly "Play"). The frontend tree, API namespace, and env vars are `shorts` / `SHORTS_*`. For a gradual migration the server still honors the legacy `/api/play` route alias and `PLAY_*` env fallbacks, and the MongoDB database / Mongoose models keep their `bridge-play` / `Play*` names so existing Atlas data stays wired.

## Layout

| Path | Purpose |
|------|---------|
| `shorts/client/` | Vite React app — **separate Vercel project** |
| `shorts/challenges/` | Challenge seed JSON files |
| `shorts/e2b-template/` | Custom E2B image (Claude Code + static preview; no code-server) |
| `server/src/routes/shorts.ts` | API namespace `/api/shorts/*` (legacy alias `/api/play/*`) on the **existing Render service** |
| `server/src/models/shorts/` | Mongo models on the `bridge-play` database (model names unchanged) |
| `server/src/services/shorts/` | Challenge + session + sandbox helpers |
| `server/src/utils/shortsEnv.ts` | `SHORTS_*` env reads with legacy `PLAY_*` fallback |

## Local development

**Terminal 1 — API**

```bash
cd server
# Set SHORTS_ENABLED=true (or legacy PLAY_ENABLED=true) in config.env to exercise
# feature routes beyond /health
npm run dev
```

**Terminal 2 — Shorts client**

```bash
cd shorts/client
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
npx tsx src/scripts/seedShortsChallenge.ts ../shorts/challenges/counter-widget.json
```

The JSON may omit `challengeDate` to default to UTC today. Re-running upserts by `slug`.

**Smoke checks**

```bash
curl http://localhost:5050/api/shorts/health
# → {"ok":true,"product":"shorts"}

curl http://localhost:5050/api/shorts/today
# → challenge JSON (404 if none published for UTC today)
```

**Admin UI**

- Open `http://localhost:5174/Admin` (not linked from public Home nav)
- Sign in with the Bridge Firebase account matching `SHORTS_ADMIN_EMAIL`
- Today's challenge is the default editor; expand **Challenge history** to browse past/future days

## Environment variables

### Server (`server/config.env`)

`SHORTS_*` keys are preferred; the legacy `PLAY_*` key is still read as a fallback (see `server/src/utils/shortsEnv.ts`).

| Variable | Legacy alias | Default | Description |
|----------|--------------|---------|-------------|
| `SHORTS_ENABLED` | `PLAY_ENABLED` | `false` | Gate feature routes (`/today`, `/admin/*`, `/vote`, etc.). `/health` is always on. |
| `SHORTS_DB_NAME` | `PLAY_DB_NAME` | `bridge-play` | Separate Mongo database on the same Atlas cluster |
| `SHORTS_FRONTEND_URL` | `PLAY_FRONTEND_URL` | — | Production CORS origin (e.g. `https://shorts.bridge-jobs.com`) |
| `SHORTS_ADMIN_EMAIL` | `PLAY_ADMIN_EMAIL` | `saaz.m@icloud.com` | Firebase user email allowed to manage challenges |
| `SHORTS_E2B_TEMPLATE_ID` | `PLAY_E2B_TEMPLATE_ID` | `bridge-play-dev` | E2B custom template name (build via `shorts/e2b-template`) |
| `SHORTS_MAX_CONCURRENT_SESSIONS` | `PLAY_MAX_CONCURRENT_SESSIONS` | `5` | Soft cap on globally **running** (non-paused) sessions |

### Shorts client (`shorts/client/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend base URL without `/api` (default: `http://localhost:5050` in dev) |
| `VITE_FIREBASE_API_KEY` | Same Firebase project as assessments (optional — hardcoded fallback in dev) |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |

## API (Phase A + build sessions)

Primary namespace is `/api/shorts`; every route is also served under the legacy `/api/play` alias.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/shorts/health` | — | Always on; `{ ok: true, product: "shorts" }` |
| GET | `/api/shorts/round` | — | Manually selected current round (`isActive: true`); 404 `no_active_round` if none. `/today` is a legacy alias |
| GET | `/api/shorts/period` | — | Compatibility response whose `periodKey` is the active round's `challengeDate`; never calendar-derived |
| GET | `/api/shorts/admin/challenges` | Firebase + admin | List challenges (newest first) |
| GET | `/api/shorts/admin/challenges/:slug` | Firebase + admin | Single challenge |
| POST | `/api/shorts/admin/challenges` | Firebase + admin | Create challenge |
| PATCH | `/api/shorts/admin/challenges/:slug` | Firebase + admin | Update challenge |
| POST | `/api/shorts/admin/challenges/:slug/activate` | Firebase + admin | Make a published challenge the current round. Publishing alone never switches rounds |
| POST | `/api/shorts/session` | — | Create or resume E2B build session (`{ anonymousId }`). Full: **503** `session_queue` waitlist payload |
| GET | `/api/shorts/session/:id` | — | Get session (`?anonymousId=`) |
| GET | `/api/shorts/session/:id/usage` | — | Token meter (`?anonymousId=`) → `{ tokensUsed, tokenBudget, remaining, exhausted }` |
| GET | `/api/shorts/session/:id/files` | — | List project files for Monaco tree (`?anonymousId=`) |
| GET | `/api/shorts/session/:id/file` | — | Read one file (`?anonymousId=&path=`) |
| PUT | `/api/shorts/session/:id/file` | — | Write one file (`{ anonymousId, path, content }`) → E2B |
| POST | `/api/shorts/session/:id/llm/v1/messages` | Bearer `llmProxyToken` | Anthropic-compatible Messages proxy (Claude Code in E2B); meters `tokensUsed`; **429** when over budget |
| POST | `/api/shorts/session/:id/claude/message` | — | Phase 2 chat relay: run `claude -p` in sandbox (`{ anonymousId, prompt }`) |
| POST | `/api/shorts/session/:id/terminal*` | — | PTY APIs still on server; **not used** by current Build UI |
| GET | `/api/shorts/session/:id/workspace-revision` | — | Workspace fingerprint for preview refresh |
| POST | `/api/shorts/submit` | optional Firebase | Snapshot project files + kill sandbox (`{ sessionId, anonymousId, displayName }`). Rejects starter-only / near-empty snapshots with **400** `{ code: "starter_only" }`. Max **3 live builds per person per round**; a fourth is **409** `{ code: "submission_limit" }` ("You ran out of builds for this round."). Signed-in `smahadkar@ucsd.edu` is exempt. |
| GET | `/api/shorts/submissions` | — | Public gallery list (`challengeDate`, `limit`, `anonymousId`); omit `files`; includes `previewRevision` |
| GET | `/api/shorts/submissions/:id` | optional Firebase | Public submission detail (`previewRevision`; `includeFiles` default true). Signed-in `isMine` also matches `firebaseUid` |
| DELETE | `/api/shorts/submissions/:id` | browser id and/or Firebase | Owner-delete (`{ anonymousId? }`). Same vote/recap cleanup as admin delete |
| GET | `/api/shorts/preview/:id/:revision` | — | Serve stored `index.html` (immutable revision = `submittedAt` ms) |
| GET | `/api/shorts/preview/:id/:revision/*` | — | Serve stored snapshot asset by exact relative path |
| GET | `/api/shorts/vote/next` | — | Next pairwise pair (`anonymousId`, optional `challengeDate`, `preferId`, `includeFiles`); requires same-day submit |
| POST | `/api/shorts/vote` | — | Cast pairwise vote; Bayesian rating update; optional `includeFiles`; every 5th vote returns round recap |
| GET | `/api/shorts/leaderboard` | — | Rankings by conservative Bayesian score (`challengeDate`, `limit`, `anonymousId`) |
| GET | `/api/shorts/admin/submissions` | Firebase + admin | List submissions (omit files; filter `challengeDate`) |
| GET | `/api/shorts/admin/submissions/:id` | Firebase + admin | Full submission including `files[]` |

### Voting + leaderboard

- **Browse** (`/Gallery`): date-scoped gallery; detail (`/Submission?id=`) previews via API-origin iframes by default (`GET /api/shorts/preview/:id/:revision/*`). Build-time live previews still use E2B.
- **Preview mode toggle:** one hard-coded line in `shorts/client/src/config/submissionPreview.js` — `SUBMISSION_PREVIEW_MODE = "api"` (shipped) or `"blob"` (legacy client blob URLs; rollback = flip that line + redeploy Shorts client only). Shared hook: `shorts/client/src/lib/useSubmissionPreview.js`. Keep `previewBlob.js` intact for blob mode.
- **Rate limit:** Shorts preview routes use a dedicated **3000 req / 15 min / IP** bucket (not the general 100/15 Shorts API limit).
- **Known limitations:** API-mode localStorage is on the API origin (shared across submissions; blank on first switch from blob); relative asset paths only (root-absolute `/main.js` hits the API host root); text-only snapshots (no binary images/fonts/wasm).
- **Vote** (`/Vote`): pairwise A/B, open to everyone. Visible **`n / 5` round counter**; fifth vote shows ranking-impact recap. Continues until every unique opponent pair is seen; a new build that creates combinations reopens matchups. Swiss-style matchmaking (similar skill + exposure).
- **Ranking**: TrueSkill-style Bayesian 1v1 (`ratingMean` μ, `ratingDeviation` σ); sort by `μ − 3σ`; public `score ≈ 1000 + 40·(μ−3σ)`; provisional until 5 matches.
- No self-votes; one vote per unordered pair per voter per day.

### Claude Code + token budget

AI is the primary Build UX (chat panel). Claude Code still runs **inside E2B**; Bridge holds `ANTHROPIC_API_KEY` and proxies Anthropic Messages with a hard `tokenBudget`.

| Env | Legacy alias | Purpose |
|-----|--------------|---------|
| `ANTHROPIC_API_KEY` | — | Org key on Bridge only (never written into the sandbox) |
| `SHORTS_LLM_PROXY_PUBLIC_URL` | `PLAY_LLM_PROXY_PUBLIC_URL` | Public base URL E2B can reach (e.g. Render). **Required for Claude** — sandboxes cannot call `localhost` |
| `SHORTS_ANTHROPIC_MODEL` | `PLAY_ANTHROPIC_MODEL` | Default Claude model (unset → Opus 4.5) |

On session create, Bridge provisions:

- `ANTHROPIC_BASE_URL=https://<host>/api/shorts/session/<id>/llm`
- `ANTHROPIC_AUTH_TOKEN=<llmProxyToken>` (per-session Bearer)
- Claude onboarding/settings so no Anthropic login is required

**Local testing:** set `SHORTS_LLM_PROXY_PUBLIC_URL` to your Render URL or an ngrok/cloudflared tunnel to `:5050`. Without a public URL, chat Claude cannot reach the proxy.

**Build page:** Left stack (drag-reorder + resize): **Monaco editor** | **Claude Code** chat; **Preview** iframe on the right. Manual edits save to E2B (debounced) and into a session `workspaceSnapshot`; Claude edits refresh that snapshot. Chat turns are stored on the session and restored on reload. Session lasts until **submit** or the end of the challenge **round** — there is no per-build time limit, and the Build UI shows no countdown. Credits are the only budget a builder works against. Leaving Build **pauses** the E2B sandbox (after ~45s hidden / on navigate away); paused sessions don’t consume concurrent seats; returning **resumes** it. If the box is gone mid-window, resume recreates it and restores the snapshot. No user-facing terminal — Claude runs shell commands inside the sandbox. code-server is **not** in the Shorts template.

**Local build flow:** Home → Start building → `/Build` provisions an E2B sandbox, opens editor + Claude + preview. **Submit** asks for a display name, snapshots `/home/user/project` into Mongo (`PlaySubmission`), and kills the sandbox. Admin → **Submissions** tab lists entries with file viewer + iframe preview (API URL by default; still loads `files` for the inspector).

**Deploy / rollback for saved previews:** Deploy backend (additive `/preview` route) first, then Shorts client with `SUBMISSION_PREVIEW_MODE = "api"`. Rollback never requires reverting API/Mongo — set the constant to `"blob"` and redeploy the Shorts client only (`includeFiles` defaults true for old clients).

Requires `SHORTS_ENABLED=true`, `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `SHORTS_LLM_PROXY_PUBLIC_URL`, and a built `SHORTS_E2B_TEMPLATE_ID`. One active session per `localStorage` anonymous id + UTC challenge date.

```bash
curl -X POST http://localhost:5050/api/shorts/session \
  -H 'Content-Type: application/json' \
  -d '{"anonymousId":"test-1"}'
# → sessionId, previewUrl, expiresAt, challenge

curl -X POST http://localhost:5050/api/shorts/submit \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<id>","anonymousId":"test-1","displayName":"Saaz"}'
# → submissionId, fileCount, …
```

## E2B Shorts sandbox (template spike)

Custom template with a **static preview** (:8080) and **Claude Code CLI** (code-server removed). The preview server sends `Cache-Control: no-store` so rebuilt JavaScript and CSS are never replaced by stale browser-cached starter assets. Grading still uses the default E2B image; Shorts uses `SHORTS_E2B_TEMPLATE_ID`.

```bash
# Build template (once, or when start.sh / starter changes)
cd shorts/e2b-template
npm install
npx tsx build.dev.ts   # → bridge-play-dev

# Smoke test (from server/)
cd ../../server
# Set SHORTS_E2B_TEMPLATE_ID=bridge-play-dev in config.env
npx tsx src/scripts/shorts-sandbox-smoke.ts
npx tsx src/scripts/shorts-sandbox-smoke.ts --keep   # leave URLs up for manual check
```

See [`shorts/e2b-template/README.md`](e2b-template/README.md) for ports, rebuild notes, and Claude install details.

## Deployment

### MongoDB Atlas

- Same cluster as assessments; `bridge-play` is created on first write.
- No connection string change — only `SHORTS_DB_NAME=bridge-play` (or legacy `PLAY_DB_NAME`) on Render.

### Render (existing backend — no new service)

1. Add env vars: `SHORTS_ENABLED`, `SHORTS_DB_NAME`, `SHORTS_FRONTEND_URL`, `SHORTS_ADMIN_EMAIL` (legacy `PLAY_*` still honored)
2. Redeploy the existing web service
3. Verify: `curl https://<your-render-url>/api/shorts/health`

### Vercel (new project)

1. Import the same GitHub repo
2. **Root Directory:** `shorts/client`
3. Build: `npm run build`, Output: `dist`
4. Env: `VITE_API_URL=https://<your-render-url>` plus Firebase vars if needed
5. Domain: `shorts.bridge-jobs.com` (optional; legacy `play.bridge-jobs.com` still allowed by CORS)
6. Set `SHORTS_FRONTEND_URL` on Render to match, then redeploy Render

Assessments Vercel project (`client/`) is unchanged.

## Future implementation

- Optional scheduled activation could be added later; current rounds are deliberately manual
- Optional end-of-day Top 8 finals bracket
- Share cards / streaks
- **Head-to-head:** live 1v1 build duel (same challenge, timed, spectators / rematch) — backlog, not scheduled
