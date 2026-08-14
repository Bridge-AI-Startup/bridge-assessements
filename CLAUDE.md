# CLAUDE.md - BridgeAI Codebase Reference

## What This App Is

BridgeAI is a technical hiring assessment platform. Employers create take-home coding assessments from job descriptions using AI, share unique links with candidates, and then candidates submit their code via GitHub or a local archive. While the candidate works, an optional in-session ElevenLabs voice companion can capture their reasoning. Submissions are scored across process (how they worked) and behavioral (does the product pass checks) dimensions. Employers view results through an analytics dashboard with recordings, transcripts, and scoring breakdowns.

## Monorepo Structure

```
bridge-assessements/
├── client/          # React frontend (Vite + JSX/TS) — assessments product
├── shorts/client/     # React frontend — Shorts consumer app (separate Vercel deploy)
├── shorts/e2b-template/ # Custom E2B image for Shorts (Claude Code + static preview)
├── server/          # Express.js backend (TypeScript, run via tsx) — assessments + /api/shorts
├── capture-kit/     # Experimental: hooks-first AI-workflow capture run by candidates
├── notebooks/       # Jupyter notebooks (test-assessment-generation.ipynb)
├── package.json     # Root-level shared deps (firebase-admin, express-validator, @vercel/analytics)
└── *.md             # Documentation files
```

The client, shorts/client, shorts/e2b-template, and server each have their own `package.json` and `node_modules` where applicable. They are NOT managed by a workspace tool -- you must install dependencies and run commands independently in each directory.

## Shorts product (consumer daily challenge)

Separate promotional product — **not** part of hiring assessments. See [`shorts/README.md`](shorts/README.md).

> **Naming (Play → Shorts):** the product is **Shorts**. Frontend tree (`shorts/`), server dirs (`routes/shorts.ts`, `services/shorts/`, `models/shorts/`, `controllers/shorts/`), API namespace (`/api/shorts`), and env keys (`SHORTS_*`) all use `shorts`. For gradual migration the server still serves the legacy `/api/play` route alias and reads legacy `PLAY_*` env keys as a fallback via `server/src/utils/shortsEnv.ts`. **Deliberately unchanged** (bound to live data): the Mongo database `bridge-play` (`SHORTS_DB_NAME` default), Mongoose model names (`PlaySubmission`, `PlayChallenge`, `PlayBuildSession`, `PlayVote`, `PlayVoteRound`), the E2B template names `bridge-play-dev` / `bridge-play-v1`, and the legacy `play.bridge-jobs.com` CORS origin.

| Piece | Location | Deploy |
|-------|----------|--------|
| Frontend | `shorts/client/` | Vercel project #2 (root `shorts/client`), `shorts.bridge-jobs.com` |
| API | `server/src/routes/shorts.ts` | Same Render service as assessments (`/api/shorts/*`) |
| Database | `bridge-play` on same Atlas cluster | `SHORTS_DB_NAME` env var |
| Models | `server/src/models/shorts/` | Registered on Shorts Mongoose connection |
| E2B template | `shorts/e2b-template/` | Custom image `bridge-play-dev` / `bridge-play-v1` (no-cache preview :8080, Claude Code CLI; no code-server) |

- `SHORTS_ENABLED=false` by default — gates feature routes; `GET /api/shorts/health` is always on.
- Phase A (implemented): daily challenges, `GET /today`, Firebase-gated admin CRUD at `/admin/challenges/*`, Shorts client `Home` + `/Admin` page, build sessions (`POST/GET /session`) with E2B iframes on `/Build`, submit snapshot (`POST /submit`) + Admin Submissions tab (files + blob preview).
- **Challenge prompts are markdown.** Rendered by `shorts/client/src/components/Markdown.jsx` on Home, the Build chat intro, and as a live preview under the Admin prompt textarea. It is a dependency-free JSX renderer (no `dangerouslySetInnerHTML`) covering headings, bold/italic, inline + fenced code, ordered/unordered lists, blockquotes, rules, and links (`http(s)`/`mailto` only). Tables, images, and nested lists are **not** supported — swap in `react-markdown` if prompts ever need them; call sites only pass a `text` prop.
- Claude Code + token budget: Anthropic-compatible Messages proxy at `/session/:id/llm/v1/messages` (Bearer `llmProxyToken`, meters `tokensUsed` / `tokenBudget`); sandbox provisioned with `ANTHROPIC_BASE_URL` + session token (no user Anthropic login). Build page: desktop defaults to **Chat** mode (chat stream + live preview; toggle to **Studio** for Monaco + chat + preview); mobile (<768px) is always chat-first with change-triggered preview cards and a fullscreen interactive preview. Preference stored in `localStorage` (`playBuildLayout.v1`). Chat relay `POST /session/:id/claude/message` → `claude -p` in E2B. Chat + workspace files persist on the session (refresh/resume within the build window; snapshot restore if sandbox dies). **No build clock:** a session runs until it is submitted or its challenge round ends (`expiresAt` = round end). Builds used to expire a fixed number of minutes after `startedAt`, which lost finished work while people typed a name or signed in; the per-build timer, its countdown UI, the warning/time's-up pop-ups and the submit-hold were all removed together. Leaving Build pauses the sandbox; paused sessions do **not** count toward `SHORTS_MAX_CONCURRENT_SESSIONS`. Requires `SHORTS_LLM_PROXY_PUBLIC_URL` (E2B cannot reach localhost). code-server and the `/session/:id/terminal*` PTY routes are **removed** — the Build UI is Monaco + Claude chat + preview iframe only.
- **Make mode (E2B vs serverless):** builds can be made two ways, selected per-session at creation via `challenge.makeMode` (admin toggle) → `SHORTS_MAKE_MODE` env → `e2b` default. **E2B** = sandbox + Claude Code (`claude -p`), true multi-file, sandbox static preview. **Serverless** = one direct Anthropic Messages call returning a single self-contained `index.html` (CSS/JS inlined, CDN libs allowed), stored on the session `workspaceSnapshot`, served by the backend at `GET /session/:id/preview` (no sandbox, no concurrency cap, no pause/resume). Downstream is identical because both produce `{ path, content }[]`. Serverless forces the chat-first Build layout (no Monaco/Studio) and hides the effort picker (the serverless call sends no `output_config.effort` — model still applies). The make mode is **not named in the Build UI**: `ModelEffortPicker`'s trigger used to carry a "Serverless" / "Claude Code" tag beside the model name, which read as a status badge rather than a control; it now reads `<model> · <effort> — change model ▾` so the pill advertises what clicking it does. Mode is stamped on the session (`PlayBuildSession.makeMode`) so flipping the toggle/env never mis-routes an active session. Serverless make lives in `server/src/services/shorts/serverlessMake.ts`.
- **Model allowlist + serverless-only models (`services/shorts/models.ts`):** `PLAY_MODEL_OPTIONS` drives both `GET /api/shorts/models` and the Build picker. An option flagged `serverlessOnly: true` is admitted **only** by `resolvePlayModel(raw, { serverless: true })` — every other caller (E2B `claude -p`, the CLI-facing Messages proxy) rewrites it to the first non-serverless option, because the Shorts E2B template's Claude Code CLI rejects model ids it doesn't know. **Claude Fable 5** (`claude-fable-5`) is the first such model: Anthropic's most capable, $10/$50 per MTok (~3× Sonnet 4.5), thinking always on (never send a `thinking` param — it 400s) and billed inside `SERVERLESS_MAX_TOKENS`, and its safety classifiers can decline with HTTP 200 + `stop_reason: "refusal"`. The serverless call therefore sends `fallbacks: "default"` + beta `server-side-fallback-2026-07-01` for Fable only, and handles `stop_reason: "refusal"` explicitly. Fable requires 30-day data retention — a zero-retention org 400s on every request. Effort is not plumbed through serverless, so Fable advertises `efforts: []` and runs at the API default.
- **Serverless turns are BUILD or TALK.** Not every prompt has to produce HTML: the serverless system prompt tells the model to return a full HTML document only when the user wants the app created/changed, and to answer in short plain text otherwise (brainstorming, questions, ideas). **A turn that both asks something and requests a change is a BUILD that answers first** — the prompt asks for at most two plain-text sentences before the document, and `classifyMakeResponse` keeps that prose as the chat message, so neither half of a mixed message is dropped (before this, "never both, never a mix" made the model pick one and silently discard the other — the user had to split it into two turns without being told to, burning tokens and wall clock). The reply is classified server-side by `classifyMakeResponse` — a complete `<!DOCTYPE html>…</html>` / `<html>…</html>` block (≥200 chars, fences stripped, prose alongside it kept as the chat message; falls back to one of the rotating `BUILD_CONFIRMATIONS` lines when there is none) rewrites `workspaceSnapshot`; anything else leaves the workspace untouched and is read back into chat. The turn response carries `workspaceChanged` (`true`/`false` serverless, `null` on E2B) and the Build page only refreshes the preview / drops a preview card when it is not `false`. Serverless turns also replay the last 8 `chatMessages` (truncated) as prior Messages-API turns so TALK has conversational memory.
- **Assistant voice (`services/shorts/voice.ts`).** `SHORTS_VOICE` is the personality block spliced into `SERVERLESS_SYSTEM_PROMPT`: warm, casual, texting-a-friend — contractions, lower-case openers, at most one emoji, and an explicit **never** list ("Certainly!", "Great question!", "I'd be happy to", sign-offs, bullet-point essays) that is doing most of the work, since "be friendly" alone just yields exclamation marks. It applies to every chat surface of a turn — the one-line opener before a BUILD document, the answer half of a mixed turn, and TALK replies. BUILD turns are told to open with one short friendly line (under ~12 words) so `classifyMakeResponse` has prose to keep as the chat message; TALK is capped at **80 words and three ideas**. **Currently serverless only** — the E2B path (`PLAY_PROJECT_CLAUDE_MD`, `PLAY_CLAUDE_PROMPT_PREAMBLE`) deliberately keeps its own voice; import `SHORTS_VOICE` there if the two should ever match. `toPlainChatText()` is the deterministic backstop: the Build chat renders messages with `whitespace-pre-wrap` and **no** markdown parser (only the challenge prompt goes through `Markdown.jsx`), so leaked `**bold**` would reach the builder as literal asterisks — it unwraps bold/inline code, strips heading markers and fences, and turns `-` bullets into `•`. **Chat text only — never run it over a generated HTML document.** Covered by `server/test/unit/shortsVoice.test.ts`.
- Admin auth: Firebase + `SHORTS_ADMIN_EMAIL` allowlist (default `saaz.m@icloud.com`); looks up assessments `User` by `firebaseUid`.
- **Consumer accounts (optional):** Firebase sign-in in the Shorts client (`AccountModal`, `lib/useAuth.js`, `lib/socialAuth.js`) — email/password plus **Google** and **Apple** via `signInWithPopup`; no admin allowlist, no assessments `User` doc needed. Redirect sign-in is deliberately unused (the Firebase auth handler is on a different domain than the Shorts client, which breaks under third-party storage partitioning). Provider collisions on the same email (`auth/account-exists-with-different-credential`) hold the pending credential and `linkWithCredential` it after the user signs in with the original method. Google/Apple require enabling the provider + authorized domains in the Firebase console; Apple additionally needs an Apple Developer Services ID and Sign in with Apple key. Which buttons render is gated by `shorts/client/src/config/auth.js`: `VITE_SHORTS_GOOGLE_AUTH` defaults **on**, `VITE_SHORTS_APPLE_AUTH` defaults **off** (Apple needs a paid Apple Developer account, a Services ID, and a Sign in with Apple key in Firebase — showing the button before that is a dead end). The Apple code path in `lib/socialAuth.js` is complete and stays in place; flipping the flag is the only change needed to enable it. Signing in **claims** the browser's `anonymousId` via `POST /api/shorts/account/link` (`PlayAccountLink`: firebaseUid → anonymousIds, max 25); history = union of linked ids, existing submissions/votes are never rewritten. `/MySubmissions` shows all builds across linked ids; the Build submit modal offers guest submit vs. create-account/sign-in. Anonymous (guest) tier keeps working unchanged.
- **Past rounds archive:** public `GET /api/shorts/challenges` lists published challenges up to the current period with per-round submission counts; the Gallery has a "Past rounds" tab linking each round's builds + leaderboard.
- No shared models with assessments `Submission`; admin reuses Bridge Firebase accounts.
- Shorts E2B: build via `cd shorts/e2b-template && npx tsx build.dev.ts`; smoke with `npx tsx src/scripts/shorts-sandbox-smoke.ts` from `server/`. The Python preview server sends `Cache-Control: no-store` so live JS/CSS edits cannot be replaced by cached starter assets. Set `SHORTS_E2B_TEMPLATE_ID`. Grading still uses the default E2B image.
- **Starter project (two copies, keep in sync):** `shorts/e2b-template/starter-project/` is baked into the E2B image; `STARTER_FILES` in `server/src/services/shorts/starterDetection.ts` is the copy serverless sessions are seeded from *and* the reference the starter-only submit gate compares against. Edit both. The page is one muted centred line pointing at the prompt box — **"Enter a prompt in the chat and your build will pop up here."** — and nothing else. It deliberately does not explain the preview pane, reassure the builder that the blankness is normal, or walk through the steps: a preview pane full of instructions reads as a broken build rather than an empty one. Keep any replacement to one sentence, and keep it direction-free ("in the chat", not "on the left") — chat sits beside the preview on desktop and above it on mobile. When the copy changes, add the outgoing version to `LEGACY_STARTER_FILES` and its distinctive lines to `STARTER_INDEX_PHRASES`: live sessions still hold the old starter in `workspaceSnapshot`, and an unrecognised starter sails past the "you haven't built anything yet" gate. E2B sandboxes keep serving the old page until the template is rebuilt; serverless picks it up on server restart.
- **Vote / browse / rankings:** public gallery + pairwise five-vote rounds with recap; Bayesian (TrueSkill-style) ranking; date-scoped. Must have submitted at least one build the same UTC day to vote; all of a voter's own entries are excluded from their pairs. **There is no separate leaderboard page** — the Gallery *is* the ranking: `GET /submissions` already returns rows ordered by `rankingScore` with a `rank` on each, and `SubmissionCard` shows that rank as a badge on the preview (podium tint for the top three). `/Leaderboard` redirects to `/Gallery` (query string preserved) in `App.jsx` so old links survive; `GET /api/shorts/leaderboard` still exists server-side but no client calls it. Every build is its own ranked row; the gallery adds a "Your submissions" section above the rankings. Saved submission previews are served by `GET /api/shorts/preview/:id/:revision/*` (API-origin iframes by default); Build live previews still use E2B. Client toggle: `shorts/client/src/config/submissionPreview.js` `SUBMISSION_PREVIEW_MODE` (`"api"` | `"blob"`). The Vote page carries **one line of copy** — "Try both, then pick the one you'd rather keep open." — and nothing else: the how-voting-works guide, the round sub-line, the footer note and the recap subtitle were all removed, because the matchup explains itself and prose above it just delays the pick. Round progress lives in the header `RoundMeter`. Keep it that way; if something needs explaining, fix the UI. The page labels the two panes **A** / **B** with matching `Pick A` / `Pick B` buttons, and deliberately **hides ratings mid-vote** (a visible score anchors the pick) — they live in the gallery's ranking instead.
- **Waiting room (`BuildWaitCard`):** a build turn is one blocking call with no token stream, so `shorts/client/src/components/workspace/BuildWaitCard.jsx` fills the wait with an elapsed timer, rotating stage narration, and an interactive riddle / knock-knock / joke / trivia / prompting tip. Content lives in `shorts/client/src/lib/waitingRoom.js`; text bits share one shape — `{ id, label, steps: [{ text, cta? }] }`, where a step's `cta` labels the button that reveals the next step — so one-liners, riddles and three-beat knock-knocks render through the same code path. **Humor is general-audience by rule** (Shorts is for everyone): no jokes that need programming knowledge to land. The pool also includes **minigames** — `{ id, label, kind: "game", game }` entries rendered by `shorts/client/src/components/workspace/waitGames.jsx` (reaction test, odd-one-out shade grid, rock-paper-scissors), each a self-contained touch-first component confined to the card; `nextWaitBit` deals a game on a fixed ~30% of draws so adding jokes never starves them out, and the card keys the game by bit id so a redraw restarts it fresh. The stage narration is **cosmetic** (there is no real progress signal), which is why the lines stay vague. Used by both chat surfaces: `ChatFirstBuild` (mobile + desktop chat-first) and the Studio chat pane in `Build.jsx`.
- **Token meter breakdown (`TokenBreakdown`):** spend is metered as `input_tokens + output_tokens` — the budget is that plain sum — but the two directions are also stored separately on the session (`inputTokensUsed` / `outputTokensUsed`, returned as `inputTokens` / `outputTokens` from `GET /session/:id/usage`). Hovering, focusing or tapping the token gauge (chat-first) or the Studio "Tokens" meter opens a panel with the input/output split, total and remaining. Both counters are 0 on sessions that predate the split, and the panel says so rather than showing a fake 0/0. The panel measures its anchor on open and slides itself back inside the viewport — it sits near the left edge of a phone header, and it must ignore a 0-width `window.innerWidth` (hidden pane) or the maths throws it off screen.
- **Dropped-turn recovery (Build chat):** a build turn is one long blocking POST, so on phones it routinely dies client-side (screen lock, cell blip) while the server finishes the turn and persists the user/assistant pair to `chatMessages`. When `POST /session/:id/claude/message` fails at the network layer (no HTTP status), `sendPrompt` in `shorts/client/src/pages/Build.jsx` does **not** show an error: `recoverDroppedTurn` polls `GET /session/:id` (up to 150s, every 4s) for a pair whose last user message matches the prompt (createdAt-guarded against identical re-sends), then renders the reply, preview refresh, and token meter exactly like a normal response — the wait card stays up throughout, so recovery is invisible. To support this, the pre-send workspace-revision probe now runs in **both** make modes (serverless is a cheap snapshot-timestamp read); the success path still skips the post-probe on serverless. Only if polling times out does the builder see a red chat line ("Connection dropped — your message is back in the box…") with the prompt restored to the input. Error chat lines carry `error: true` (styled red by `ChatFirstBuild`; the legacy `^\(Error:` sniff remains as fallback). Relatedly, `ApiNetworkError` in `shorts/client/src/api/requests.ts` shows its check-the-dev-server/CORS diagnostic only in dev builds; production users get one plain "check your connection" sentence.
- **Out of credits (`OutOfCreditsModal`):** the token budget is called **credits** everywhere the builder sees it. `shorts/client/src/components/workspace/OutOfCreditsModal.jsx` pops up when a session's budget is gone — after the turn that drains it, when a send is refused (`429 token_budget_exceeded`, both make modes), or from the **What now?** link in the exhausted banner. Three actions: **Submit build** (opens the submit modal), **Try again** (re-reads `GET /session/:id/usage` first and only re-sends the last prompt if credits actually came back — an upstream 429 can look the same as an exhausted budget), **Cancel** (dismiss; Escape does the same). The retry re-sends with a `force` flag because the page's `usage` state in that closure is still the stale exhausted one.
- **Submit grace (`SHORTS_SUBMIT_GRACE_SECONDS`, default 120):** the only clock left. `expiresAt` is the round boundary, and `POST /submit` accepts a session for this long past it (`isWithinSubmitGrace` in `sessionPersist.ts`) so a submit in flight when the round rolls over still lands; status may already be `expired`, which the gate allows. Session reaping is delayed by the same window so the sandbox survives long enough to snapshot, and an E2B submit whose box is already gone falls back to the persisted `workspaceSnapshot`. Purely server-side — the client neither shows nor counts it down. Set to `0` to disable.
- **Shorts nav (`ShortsHeader`):** inline sections + account dropdown above `sm`; below it both collapse into one hamburger dropdown holding the same links plus Build and the account actions. The page CTA pill stays visible at every width. The wordmark links to Shorts home (never to bridge-jobs.com — clicking "Bridge Shorts" must not leave the app); the way back to the main site is a dedicated **Bridge Jobs** `btn-pill-secondary` beside the account control (hidden below `sm`, mirrored as a full-width pill at the bottom of the hamburger). It is deliberately not the dark `btn-pill` so a page's `cta` pill stays the loudest thing in the header.
- **Share a build (`ShareBuild`):** `shorts/client/src/components/ShareBuild.jsx`, mounted on the Submission page title row and the Build page's post-submit "Submitted" screen (submit response carries `submissionId` for the link). Share URL is the plain `/Submission?id=…` page. Touch devices with `navigator.share` get the native OS sheet; everything else gets a popover (Copy link with "Copied ✓" feedback, X, WhatsApp) that self-anchors left/right to stay on screen. A denied clipboard write (privacy browsers) reveals the URL in a selectable field instead of failing silently. Link unfurls come from `GET /api/shorts/share` via the vercel.json bot-UA rewrite (see route list); no og:image yet — needs screenshot infra.
## Ports and URLs

| Service         | Dev URL                          | Production URL                                           |
|-----------------|----------------------------------|----------------------------------------------------------|
| Frontend (Vite) | `http://localhost:5173`          | `https://www.bridge-jobs.com` (Vercel)                   |
| Shorts (Vite)     | `http://localhost:5174`          | `https://shorts.bridge-jobs.com` (Vercel, root `shorts/client`); legacy `play.bridge-jobs.com` is no longer attached to a deployment |
| Backend (Express)| `http://localhost:5050`         | `https://bridge-assessements-1.onrender.com` (Render)    |
| Health check    | `http://localhost:5050/health`   | `https://bridge-assessements-1.onrender.com/health`      |
| API base        | `http://localhost:5050/api`      | `https://bridge-assessements-1.onrender.com/api`         |
| Shorts API        | `http://localhost:5050/api/shorts` | `https://bridge-assessements-1.onrender.com/api/shorts`    |

- The backend port is configured via `PORT` env var (defaults to `5050`).
- The frontend Vite dev server runs on port `5173` by default; Shorts runs on `5174`.
- The client resolves its API base URL in `client/src/config/api.js`: uses `VITE_API_URL` env var if set, otherwise `localhost:5050` in dev mode and the Render URL in production.
- Shorts client uses `shorts/client/src/config/api.js` with base `${VITE_API_URL}/api/shorts`.
- CORS allowed origins are hardcoded in `server/src/server.ts` -- if you add a new frontend domain, update the `allowedOrigins` array there.
- Current allowed CORS origins: `FRONTEND_URL`, `SHORTS_FRONTEND_URL`, `PLAY_FRONTEND_URL` (legacy alias), `https://app.bridge-jobs.com`, `https://www.bridge-jobs.com`, `https://bridge-jobs.com`, `https://shorts.bridge-jobs.com`, `https://play.bridge-jobs.com` (legacy), `https://bridge-play.vercel.app`, two Vercel preview domains, plus `localhost:5173`, `localhost:5174`, and `localhost:3000` in dev.

## How to Run Locally

```bash
# Terminal 1: Start backend
cd server
cp config.env.example config.env   # First time only, then fill in secrets
npm install
npm run dev                         # Uses nodemon + tsx, loads config.env via --env-file

# Terminal 2: Start frontend
cd client
npm install
npm run dev                         # Vite dev server on :5173
```

For Stripe webhook testing locally, also run:
```bash
stripe listen --forward-to localhost:5050/api/billing/webhook
```

## Tech Stack and External Services

### Frontend (`client/`)
- **React 18** with **JSX** (not TSX -- pages/components are `.jsx`, API layer is `.ts`)
- **Vite** for dev server and builds (with Base44 vite plugin for legacy SDK imports)
- **React Router v6** for routing
- **TanStack React Query v5** for data fetching/caching
- **Shadcn UI** (Radix primitives + Tailwind CSS, "new-york" style) for component library
- **Framer Motion** for animations
- **Firebase Auth v12** (client SDK) for authentication
- **Stripe.js + React Stripe** for checkout UI
- **ElevenLabs React SDK** (`@elevenlabs/react` 1.x) for the in-assessment voice companion
- **Recharts** for data visualization / charts
- **React Hook Form** + `@hookform/resolvers` for form state management
- **React Quill** for rich text editing
- **React Markdown** for markdown rendering
- **@hello-pangea/dnd** for drag-and-drop
- **React Resizable Panels** for resizable UI panels
- **Three.js** for 3D graphics
- **Leaflet / React Leaflet** for maps
- **Sonner** + **React Hot Toast** for toast notifications
- **Embla Carousel** for carousel/slider components
- **Vercel Analytics** for production analytics
- **Zod** for validation
- Deployed on **Vercel** with SPA rewrites (`vercel.json`)

### Backend (`server/`)
- **Express.js** with TypeScript (run directly via `tsx`, no compile step)
- **Mongoose v9** ODM connecting to **MongoDB Atlas**
- **Firebase Admin SDK v13** for server-side auth token verification
- **LangChain** with pluggable AI providers for:
  - Assessment generation from job descriptions
  - Assessment chat assistant
  - Base code generation
  - Code change / diff analysis
  - Completeness scoring
- **AI Provider SDKs**: OpenAI (`openai`), Anthropic (`@anthropic-ai/sdk`), Google Gemini (`@google/generative-ai`)
- **E2B SDK** (`e2b`) for isolated cloud sandbox execution during behavioral grading
- **Pinecone** vector database for code indexing and retrieval
- **Stripe** for subscription billing (checkout sessions + webhooks)
- **Resend** for sending candidate invitation emails
- **ElevenLabs** Conversational AI for the in-session voice companion
- **multer** for file uploads (LLM trace uploads)
- **unzipper** for ZIP extraction
- **Zod** for schema validation
- **express-rate-limit** for rate limiting (disabled in dev, enabled in prod)
- Deployed on **Render**

### Database
- **MongoDB Atlas** -- connection string set via `ATLAS_URI` env var
- Database name: `bridge-assessments` (set via `DB_NAME` env var)

## Environment Variables

### Backend (`server/config.env`)
See `server/config.env.example` for the full list. Key variables:

**Database & Server:**
- `ATLAS_URI` / `DB_NAME` -- MongoDB connection
- `PORT` -- Server port (default: 5050)
- `FRONTEND_URL` -- For CORS (default: `http://localhost:5173`)
- `NODE_ENV` -- `development` or `production`

**Authentication:**
- `FIREBASE_SERVICE_ACCOUNT_JSON` -- Firebase Admin credentials (JSON string, required in prod)
- `FIREBASE_SERVICE_ACCOUNT_PATH` -- Path to service account file (dev only)
- `OPS_ADMIN_EMAIL` -- Comma-separated emails allowed to view `GET /api/ops/workload` / `/OpsDashboard` (cross-account workload). Defaults to `HACKATHON_ADMIN_EMAIL`, then `saaz@bridge-jobs.com`

**AI Providers:**
- `AI_PROVIDER` -- Global default: `openai`, `anthropic`, or `gemini`
- `AI_PROVIDER_ASSESSMENT_GENERATION` / `AI_PROVIDER_ASSESSMENT_CHAT` -- Per-use-case overrides
- `OPENAI_API_KEY` / `OPENAI_MODEL` -- OpenAI config (default: `gpt-5.6-luna`; `gpt-5.6-terra` for assessment generation)
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` -- Anthropic config (default: `claude-3-5-sonnet-20241022`)
- `GEMINI_API_KEY` / `GEMINI_MODEL` -- Gemini config (default: `gemini-1.5-pro`)
- Per-use-case model overrides: `{PROVIDER}_MODEL_{USECASE}` (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION`)

**Vector DB:**
- `PINECONE_API_KEY` / `PINECONE_INDEX_NAME` -- Pinecone vector DB

**Behavioral Grading Sandbox:**
- `E2B_API_KEY` -- API key for E2B sandbox execution
- `GRADING_STORAGE_DIR` -- Local directory for behavioral grading artifacts/reports (default: `./storage/grading`)
- `SUBMISSION_UPLOAD_STORAGE_DIR` -- Local directory for uploaded submission archives (default: `./storage/submissions`)
- `SUBMISSION_SOURCE_MODE` -- Allowed candidate submission sources (`both`/`github`/`upload`, default: `both`)
- `SUBMISSION_UPLOAD_MAX_BYTES` -- Max upload bytes accepted by `/api/submissions/token/:token/upload` (default: `104857600`)
- `SUBMISSION_UPLOAD_MAX_EXTRACTED_BYTES` -- Max bytes after archive extraction for indexing/execution (default: `314572800`)
- `SUBMISSION_UPLOAD_MAX_EXTRACTED_FILES` -- Max extracted file count per uploaded archive (default: `20000`)
- `BEHAVIORAL_GRADING_MAX_CONCURRENT` -- Max concurrent behavioral grading jobs (default: `2`)
- `BEHAVIORAL_GRADING_UPLOAD_ENABLED` -- Enable behavioral grading for uploaded archives (default: `true`)

**Shorts (consumer daily challenge):**
- `SHORTS_ENABLED` -- Gate `/api/shorts` feature routes (default: disabled); `GET /api/shorts/health` always on
- `SHORTS_DB_NAME` -- Mongo database for Shorts product (default: `bridge-play`, same Atlas cluster)
- `SHORTS_FRONTEND_URL` -- CORS origin for Shorts Vercel app (`https://shorts.bridge-jobs.com`)
- `SHORTS_ADMIN_EMAIL` -- Email allowed to manage challenges via `/api/shorts/admin/*` (default: `saaz.m@icloud.com`)
- `SHORTS_E2B_TEMPLATE_ID` -- Custom E2B template for Shorts sandboxes (default `bridge-play-dev`; build from `shorts/e2b-template/`)
- `SHORTS_MAKE_MODE` -- Build path when a challenge doesn't set its own: `e2b` (default, sandbox + Claude Code) or `serverless` (single self-contained HTML generated by one direct Anthropic Messages call, no sandbox). Resolution: per-challenge `makeMode` (admin toggle) > `SHORTS_MAKE_MODE` > `e2b`. Stamped per-session at creation, so flipping it never mis-routes a live session.
- `SHORTS_MAX_CONCURRENT_SESSIONS` -- Soft cap on **running** (non-paused) Shorts sessions (default: `5`; serverless sessions are exempt — no sandbox)
- `SHORTS_SUBMIT_GRACE_SECONDS` -- Window after the round ends (`expiresAt`) in which an in-flight build can still be **submitted** (default: `120`; `0` disables). Submit-only — chat turns are refused once the round is over. Session reaping waits out this window so the sandbox is still there to snapshot. There is no per-build time limit
- `SHORTS_CHALLENGE_CADENCE` -- `weekly` (default) or `daily`. Weekly: one published challenge per Mon–Sun UTC week; `challengeDate` = Monday. Daily: one per UTC calendar day. Swap with this env var only.
- `SHORTS_LLM_PROXY_PUBLIC_URL` -- Public base URL for the Shorts LLM proxy that E2B sandboxes can reach (e.g. Render or a tunnel). Required for Claude Code; sandboxes cannot call `localhost`
- `SHORTS_PUBLIC_API_URL` -- Base URL the **browser** uses for serverless preview iframes (`GET /session/:id/preview`). Leave unset normally: dev falls back to `http://localhost:$PORT`, production falls back to `SHORTS_LLM_PROXY_PUBLIC_URL`. Set it only when the browser is not on the API host (e.g. phone testing through a tunnel). Keeping this separate from the E2B-facing proxy URL is what stops a dead tunnel from breaking local serverless previews
- `SHORTS_ANTHROPIC_MODEL` -- Optional default model for Claude Code in Shorts sandboxes
- `ANTHROPIC_API_KEY` -- Org Anthropic key used by the Shorts Messages proxy (never written into the sandbox)

**Billing:**
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` / `APP_URL` -- Stripe billing

**In-session voice companion (ElevenLabs):**
- `AGENT_SECRET` -- Authenticates ElevenLabs agent tool requests (sent as `X-Agent-Secret`; stored on ElevenLabs as the workspace secret `bridge_agent_secret` so the tool config never holds it in plaintext)
- `ELEVENLABS_API_KEY` -- Management API key used **only** by `src/scripts/registerElevenLabsContextTool.ts` to create/attach the agent's context tool. Not needed at runtime
- `ELEVENLABS_AGENT_ID` -- Default agent for that script (falls back to a hardcoded companion agent id)

**Testing the agent tool against localhost.** ElevenLabs calls the tool from its own
servers, so it cannot reach `localhost` — but you do **not** have to deploy to test. Run
`ngrok http 5050`, then from `server/`: `npx tsx src/scripts/registerElevenLabsContextTool.ts --local`
(auto-discovers the tunnel from ngrok's API on :4040 and repoints the tool). Switch back with
`--prod`. Free ngrok URLs change on every restart, so re-run `--local` after restarting the
tunnel. The script adds an `ngrok-skip-browser-warning` header on ngrok URLs — without it the
free tier's HTML interstitial reaches the agent instead of JSON. Note this repoints the
**shared** agent: while it points at your tunnel, a real candidate's call would hit your
machine, so switch back to `--prod` when you stop testing.

**Email:**
- `RESEND_API_KEY` -- Resend email service key

**Proctoring / Screen Capture:**
- `PROCTORING_STORAGE_DIR` -- Local filesystem root when not using S3 (default: `./storage/proctoring`)
- `PROCTORING_STORAGE_BACKEND` -- `local` (default) or `s3`. If `PROCTORING_S3_BUCKET` or `AWS_S3_BUCKET` is set, S3 is used even when this is unset.
- `PROCTORING_S3_BUCKET` / `AWS_S3_BUCKET` -- S3 bucket for frames, video chunks, merged `playback.webm`, transcripts (same key layout as local)
- `PROCTORING_VIDEO_MERGE_MAX_CONCURRENT` -- Max concurrent eager WebM merge jobs (concat + remux; default: `2`)
- `AWS_REGION` / `AWS_DEFAULT_REGION` -- Required for S3
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` -- IAM user credentials on hosts like Render (or use default credential chain)
- One-time migration: `npx tsx src/scripts/migrateProctoringLocalToS3.ts` (see `server/docs/VIDEO_PROCTORING_SYSTEM.md`)
- Retroactive WebM merge (chunks → `playback.webm`): from `server/`, `npm run backfill:proctoring-video` (same as `npx tsx src/scripts/backfillMergedProctoringVideos.ts`; use `--dry-run` first)
- `TRANSCRIPT_GENERATION_ENABLED` -- Enable/disable AI transcript generation (default: `true`)
- `PROCTORING_FRAME_INTERVAL_MS` -- Capture interval in ms (default: `5000`)
- `PROCTORING_DEDUP_THRESHOLD` -- Pixel diff threshold for dedup (default: `0.03`)
- `TRANSCRIPT_REGION_BATCH_SIZE` -- Max crops per region before flush (default: `5`)
- `TRANSCRIPT_LAYOUT_REDETECT_INTERVAL` -- Re-detect layout every N frames (default: `90`)
- `TRANSCRIPT_LAYOUT_MAX_PIXELS` -- Max dimension for layout image sent to vision (default: `1280`)
- `TRANSCRIPT_OCR_CACHE_CHANGE_THRESHOLD` -- Thumb-diff threshold for reusing cached OCR (default: `0.6`)
- `TRANSCRIPT_DEBUG_SAVE_CACHE_THUMBS` -- Save cached region thumbs to disk (default: `false`)
- `TRANSCRIPT_DEBUG_CACHE_THUMBS_DIR` -- Directory for debug thumbs (default: `{PROCTORING_STORAGE_DIR}/ocr-cache-thumbs`)
- `TRANSCRIPT_ENGINE` -- `frames` (default) or `gemini`. `gemini` uploads the session's merged WebM to the Gemini Files API and transcribes it natively (one request per ~20-min window) instead of extracting + OCRing frames; falls back to the frames engine on any error or when `GEMINI_API_KEY` is unset. Screen 0 only; incremental mode always uses the frames engine.
- `TRANSCRIPT_GEMINI_MODEL` -- Video model for the Gemini engine (default: `gemini-3.6-flash`)
- `TRANSCRIPT_GEMINI_FPS` -- Video sampling rate sent to Gemini (default: `1`)
- `TRANSCRIPT_GEMINI_MEDIA_RESOLUTION` -- `low`/`medium`/`high` (default: `high`; 280 tok/frame — required for reading dense IDE text)
- `TRANSCRIPT_GEMINI_CHUNK_MINUTES` -- Window length per Gemini request (default: `20`)
- `TRANSCRIPT_GEMINI_CHUNK_OVERLAP_SEC` -- Lead-in overlap between windows (default: `30`)
- `TRANSCRIPT_INCREMENTAL_ENABLED` -- Enable sliding-window incremental transcript for active sessions (default: `false`). Set to `true` in production so transcript is built during the assessment and submit only finalizes.
- `TRANSCRIPT_INCREMENTAL_INTERVAL_MS` -- Interval for incremental runs in ms (default: `60000`)
- `ATTEMPT_REAPER_ENABLED` -- Sweep in-progress attempts past `timeLimit` + 5-minute grace and expire them (default: on; set `false` to disable). Same outcome as the client recording-only submit, so a closed tab still merges video and closes capture-kit.
- `ATTEMPT_REAPER_INTERVAL_MS` -- Reaper interval in ms (default: `60000`)

### Frontend (`client/.env.local`)
- `VITE_API_URL` -- Override API base URL (optional, auto-detected from mode)
- `VITE_DEFAULT_COMPETITION_SLUG` -- Optional override for the competition slug (overrides [`client/src/config/competition.js`](client/src/config/competition.js) `SINGLE_COMPETITION_SLUG` when set)
- `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID`
- `VITE_ELEVENLABS_AGENT_ID` -- ElevenLabs agent for the in-assessment voice companion. Unset disables the overlay **and** the microphone copy on the consent screen

## Backend Architecture

### Directory Layout (`server/src/`)
```
server/src/
├── server.ts              # Express app entry point, middleware setup, route registration
├── config/
│   ├── loadEnv.ts         # Loads config.env via dotenv (must be imported first)
│   └── firebaseAdmin.ts   # Initializes Firebase Admin SDK (JSON env var or file path)
├── db/
│   └── mongooseConnection.ts  # Mongoose connection with caching
├── models/
│   ├── user.ts            # User schema (Firebase UID, company, Stripe subscription fields)
│   ├── assessment.ts      # Assessment schema (title, description, time limit, settings)
│   ├── competition.ts     # Competition / hackathon: slug, assessmentId, rules, registration window, leaderboard flag
│   ├── submission.ts      # Submission schema (token, candidate info, GitHub repo, scores, LLM workflow)
│   ├── repoIndex.ts       # Repository indexing metadata for Pinecone
│   └── proctoringSession.ts  # Proctoring session (frames, events, transcript, video chunks)
├── routes/
│   ├── user.ts            # /api/users/* -- create, whoami, delete
│   ├── assessment.ts      # /api/assessments/* -- CRUD + generate + chat
│   ├── submission.ts      # /api/submissions/* -- link generation, token access, submit, grading
│   ├── competition.ts     # /api/competitions/* -- public competition metadata, self-serve join, leaderboard
│   ├── ops.ts             # /api/ops/* -- workload dashboard (OPS_ADMIN_EMAIL)
│   ├── billing.ts         # /api/billing/* -- checkout, status, cancel, reactivate, webhook
│   ├── agentTools.ts      # /api/agent-tools/* -- ElevenLabs agent context retrieval
│   └── proctoring.ts      # /api/proctoring/* -- screen capture sessions, frames, transcripts
├── controllers/
│   ├── user.ts            # User creation, login (with tier limits), account deletion
│   ├── assessment.ts      # Assessment CRUD, AI generation, chat
│   ├── submission.ts      # All submission handlers (share links, submissions, grading)
│   ├── competition.ts     # Public competitions: get by slug, join (creates pending submission), leaderboard
│   ├── ops.ts             # Ops workload aggregation (employer attribution for heavy jobs)
│   ├── billing.ts         # Stripe checkout, status, cancel, reactivate, webhook handler
│   ├── webhook.ts         # ElevenLabs post-call transcript processing + summary generation
│   ├── agentTools.ts      # Code context retrieval for ElevenLabs agent (Pinecone search)
│   └── proctoring.ts      # Proctoring: session CRUD, frame upload, consent, sidecar, transcript generation
├── services/
│   ├── langchainAI.ts     # LangChain abstraction: createChatCompletion(), structured output, provider/model selection
│   ├── assessmentGeneration.ts  # 3-step AI assessment generation (extract reqs → generate → quality review)
│   ├── assessmentChat.ts  # AI chat for assessment editing
│   ├── email.ts           # Resend email service for candidate invitations
│   ├── repoIndexing.ts    # GitHub repo → Pinecone indexing (download, chunk, embed, upsert)
│   ├── repoRetrieval.ts   # Code chunk retrieval from Pinecone (search, dedup, budget)
│   ├── stripe.ts          # Stripe client initialization (API v2024-12-18.acacia)
│   ├── agentContext/
│   │   └── contextCenter.ts   # Unified budgeted context bundle for the ElevenLabs voice agent (assessment/conversation/timeline/code)
│   ├── companion/
│   │   └── firstMessage.ts    # Setup-aware spoken opener + prompt notes for the in-session companion (evidence mode + starter files)
│   ├── behavioralGrading/
│   │   ├── index.ts           # E2B behavioral grading orchestrator + in-process concurrency queue
│   │   ├── planner.ts         # LLM: README → runbook plan (install/test/start)
│   │   ├── schema.ts          # Zod schemas for runbook
│   │   ├── executor.ts        # Executes runbook commands; saves report JSON; readmeFromSandbox
│   │   ├── judge.ts           # One-shot LLM judge (stdout/source/HTTP seed)
│   │   ├── agentJudge.ts      # Tool-using judge (run_command/read_file in sandbox, then finish)
│   │   └── artifacts.ts       # collectJudgeArtifacts + bashLc helpers
│   ├── play/
│   │   ├── challenges.ts      # Shorts daily challenge CRUD + UTC today lookup + public past-rounds archive
│   │   ├── account.ts         # Consumer accounts: claim anonymousIds, cross-round submission history
│   │   ├── sandbox.ts         # Shorts E2B create/getUrls/kill (custom template)
│   │   ├── sessions.ts        # Create/resume build sessions + response shaping
│   │   ├── submissions.ts     # Snapshot workspace → PlaySubmission (E2B sandbox or serverless snapshot; rejects starter-only)
│   │   ├── serverlessMake.ts  # Serverless make: direct Anthropic call → single-file HTML on session (no sandbox)
│   │   ├── starterDetection.ts # Heuristics for unchanged / near-empty Shorts starter
│   │   ├── voting.ts          # Public gallery, pairwise votes, Bayesian ranking, leaderboard
│   │   ├── preview.ts         # Revisioned submission previews + live serverless session preview (path-safe)
│   │   ├── bayesianRating.ts  # TrueSkill-style 1v1 updates + matchmaking heuristic
│   │   ├── ratingConstants.ts # Shared μ/σ defaults + round size caps
│   │   ├── llmProxy.ts        # Anthropic Messages proxy + token budget + claude -p relay
│   │   ├── claudeProvision.ts # Write Claude settings + ANTHROPIC_BASE_URL/AUTH_TOKEN in sandbox
│   │   ├── workspaceFiles.ts  # List/read/write E2B project files for Monaco sync
│   │   ├── models.ts          # Allowed Claude models / aliases for Shorts
│   │   ├── sessionPersist.ts  # Claude chat + workspace snapshot save/restore for resume
│   │   └── index.ts
│   ├── gradingEvidence/
│   │   └── storage.ts         # Artifact storage abstraction for behavioral grading reports/screenshots
│   ├── submission/
│   │   ├── closeAttempt.ts    # completeProctoring + closeCapture for an ended attempt
│   │   └── finalizeExpired.ts # Expire past-grace in-progress attempts (reaper + recording-only)
│   ├── capture/
│   │   ├── storage.ts       # IFrameStorage + getFrameStorage() (local vs S3)
│   │   ├── s3FrameStorage.ts # S3FrameStorage (PROCTORING_STORAGE_BACKEND=s3 or bucket set)
│   │   ├── frameStorage.ts  # Store/retrieve frames and video chunks, update session model
│   │   ├── sessionVideoMerge.ts # Eager merge chunks → playback.webm + delete chunks; buildSessionWebmForPlayback
│   │   ├── serverDedup.ts   # SHA-256 hash-based server-side frame deduplication
│   │   └── framePrep.ts     # PreparedSessionData builder (boundary contract for AI module)
│   └── schemas/
│       └── assessmentGeneration.ts  # Zod schemas for assessment generation structured output
├── types/
│   └── assessmentGeneration.ts  # TypeScript types for assessment generation
├── validators/
│   ├── auth.ts            # Firebase token verification middleware (verifyAuthToken)
│   ├── submissionAuth.ts  # Submission access: verifySubmissionAccess (auth OR token), verifySubmissionToken
│   ├── assessmentValidation.ts  # create/update/generate validation rules
│   ├── submissionValidation.ts  # generateLink, bulkGenerateLinks, sendInvites, start, submit validation
│   ├── userValidation.ts       # createUser validation
│   └── proctoringValidation.ts # Proctoring endpoint validation rules
├── utils/
│   ├── auth.ts            # decodeAuthToken(), getUserIdFromFirebaseUid()
│   ├── subscription.ts    # isSubscribed(), getSubscriptionStatus() -- checks both top-level and legacy nested fields
│   ├── opsAdmin.ts        # OPS_ADMIN_EMAIL allowlist helpers
│   ├── firebase.ts        # Firebase Admin Auth export
│   ├── github.ts          # parseGithubRepoUrl(), resolvePinnedCommit(), fetchRepoMetadata(), resolveBranchToCommit()
│   ├── embeddings.ts      # generateEmbedding(), generateEmbeddings() -- OpenAI embeddings
│   ├── pinecone.ts        # getPineconeClient(), getPineconeIndex(), upsertVectors(), deleteNamespace(), queryPinecone()
│   ├── repoSnapshot.ts    # downloadAndExtractRepoSnapshot(), cleanupRepoSnapshot()
│   ├── leaderboardScore.ts # Combined Screen + Behavioral score for public competition leaderboard
│   ├── submissionTiming.ts # timeLimit + 5-minute grace window (keep in lockstep with the candidate client)
│   └── validationErrorParser.ts  # Express-validator error formatting
├── prompts/
│   └── index.ts           # All AI prompt templates (see Prompts section below)
├── errors/
│   ├── errors.ts          # CustomError base class (statusCode, message)
│   ├── auth.ts            # AuthError: DECODE_ERROR, TOKEN_NOT_IN_HEADER, INVALID_AUTH_TOKEN
│   ├── internal.ts        # InternalError class
│   ├── proctoring.ts      # ProctoringError class (session/consent/frame/transcript errors)
│   ├── handler.ts         # Express error handler middleware (CustomError → JSON response)
│   └── index.ts           # Exports
├── ai/
│   └── transcript/
│       ├── generator.ts   # Orchestrator: batch → vision → stitch → store; parallel region flushes; generateTranscriptIncremental; dispatches to geminiVideoEngine when TRANSCRIPT_ENGINE=gemini
│       ├── geminiVideoEngine.ts # Native-video transcript engine: merged WebM → Gemini Files API → windowed structured segments (no frame extraction)
│       ├── incrementalScheduler.ts # Sliding-window: run incremental transcript for active sessions on interval
│       ├── batcher.ts     # Split frames into vision API batches
│       ├── visionClient.ts # OpenAI vision API calls (detail:high; OPENAI_VISION_MODEL, default gpt-5.6-luna)
│       ├── stitcher.ts    # Merge batch outputs into chronological JSONL; parseTranscriptJsonlToSegments for merge
│       └── manifestInjector.ts  # Inject sidecar events into transcript
└── scripts/               # Utility/migration scripts
    ├── backfillMergedProctoringVideos.ts # Merge legacy WebM chunks → playback.webm + mergedVideo
    ├── listSubmissions.ts
    ├── seedCompetition.ts   # Link Mongo Competition slug → assessment (hackathon dashboard)
    ├── seedShortsChallenge.ts # Upsert Shorts daily challenge from shorts/challenges/*.json
    ├── seedShortsLaunchRound.ts # Cold-start round seed driven by shorts/seed-builds/<date>/seed.json: upsert challenge, insert seeded builds + simulated vote graph (--date=YYYY-MM-DD, dry-run unless --apply; refuses if the round already has submissions)
    ├── moveShortsLaunchRound.ts # One-off: re-dated the week-1 seeded round from 2026-08-03 onto 2026-07-27 (kept as a template for date moves)
    ├── swapShortsRounds.ts  # One-off: swapped the seeded memory-match and make-time-visible rounds between 2026-07-27 and 2026-08-03 (kept as a template for round swaps)
    ├── revertShortsRoundSwap.ts # One-off: reversed that swap on 2026-08-03 so make-time-visible is the live launch week; handles real (non-seeded) docs with +1h stamps instead of ±7d
    ├── dropShortsSubmissionUniqueIndex.ts # One-time: drop legacy unique {anonymousId, challengeDate} on PlaySubmission
    ├── shorts-sandbox-smoke.ts # Create Shorts E2B template sandbox; print preview URL + Claude check
    ├── transcriptEngineAB.ts # A/B compare transcript engines (gemini vs frames) on one session, no DB writes; list mode + --plan-only cost preview
    ├── registerElevenLabsContextTool.ts # Register/update the `get_candidate_context` webhook tool on the ElevenLabs companion agent and attach it (`--dry-run`, `--local` = point at the running ngrok tunnel, `--prod`, `--url=`); idempotent
    ├── behavioral-grading-smoke.ts
    ├── e2b-smoke.ts
    └── test-assessment-generation.ts
```

### API Routes Summary

**User routes** (`/api/users`):
- `POST /create` -- Register new user (auth required)
- `GET /whoami` -- Get current user info / login with tier limits (auth required, strict rate limit: 5/15min)
- `POST /delete` -- Delete account + all data including Pinecone namespaces (auth required)

**Assessment routes** (`/api/assessments`):
- `POST /generate` -- AI-generate assessment from job description; response includes `behavioralChecks` and `starterCodeFiles` (auth required)
- `POST /generate-behavioral-checks` -- Generate stack-agnostic behavioral checks from `title` + `description` (manual creation path; auth required)
- `POST /` -- Create assessment with subscription tier check (auth required); optional `behavioralChecks` array
- `GET /` -- List user's assessments (auth required)
- `GET /:id` -- Get single assessment (auth required)
- `PATCH /:id` -- Update assessment (auth required); optional `evidenceMode` (`both` / `none`; leftover `workflow` / `screen` still accepted)
- `DELETE /:id` -- Delete assessment + all submissions + Pinecone data (auth required)
- `POST /:id/chat` -- Chat with AI about assessment (auth required)

**Competition routes** (`/api/competitions`, public):
- `GET /:slug` -- Competition + assessment summary for hackathon dashboard (metadata, rules, dates)
- `POST /:slug/join` -- Self-serve registration: creates a **pending** submission (same as employer generate-link) and returns `token` + `shareLink`; does **not** apply employer free-tier submission limits; stricter rate limit in production (30/hour/IP); duplicate email per assessment returns 409
- `GET /:slug/leaderboard` -- Public leaderboard for submitted candidates (rank by combined Screen + Behavioral score via `leaderboardScore.ts`); top 50 default, `?limit=` max 100; respects `leaderboardPublic` on the competition document

**Ops routes** (`/api/ops`, Firebase auth + `OPS_ADMIN_EMAIL` allowlist — cross-account):
- `GET /workload` -- Aggregated heavy/risk workload: active merges, transcript generation, pending behavioral/evaluation, large sessions; attributes employer (email/company), assessment, submission, proctoring stats; includes in-process merge/grading queue depths for this Render instance. Query: `hours` (default 24), `limit` (default 80). Not crash telemetry — correlate with Render logs.

**Shorts routes** (`/api/shorts`, consumer product — requires `SHORTS_ENABLED=true` except health; every route is also served under the legacy `/api/play` alias):
- `GET /health` -- Always on; smoke check `{ ok: true, product: "shorts" }`
- `GET /today` -- Published challenge for the current period (`SHORTS_CHALLENGE_CADENCE`); includes `cadence` + `periodEndsAt`; 404 `{ error: "no_challenge_today" }` if none
- `GET /period` -- `{ cadence, periodKey, periodEndsAt, label }` for clients
- `GET /challenges` -- Public archive: published challenges up to the current period, newest first (`limit` ≤ 200, default 52); each with `slug`, `title`, `challengeDate`, `category`, `submissionCount`, `isCurrent`
- `POST /account/link` -- Claim the caller's `anonymousId` for the signed-in Firebase account (Bearer ID token; no admin allowlist). Idempotent; max 25 linked ids per account
- `GET /account/submissions` -- All submissions across every `anonymousId` linked to the signed-in account, newest round first, each with per-round `rank` and `challengeTitle`
- `GET /admin/challenges` -- List challenges (Firebase + `SHORTS_ADMIN_EMAIL`; query: `limit`, `from`, `to`, `status`)
- `GET /admin/challenges/:slug` -- Single challenge (admin)
- `POST /admin/challenges` -- Create challenge (admin); optional `makeMode` (`e2b` | `serverless`)
- `PATCH /admin/challenges/:slug` -- Update challenge (admin); optional `makeMode` (`e2b` | `serverless`) — the site's Build-mode toggle
- `POST /session` -- Create or resume E2B build session (`{ anonymousId }`); returns `previewUrl`, `chatMessages`, `expiresAt` (wall-clock build limit); reconnects sandbox or restores `workspaceSnapshot` if box died; provisions Claude `ANTHROPIC_*` + `llmProxyToken`. When running seats are full: **503** `{ code: "session_queue", activeCount, maxConcurrent, estimatedWaitSeconds }` (client waitlist polls)
- `POST /session/:id/pause` -- Pause E2B sandbox while user leaves Build (`{ anonymousId }`); session stays active until end of UTC day
- `POST /session/:id/resume` -- Resume paused sandbox / keep-alive running box; refresh `previewUrl`
- `GET /session/:id/usage` -- Token meter (`?anonymousId=`) → `{ tokensUsed, tokenBudget, remaining, exhausted }`
- `GET /session/:id/files` -- List workspace files for Monaco (`?anonymousId=`)
- `GET /session/:id/file` -- Read one file (`?anonymousId=&path=`)
- `PUT /session/:id/file` -- Write one file (`{ anonymousId, path, content }`) into E2B; upserts session `workspaceSnapshot`
- `GET /session/:id/workspace-revision` -- Workspace fingerprint for preview refresh (`?anonymousId=`); serverless returns a `workspaceSnapshotAt`-derived revision (no sandbox)
- `GET /session/:id/preview` and `GET /session/:id/preview/*` -- **Serverless make mode only:** serve the live session's generated file(s) from `workspaceSnapshot` (`?anonymousId=`; ownership-checked; `Cache-Control: no-store`). This is the iframe `previewUrl` for serverless builds (E2B builds preview from the sandbox instead); its absolute base comes from `SHORTS_PUBLIC_API_URL` → `http://localhost:$PORT` in dev → `SHORTS_LLM_PROXY_PUBLIC_URL` in production, and is re-stamped on every session create/resume so a stale base can't strand an existing session
- `POST /session/:id/llm/v1/messages` -- Anthropic-compatible Messages proxy for Claude Code in E2B (Bearer `llmProxyToken`); streams; increments `tokensUsed`; **429** when over `tokenBudget`
- `POST /session/:id/claude/message` -- Chat turn. Dispatches on the session's `makeMode`: **E2B** runs `claude -p` in the sandbox; **serverless** makes one Anthropic Messages call that either returns single-file HTML (saved to `workspaceSnapshot`) or a plain-text chat answer (workspace untouched). Both meter tokens, append `chatMessages`, and return assistant text (`{ anonymousId, prompt, model?, effort? }`; `effort` is ignored in serverless). Response includes `workspaceChanged` — `true`/`false` for serverless, `null` for E2B (client diffs the workspace revision instead)
- `POST /submit` -- Snapshot workspace files into a **new** `PlaySubmission` (`{ sessionId, anonymousId, displayName }`), mark session submitted, kill sandbox. **Optional auth** (`optionalAuthToken`): a valid Bearer ID token stamps `firebaseUid` on the submission and links the `anonymousId` to that account in the same request; guests submit unauthenticated exactly as before; **400** `{ code: "starter_only" }` if snapshot is still the unchanged / near-empty starter. Never overwrites an earlier build — repeat submits create additional independent entries, each starting at default μ/σ
- `GET /submissions` -- Public gallery list (`challengeDate`, `limit`, `anonymousId`); metadata only (no `files`); includes `previewRevision` and `isMine`. Also returns `mine[]` — every entry belonging to `anonymousId`, independent of `limit`, so a builder always finds their own work
- `GET /submissions/:id` -- Public submission detail (`previewRevision`; optional `includeFiles`, default true; omit `files` when false)
- `GET /share` -- OpenGraph share card (HTML, not JSON) for a submission (`?id=`). Target of the Shorts Vercel **bot-UA rewrite**: `shorts/client/vercel.json` rewrites `/Submission` to this endpoint when the user-agent is a social crawler (iMessage/WhatsApp/X/Slack/…), so shared links unfurl with the build + challenge title while humans get the SPA. Unknown ids fall back to a generic Bridge Shorts card (never 404 — that would kill the preview). Meta-refreshes humans to the client page; canonical base from `SHORTS_FRONTEND_URL` → prod `shorts.bridge-jobs.com` → dev `localhost:5174`. Lives in `services/shorts/sharePage.ts`
- `GET /preview/:id/:revision` -- Serve stored `index.html` for a submission at immutable `submittedAt` revision (security headers + long cache)
- `GET /preview/:id/:revision/*` -- Serve a stored snapshot asset by exact relative path (same headers); path-safe, skips `.claude`/`.git`/`node_modules`
- `GET /admin/submissions` -- List submissions (admin; query `challengeDate`, `limit`; omits `files`)
- `GET /admin/submissions/:id` -- Full submission including `files` (admin)
- `DELETE /admin/submissions/:id` -- Delete a submission (admin). Also deletes every `PlayVote` naming it on either side, and `$pull`s / `$unset`s it out of that date's `PlayVoteRound` snapshots, so nothing dangles. Ratings are **not** recomputed — opponents keep the points they already won from beating it (unwinding would mean replaying the round). Returns `{ deleted: true, id, displayName, challengeDate, votesRemoved }`
- `GET /vote/next` -- Next pairwise pair (`anonymousId`, optional `challengeDate`, `preferId`, `includeFiles` default true); requires same-day submit; returns round counter (`n/5`) + `previewRevision`
- `POST /vote` -- Cast pairwise vote (Bayesian rating update); optional body `includeFiles` (default true); every 5th vote returns round ranking recap; max 25 votes/day
- `GET /leaderboard` -- Rankings by conservative Bayesian score `μ−3σ` (`challengeDate`, `limit`, `anonymousId`). **One row per submission** — every build ranks independently, so a builder with several entries occupies several rows (each flagged `isMine`); `total` is the submission count. `you` is that builder's highest-ranked entry. Ranks match the gallery's, which uses the same all-submissions ordering

**Workflow capture routes** (`/api/workflow-capture` — always mounted):

Hooks-first capture of the candidate's AI-agent conversation + code changes, as an alternative to screen recording. The candidate runs [`capture-kit/setup.js`](capture-kit/setup.js) in the assessment repo; it discloses what is recorded, requires typed consent, then writes `.claude/settings.json` hooks that POST each prompt / tool call / assistant reply here in real time. See [`capture-kit/README.md`](capture-kit/README.md).

**Per-tool coverage:** **Claude Code** streams live via hooks. **Codex CLI** and **Cursor** have no usable live hook path for us, so they are imported from the stores they already keep — `capture-kit/codex-adapter.js` reads `~/.codex/sessions/**/rollout-*.jsonl` (only rollouts whose recorded `cwd` matches the project; reads `response_item` records only, since `event_msg` duplicates them; skips `developer`-role system context) and `capture-kit/cursor-adapter.js` reads a **copy** of Cursor's `state.vscdb` (`cursorDiskKV` → `bubbleId:*`). Both offer `--probe` (report only, sends nothing) and `--watch`. Cursor's schema is reverse-engineered and has already changed once (2.6 → 3.0) — probe after any Cursor update. Windsurf/Amp route through vendor backends and **cannot** be captured at all.

- `GET /health` -- always on; `{ ok: true, product: "workflow-capture" }`
- `POST /sessions` -- create a capture session; **400 `consent_required` unless `consentGranted: true`**. Returns `captureToken` exactly once
- `POST /events` -- batch ingest from the kit (Bearer `captureToken`). Idempotent on `(sessionId, seq)` so the kit's offline queue can retry freely; oversized payloads are truncated, never rejected. A `Write` tool event carries the new file contents and updates live code state. After the session is completed, returns **202** `{ closed: true, note: "session_completed" }` so the kit can stop locally.
- `POST /snapshot` -- changed-file snapshot (Bearer `captureToken`); git when available, else a bounded project walk (unzipped starters often have no repo). Catches hand edits the agent never made
- `POST /complete` -- close the session (Bearer `captureToken`)
- `GET /me` -- the candidate's own captured record (Bearer `captureToken`). Transparency feature, not a debug route: the setup disclosure promises they can see exactly what was collected, and this is how that is kept. Backs `capture-kit/view.js`
- `GET /agent-context` -- **live** context for the ElevenLabs interviewer agent (`X-Agent-Secret`, shared with `/api/agent-tools`): recent conversation in chronological order + current code state, by `submissionToken` or `sessionId`
- `GET /sessions/:id` -- full timeline for employer review (Firebase auth; ownership-checked via the linked submission; never returns `captureToken`). Each event is stamped with `videoOffsetSeconds` when the submission also has a screen recording, so a reviewer can click a prompt and seek the player to it; response carries a `video` block (merged-recording status/duration). Events outside the recording window get `null`, not a bogus offset
- `POST /video/start`, `POST /video/chunk` (multipart, field `chunk`), `POST /video/stop` -- leftover kit recorder (Bearer `captureToken`), kept for the local tester. **Refused on `both`** (`409 screen_recorded_by_proctoring`) — that mode already records via proctoring. Sync origin for Review is proctoring `stats.captureStartedAt`, not kit `video.startedAt`. Chunks go to disk via multer diskStorage, never the heap.
- `GET /sessions/:id/video` -- kit playback (dev/tester); production Review plays the proctoring signed S3 URL, never this stream

**Grading a workflow submission.** When `evidenceMode` resolves to `workflow`/`both`, `ensureProctoringTranscriptAndEvaluate` grades the hook stream via [`evaluateWorkflowSession`](server/src/services/workflowCapture/evaluate.ts) (same `evaluateTranscript` orchestrator). Same `evaluationReport` shape is stored on the submission. If no capture-kit session is linked, evaluation **fails clearly** — it does **not** fall back to `generateTranscript` / video OCR. Screen recording in `both` is **one** movie: the proctoring merged `{sessionId}/playback.webm` (Review `<video>`, signed S3). After merge (`mergeSessionVideo` / `completeProctoringForSubmission`), `classifyScreenGaps` runs Gemini surface identification on **that** file (`MEDIA_RESOLUTION_LOW` / 1fps — not OCR, not `TRANSCRIPT_ENGINE=gemini`) and writes `screen_context` events. Sync origin is proctoring `stats.captureStartedAt` (`event.at − start`), matching Review seeks. `workflow` has no proctoring movie — classification is skipped. The capture-kit recorder is not started on `both`. **Closing capture sessions.** The kit only ends a session when it calls `POST /complete` itself, which the web submit never triggers — sessions sat `active` forever, and since episodes are computed once when capture ends, a finished assessment showed the reviewer "capture is still in progress" and no episode summary. [`services/workflowCapture/finalize.ts`](server/src/services/workflowCapture/finalize.ts) fixes this: `closeCaptureForSubmission(submissionId)` is fired (unawaited) from **every** path that ends an attempt — both GitHub submits, the upload submit, the recording-only finalise, opt-out, and the past-grace reaper (`services/submission/finalizeExpired.ts`). After close, leftover kit POSTs get **202 `closed: true`**; the kit writes `.bridge/ended` and subsequent hooks/watch loops no-op. When a proctoring recording exists (`both`), finalize **closes only** and leaves episodes to `prepareScreenContextForEvaluation` (await merge + classify, then group) inside `evaluateWorkflowCaptureForSubmission`, so hook-silent stretches are described. `none` skips observational evaluation entirely (clears a pending status rather than failing as if the candidate skipped capture). `POST /api/evaluate` kicks off this same background pipeline and returns 202.

**Voice in the graded timeline.** `evaluateWorkflowSession` merges the in-session voice companion transcript (read via [`services/companion/transcript.ts`](server/src/services/companion/transcript.ts), the single reader for the `{proctoringSessionId}/companion/*.jsonl` blobs — the context center uses the same one) into the event stream before `buildTranscriptEvents`, as `voice_utterance` events rendered "Candidate said aloud: …" / "Voice companion asked: …" with action type **`speaking`**. `speaking` is a first-class `ActionType` (types, zod schema, grounder prompt, and `compactTranscript`'s HIGH_SIGNAL set all know it — the last one matters: utterances are rare and must survive downsampling). So the judge sees *"said X"* chronologically beside *"did Y"*, and criteria can cite spoken intent. `EVIDENCE_INVENTORY` (workflow profile) now lists voice with the coverage caveat: criteria may cite what WAS said but must not require narration to exist. **`workflowMetrics` stay voice-free on purpose** — they are the deterministic behavioural floor and speech volume must not move them. Known limitation: the timeline origin is capture-kit start, and the companion starts earlier (at consent), so pre-capture utterances clamp to ts 0.

**Communication assessment** ([`services/evaluation/communication.ts`](server/src/services/evaluation/communication.ts)) runs after grading when any voice exists and lands on the report as `evaluationReport.communication` — **supplementary, deliberately excluded from every combined score** (narration volume measures comfort talking to a bot, not skill; the prompt judges only what WAS said, never how much). Shape: `{ available, utteranceCount, wordCount, clarity 1-10, summary, highlights[], claimChecks[] }`. `claimChecks` is the piece no single stream could produce: every falsifiable spoken assertion ("I tested it", "I'll do the backend first") is checked against the captured timeline and marked supported / contradicted / unverifiable — with screen classification merged in, even "I opened it in Chrome" becomes checkable via `browser:own_app` spans. All citations are validated against real spoken moments (±30s) before storage; fewer than 3 utterances or 25 words → `available: false` with reason, never a hollow score. Costs one extra LLM call per evaluation. Rendered on the Review dialog's Summary tab by [`CommunicationCard.jsx`](client/src/components/submissions/CommunicationCard.jsx) (between the rubric and "How they worked"): clarity + summary, quotable highlights, and the claim-check list with Supported / **Not seen in capture** / Unverifiable badges — "unverifiable" styled grey on purpose (it describes the record, not the candidate). Timestamps seek the recording via the same `handleSeekRecording` path as rubric evidence chips. Render rules: `communication` absent or pipeline-failed → nothing; too-little-speech → one muted factual line ("staying quiet is normal and doesn't affect their score"), never a hollow 0/10.

- **Episodes** ([`episodes.ts`](server/src/services/workflowCapture/episodes.ts)) -- computed **once** when capture ends (after screen classification, so they can describe hook-silent stretches) and **persisted** on the session as `episodes` + `episodesComputedAt`; recomputing per request would cost an LLM call on every dashboard poll. `?episodes=true` on the analysis route also groups raw events into ~15-40 narrative stretches ("fixing stale summary counts", kind `debugging`), each carrying `evidenceIndices` back to the raw events. Thousands of events are too granular to grade and too big for one context; episodes are the middle layer, and the back-pointers are what keep every downstream claim traceable. Text-only, so cost is independent of session length. Opt-in per request because it costs an LLM call. On very long sessions the prompt **samples with a stride** rather than truncating — keeping the first 400 events would describe only the opening minutes and silently discard the rest of the story
- **Evidence validator** ([`evidenceValidator.ts`](server/src/services/workflowCapture/evidenceValidator.ts)) -- checks every citation in a criterion verdict against the captured timeline (±30s tolerance, since a judge summarising a stretch may cite its middle) and **drops what cannot be matched**. A judge will happily cite a timestamp that never existed, and once a verdict reaches an employer a fabricated citation is indistinguishable from a real one. When more than half the support is dropped the verdict is marked non-evaluable rather than keeping a score nothing stands behind
- `GET /sessions/:id/analysis` -- the **gradable** view: deterministic metrics + the timeline as `TranscriptEvent[]`, the exact shape `services/evaluation/` already consumes, so `grounder` → `evaluator` run against a workflow session unchanged (same adapter role as `proctoringTranscriptAdapter`). Every row carries `videoOffsetSeconds` so a cited moment is one click from the footage. Metrics live in [`services/workflowCapture/metrics.ts`](server/src/services/workflowCapture/metrics.ts): read:edit ratio, verified-write ratio, low-effort-prompt ratio, median think time, agent-vs-human authorship, and **token usage** (Claude Code hooks carry no usage, so the kit reads the tail of the `transcript_path` the hook hands it; Codex `token_count` records feed the same field). Counted, never asked of a model — free, reproducible, and it frees the judge for interpretive calls
- Screen classification ([`screenContext.ts`](server/src/services/workflowCapture/screenContext.ts)) runs **after the proctoring merge is ready** on `{sessionId}/playback.webm` (kicked from `mergeSessionVideo` and awaited in the evaluate path before episodes). `POST /sessions/:id/classify-screen` re-runs it manually after a prompt/model change; a re-run **replaces** prior `screen_context` events rather than appending. Auto paths skip if `screen_context` already exists. Gemini over video time ranges at `MEDIA_RESOLUTION_LOW` (**deliberately the opposite of the transcript engine's HIGH** — identifying a surface needs a quarter of the tokens that reading its text does) and **1 fps**. Note "native video input" does not mean continuous watching: Gemini samples frames and charges per frame, so `fps` sets temporal resolution. This was originally 0.2 in gaps / 0.05 elsewhere to save tokens, which meant a 15-second switch to a running app produced at most one frame and was routinely missed; a 90-min session at 1 fps is ~380k tokens (~10¢). The **whole recording** is swept, not just hook-silent gaps — gaps-only was blind to anything happening *alongside* agent activity, such as a ChatGPT window open while Claude Code works. The gap/active distinction survives only in what counts as evidence: during hook-active stretches, editor/terminal observations are stored flagged `redundant: true` so the coverage band stays unbroken while `buildTranscriptEvents` excludes them from grading. A window straddling a recording break is skipped — its endpoints map to valid offsets with no continuous footage between them. `workflow` (no screen share) skips classification.
- `GET /tester` and `GET /dev/data` -- **development only** (not mounted when `NODE_ENV=production`, and `dev/data` re-checks): a self-contained live page that polls every 2s and renders the timeline, stats, and code state as events arrive. Open `http://localhost:5050/api/workflow-capture/tester` while working in Claude Code. Page markup lives in [`services/workflowCapture/testerPage.ts`](server/src/services/workflowCapture/testerPage.ts)

**Submission routes** (`/api/submissions`):

*Employer endpoints (auth required):*
- `POST /generate-link` -- Generate candidate share link (returns token + shareLink)
- `POST /bulk-generate-links` -- Bulk generate share links for multiple candidates (up to 100)
- `POST /send-invites` -- Send invitation emails to candidates via Resend
- `GET /assessments/:id/submissions` -- List submissions for assessment
- `DELETE /:submissionId` -- Delete submission
- `POST /:submissionId/index-repo` -- Index submitted code snapshot into Pinecone (GitHub or uploaded archive)
- `GET /:submissionId/repo-index/status` -- Check repo indexing status
- `POST /:submissionId/search-code` -- Search indexed code (debug)
- `POST /:submissionId/grade-behavioral` -- Trigger manual behavioral grading re-run (E2B + evidence capture)
- `GET /:submissionId/behavioral-artifact` -- Retrieve stored behavioral grading artifacts (screenshots/report files)
- `GET /:submissionId/code-archive` -- Download uploaded candidate archive (upload-source submissions only)

*Candidate endpoints (no auth, token-based):*
- `GET /assessments/public/:id` -- Get public assessment details
- `GET /token/:token` -- Get submission by token. If the attempt is still `in-progress` but past `timeLimit` + 5-minute grace, expires it (recording-only tie-out) before responding so a closed tab cannot sit `in-progress` forever.
- `POST /token/:token/start` -- Start assessment (pending → in-progress, captures metadata)
- `POST /token/:token/submit` -- Legacy GitHub URL submit flow (can be disabled via `SUBMISSION_SOURCE_MODE`); accepts late submits within a 5-minute grace period after `timeLimit`, then returns 400 once grace expires
- `POST /token/:token/submit-recording-only` -- Finalize timed-out attempts with proctoring/screen-recording evidence only (no code repo required); marks submission `expired`. Also run by a process reaper (`ATTEMPT_REAPER_*`) and by `GET /token/:token` once grace has elapsed.
- `POST /token/:token/upload` -- Submit code by archive upload (`multipart/form-data`, field `archive`), stores upload metadata, starts indexing, auto-triggers behavioral grading; same 5-minute post-time-limit grace window as GitHub submit
- `POST /token/:token/opt-out` -- Opt out with reason
- `PATCH /:id` -- Update submission (auto-save)
- `GET /:id` -- Get submission by ID
- `POST /:id/submit` -- Final submission (legacy, also auto-triggers behavioral grading)

**Billing routes** (`/api/billing`):
- `POST /checkout` -- Create Stripe checkout session (auth required)
- `GET /status` -- Get billing status (auth required)
- `POST /cancel` -- Cancel subscription at period end (auth required)
- `POST /reactivate` -- Reactivate canceled subscription (auth required)
- `POST /webhook` -- Stripe webhook (signature verified, handles checkout.session.completed, subscription.*)

**Proctoring routes** (`/api/proctoring`):

*Candidate endpoints (token-based, no auth):*
- `POST /sessions` -- Create proctoring session for a submission
- `POST /sessions/:sessionId/consent` -- Grant screen recording consent
- `POST /sessions/:sessionId/frames` -- Upload a frame (multer, FormData with token)
- `POST /sessions/:sessionId/frames/batch` -- Batch frame upload (not implemented yet)
- `POST /sessions/:sessionId/events` -- Record sidecar events (blur/focus/copy/paste)
- `POST /sessions/:sessionId/complete` -- Mark session as completed
- `POST /sessions/:sessionId/video` -- Upload video chunk (multer, FormData with token)

*Shared endpoints:*
- `GET /sessions/:sessionId` -- Get session details
- `GET /sessions/:sessionId/transcript` -- Get JSONL transcript

*Companion (in-session voice transcript; candidate token or employer auth for GET):*
- `POST /sessions/:sessionId/companion/prompt` -- Get system prompt + spoken opener for the ElevenLabs companion (body: token). The prompt is assessment-aware (title only) and explicitly forbids solutions, hints, and code. `firstMessage` is built from the resolved evidence mode + whether starter files exist: it walks through full-screen share, unzip/open starters, and the Node capture-kit command when those steps apply. A remount after the companion has already spoken (`companion.status` active/completed) gets a short welcome-back instead of repeating the briefing.
- `POST /sessions/:sessionId/companion/messages` -- Record companion transcript messages (body: token, conversationId?, messages[]); one JSONL blob per flush under `{sessionId}/companion/`
- `POST /sessions/:sessionId/companion/complete` -- Mark the companion conversation finished (body: token)
- `GET /sessions/:sessionId/companion/transcript` -- Get persisted companion transcript (query token or auth; `?format=jsonl` for raw)

**In-session voice companion.** While the candidate works, an ElevenLabs agent listens and
asks the occasional one-line follow-up so their *reasoning* is captured alongside their code.
The spoken opener
(`services/companion/firstMessage.ts`) is not a generic greeting: it matches the
on-screen setup for that assessment (entire-screen share when recording, unzip/open
starter files, run the Node capture-kit command when workflow capture is on) and never
reads the token or URL aloud. **It is proactive**, not
answer-only: `COMPANION_PROMPT_BASE` (in `controllers/proctoring.ts`) tells it to poll
`get_candidate_context` with `topics: ["timeline"]` roughly every couple of minutes, read the
`latest` array, and open with a question about something concrete the candidate just did
("you re-ran the dev server twice — what are you checking for?"). It was previously "only
speak when spoken to", which meant it never used the evidence at all. Guardrails that must
survive any edit: at most one proactive question every couple of minutes, `skip_turn` when the
candidate is mid-flow, **never** `code` or `episodes` topics (code makes hinting too easy;
episodes only exist after capture ends, so live it always returns empty), and the hint ban —
"why did you pick that order?" is fine, "have you considered the other way?" is forbidden.
It carries the same honesty carve-out as the interviewer: never volunteer that the session is
captured, but never deny it when asked directly. The overlay is
[`ProctoringCompanionNotch.jsx`](client/src/components/proctoring/ProctoringCompanionNotch.jsx):
it auto-starts when mounted with a proctoring `sessionId` + candidate `token`, buffers
transcript lines in memory, and POSTs them every 10s (a failed flush pushes the lines back
onto the buffer rather than dropping them). The parent **must** call
`ref.current.endAndFlush()` before completing the proctoring session — `CandidateAssessment`
does this on submit, opt-out, and time-out (`stopProctoringCapture`), and unmount runs it as a backstop. It is gated on
`VITE_ELEVENLABS_AGENT_ID` through [`client/src/config/companion.js`](client/src/config/companion.js);
with no agent id the overlay renders nothing **and** `ConsentScreen` drops its microphone copy,
so a deployment without an agent never asks for the mic or claims it does. `@elevenlabs/react`
is on the 1.x API: `useConversation` requires a `ConversationProvider` ancestor (the component
wraps itself in one), `startSession` is synchronous with errors arriving via `onError`, the
conversation id comes from `getId()`, and `onMessage` receives **raw socket events**
(`user_transcript` / `agent_response`) rather than 0.x's flattened `{ message, source }` —
`normalizeMessage` handles both so an SDK downgrade doesn't silently stop recording.

*Employer endpoints (auth required):*
- `POST /sessions/:sessionId/generate-transcript` -- Trigger AI transcript generation
- `GET /sessions/by-submission/:submissionId` -- Get session by submission ID
- `GET /sessions/:sessionId/playback-video` -- Presigned S3 URL only (auth + ownership). `?format=url` returns `{ url }`; otherwise 302 to the same URL. Video bytes are **never** proxied through this API (a prior Express stream of `playback.webm` is what billed outbound). 503 if S3 cannot sign.
- `GET /sessions/:sessionId/download-video` -- Same as playback (auth + ownership, S3 only). `?format=url` returns `{ url }`; otherwise 302.

**Agent tools** (`/api/agent-tools`):
- `POST /context` -- **Context center**: one budgeted bundle for the in-session voice companion (X-Agent-Secret). Body `{ submissionId, question?, topics? }` → six fail-soft sections. Every section returns `{ available: false, reason }` rather than throwing, because a tool error mid-call stalls a live voice conversation; each is separately budgeted so the bundle stays inside a voice turn (~0.3s, ~5KB typical).
  - `assessment` — title, description, time limit, behavioral checks
  - `episodes` — the session as 15-40 labelled narrative stretches, read from the **persisted** `session.episodes` (computed once when capture ends, never on the request path). The highest-value section for a voice agent: raw events are far below the altitude an interviewer thinks at
  - `metrics` — deterministic behavioral counts. Prefers the copy on `evaluationReport.workflowMetrics`; computes live only when the session is under `METRICS_LIVE_EVENT_CAP` (4000) events, else reports `session_too_large_for_live_metrics_grade_first`
  - `timeline` — workflow-capture events merged chronologically with proctoring sidecar events, **including `screen_context`** (the Gemini screen classification — the only record of work done outside the captured agent, e.g. a browser AI chat). Also returns `latest` (the last 8 meaningful events, newest first, each with `secondsAgo`) — this is what a proactive question anchors on — and `counts`. **Two exclusion rules keep the entry cap spent on signal, and both are load-bearing:** `screen_context` observations flagged `redundant` are dropped (they exist to keep the coverage band unbroken), and consecutive duplicate sidecar events are collapsed with meaningful events claiming the budget first. Without the second rule a real session returned 32 blur/focus events (13 back-to-back duplicates) against 3 prompts — on a longer session the cap fills entirely with alt-tab churn and the agent sees no prompts at all, while the endpoint still reports `available: true`
  - `conversation` — companion voice transcript
  - `code` — Pinecone chunks keyed to `question` when the repo index is ready, else **live** `WorkflowFileState` files from capture (so the agent can see code mid-assessment, before any submission exists)

  Service: `services/agentContext/contextCenter.ts`. `submissionId` is the universal key (the companion overlay passes it via `dynamicVariables`). Registered on the ElevenLabs agent as the webhook tool `get_candidate_context` by `src/scripts/registerElevenLabsContextTool.ts`

### Rate Limiting (production only, disabled in dev)
- General API: 100 requests / 15 minutes per IP (shared across most `/api/*` routes; proctoring and Shorts preview excluded)
- Proctoring (`/api/proctoring/*`): 8000 requests / 15 minutes per IP (separate limiter; screen capture is high-volume)
- Shorts preview (`/api/shorts/preview/*`): 3000 requests / 15 minutes per IP (separate limiter; gallery iframe assets)
- Auth endpoints (`/api/users/whoami`): 5 requests / 15 minutes per IP
- Competition join (`POST /api/competitions/:slug/join`): 30 requests / 60 minutes per IP

### Raw Body Parsing
`/api/billing/webhook` uses `express.raw()` before `express.json()` to preserve the raw body for Stripe signature verification. This is configured in `server.ts`.

### AI Prompts (`server/src/prompts/index.ts`)
- `PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS` -- Extract requirements, infer stack/level from job description
- `PROMPT_GENERATE_ASSESSMENT_COMPONENTS` -- Generate assessment title, description, timeLimit (with few-shot examples)
- `PROMPT_GENERATE_BEHAVIORAL_CHECKS` -- Generate stack-agnostic behavioral checks from title, description, and requirements summary. The prompt spells out **how a check gets verified** — a sandbox agent that installs and starts the repo, drives it in a real Playwright browser, curls it, and reads source — and therefore what it must not ask for: third-party credentials or paid services, two simultaneous users, the passage of real time, absent hardware, pre-seeded data the candidate was never told to create, aesthetic judgement, or unbounded "is fast/secure" claims. One outcome per check (no "and")
- `PROMPT_SUGGEST_CRITERIA` / `PROMPT_VALIDATE_CRITERION` -- Evaluation criteria (the *process* rubric). Both `system` fields are **functions of a `CriterionEvidenceProfile`** (`"workflow"` default | `"screen"`), which splices in `EVIDENCE_INVENTORY` — an explicit list of what that record does and does not contain. This is not cosmetic: the hook stream knows every prompt and command verbatim but records **no reading at all** and no accept/reject event, while a screen recording is the reverse. Criteria written for the wrong record get scored on evidence that was never collected. Under `workflow` the prompts actively reject the old favourites ("reads the requirements before coding", "reviews AI-generated code before accepting") and steer to recorded equivalents ("inspects existing files before the first edit", "edits agent-written code rather than leaving it untouched"). Profile comes from the request's optional `evidence_mode`; only legacy `screen` maps to the screen profile — `workflow`/`both`/`none` all map to `workflow` (an employer writing criteria under `none` is writing them for the mode they'd turn on). Suggestions are re-validated under the same profile before being returned. Eval cases are pinned per profile in `src/scripts/runEvals.ts`
- `PROMPT_ASSESSMENT_QUALITY_REVIEW` -- Review and validate generated assessment quality
- `PROMPT_ASSESSMENT_CHAT` -- System prompt for AI assistant editing assessments
- `LEVEL_INSTRUCTIONS` -- Role-specific guidance for junior/mid/senior difficulty levels
- `PROMPT_TRANSCRIPT_SYSTEM` -- System prompt for GPT-4o-mini vision: raw observation, character-level text accuracy, JSONL output

## Frontend Architecture

### Directory Layout (`client/src/`)
```
client/src/
├── App.jsx                # Root: QueryClientProvider, BrowserRouter, routes, Toaster, Vercel Analytics
├── App.css                # App-level styles
├── index.css              # Global styles (Tailwind directives, CSS variables)
├── pages.config.js        # Page registry: maps page names to components, mainPage="Landing"
├── main.jsx               # Entry point, renders App (no StrictMode)
├── assets/
│   └── bridge-logo.svg    # BridgeAI logo
├── pages/
│   ├── Landing.jsx        # Main landing page -- job description input, AI/manual mode toggle
│   ├── Home.jsx           # Authenticated dashboard -- lists assessments, create/delete, account dropdown
│   ├── GetStarted.jsx     # Registration -- email, password, company name
│   ├── CreateAssessment.jsx    # Assessment creation -- AI generation or manual, reads localStorage pending data
│   ├── AssessmentEditor.jsx    # Edit assessment -- title, desc, time, starter files, share links, bulk invite
│   ├── CandidateAssessment.jsx # Candidate views assessment -- start timer, screen share, submit/opt-out; capture flushes before submit and only completes after success; pagehide beacons sidecar/companion; past-grace attempts redirect after the server reaper
│   ├── CandidateSubmission.jsx # Shows mock submission data with code review
│   ├── CandidateSubmitted.jsx  # Post-submission confirmation (you're done)
│   ├── HackathonDashboard.jsx  # Challenge join + dashboard/leaderboard only; marketing landing may live on Framer (slug: `?slug=` > env > `config/competition.js`)
│   ├── OpsDashboard.jsx        # Internal ops workload dashboard (OPS_ADMIN_EMAIL); heavy merge/transcript/grading attribution
│   ├── SubmissionsDashboard.jsx # Employer views submissions -- stats, filtering, dropoff analysis, and the single candidate Review dialog
│   ├── Subscription.jsx        # Billing plans -- Free tier vs Early Access
│   ├── Pricing.jsx             # Public pricing page
│   ├── BillingSuccess.jsx      # Stripe success redirect
│   ├── BillingCancel.jsx       # Stripe cancel redirect
│   ├── CancelSubscription.jsx  # Cancellation form with reason
│   └── Contact.jsx             # Contact/support page
├── api/
│   ├── requests.ts        # Base HTTP client (fetch wrapper: get/post/put/patch/del with error handling)
│   ├── assessment.ts      # Assessment API: create, list, get, update, delete, generate, chat
│   ├── submission.ts      # Submission API: generateLink, bulk, invites, start, submit, optOut, uploadTrace
│   ├── competition.ts     # Public competition API: get by slug, join, leaderboard
│   ├── ops.ts             # Ops workload API (admin allowlist)
│   ├── billing.ts         # Billing API: checkout, status, cancel, reactivate
│   ├── user.ts            # User API: verifyUser (whoami), createUser, deleteAccount
│   └── proctoring.ts      # Proctoring API: createSession, grantConsent, uploadFrame, events, complete, video, companion
├── components/
│   ├── assessment/
│   │   ├── AISidebar.jsx               # AI chat sidebar for assessment editing (quick action chips)
│   │   ├── CandidatePreviewModal.jsx   # Candidate assessment preview modal
│   │   ├── DocumentBlock.jsx          # Reusable content block with edit, auto-resizing textarea
│   │   └── PresetPills.jsx            # Quick preset job descriptions
│   ├── BulkInviteModal.jsx            # 3-step CSV upload wizard: upload → review → success
│   ├── submissions/
│   │   ├── BehavioralGradingLiveTrace.jsx # Live agent-step trace while behavioral grading is pending
│   │   ├── CommunicationCard.jsx          # Spoken-reasoning assessment on Summary: clarity, highlights, claim checks vs captured timeline (never part of the score)
│   │   ├── EvidenceMomentChips.jsx        # Rubric evidence as clickable time+observation chips that seek the recording
│   │   └── WorkflowActivityTimeline.jsx   # "What they did": prompting conversation + screen-context beats under the Recording player for `both` (click-to-seek); Summary only for leftover workflow-only
│   ├── proctoring/
│   │   ├── ConsentScreen.jsx          # Consent dialog before screen recording
│   │   ├── RecordingIndicator.jsx     # Floating red recording badge
│   │   ├── StreamStatusPanel.jsx      # Upload stats panel (frames, uploads, dedup)
│   │   ├── ResharePrompt.jsx          # Stream-lost recovery modal
│   │   └── ProctoringCompanionNotch.jsx # In-session ElevenLabs voice companion (notch dropdown, transcript flush)
│   └── ui/                             # 60+ Shadcn UI components (auto-generated, rarely edited)
├── config/
│   ├── api.js             # API_BASE_URL: VITE_API_URL || localhost:5050 (dev) || Render URL (prod)
│   ├── companion.js       # COMPANION_ENABLED — in-session voice companion gate (VITE_ELEVENLABS_AGENT_ID)
│   └── competition.js     # SINGLE_COMPETITION_SLUG — default Mongo competition slug for `/HackathonDashboard`
├── firebase/
│   └── firebase.js        # Firebase client init (auth, analytics)
├── hooks/
│   ├── use-mobile.jsx          # useIsMobile(): viewport < 768px detection
│   ├── useScreenCapture.js     # getDisplayMedia stream lifecycle (single + multi-monitor)
│   ├── useScreenshotCapture.js # Canvas-based PNG frame extraction at intervals
│   ├── useFrameDedup.js        # Client-side pixel-diff dedup
│   └── useFrameUpload.js       # Batched upload with retry + flush
├── lib/
│   ├── query-client.js    # TanStack Query client (refetchOnWindowFocus=false, retry=1)
│   ├── captureUtils.js    # Pure capture utils: captureFrame, pixelDiff, enforceMaxSize, createVideoRecorder
│   ├── NavigationTracker.jsx
│   ├── VisualEditAgent.jsx
│   ├── PageNotFound.jsx
│   └── utils.js           # cn() (clsx + tailwind-merge), isIframe
└── utils/
    └── index.ts           # createPageUrl(pageName) → route path
```

### Routing
- Routes are auto-generated from `pages.config.js` -- each key in the `Pages` object becomes a route at `/<PageName>`.
- `mainPage` is set to `"Landing"`, so the Landing page renders at `/`.
- Additional custom routes for `/billing/success` and `/billing/cancel` are defined in `App.jsx`.
- `vercel.json` has a catch-all rewrite so all routes resolve to `index.html` (SPA behavior).
- Path alias configured: `@/*` maps to `./src/*` (via `jsconfig.json`).

### Authentication Flow
1. User signs up via `GetStarted.jsx`: `createUserWithEmailAndPassword()` + `createUser()` API call → redirect to CreateAssessment
2. User signs in via `Login.jsx`: `signInWithEmailAndPassword()` + `verifyUser()` (GET /users/whoami) → redirect to Home
3. Firebase ID token is sent as `Authorization: Bearer <token>` header on all authenticated API calls
4. Server validates token via `verifyAuthToken` middleware using Firebase Admin SDK
5. Server maps Firebase UID to MongoDB User document via `getUserIdFromFirebaseUid()`
6. Auth state checked via `onAuthStateChanged()` in page components; redirects to `/` if not authenticated

### Data Flow: Assessment Lifecycle
1. **Employer creates assessment**: Landing page → enters job description → stored in localStorage → CreateAssessment page auto-fills → AI generates assessment (extract requirements → generate components → quality review → behavioral checks) → saves to DB; manual path calls `generate-behavioral-checks` then create
2. **Employer edits assessment**: AssessmentEditor page → AI chat sidebar for refinements → configure time limit, starter files, evidence mode
3. **Employer shares link**: Generates unique token-based URL for candidate (single or bulk via CSV upload with email invitations via Resend)
4. **Candidate accesses assessment**: Opens token URL → CandidateAssessment page → views read-only details → starts timer (status: pending → in-progress, captures IP/user agent)
5. **Candidate submits code**: Uploads project folder (client auto-zips) or submits GitHub link → backend stores source metadata (upload archive or pinned commit SHA) → status: submitted
6. **Code indexing**: Repo is downloaded, chunked (200 lines/chunk, 40 line overlap), embedded via OpenAI, and upserted to Pinecone (used by the companion context center's code section when the index is ready)
7. **Scoring**: Combined employer/leaderboard score from available signals — Process (how-they-worked rubric via `evaluationReport`) and Behavioral (E2B check pass rate). Deprecated Trace / LLM-workflow scoring was removed.
8. **Employer reviews**: SubmissionsDashboard → stats, filtering, dropoff analysis, and **one** candidate Review dialog. Observational evaluation starts automatically on submit (and the dashboard re-kicks recent/recoverable failures).

**Candidate review is a single surface.** Clicking a row (or its `Review` button) opens one dialog via `openReview(submission, tab?)` — the only entry point. It carries a persistent scoreboard (Combined / Process / Behavioral / Time spent + status badges) that does **not** move between tabs, an `Actions` menu (GitHub, download archive, re-run grading, re-run scoring, share, delete), and four tabs: **Summary** (capture-integrity warning first when dirty, then which product checks failed, then rubric verdicts + clickable evidence chips that seek the recording, session summary, workflow metrics + episodes), **Recording** (player with criteria timeline; under `both`, the prompting conversation + screen-context beats sit under the player as the click-to-seek index of the footage — there is no screen transcript; leftover `screen` assessments still show a video OCR transcript; the tab is hidden for `none` and leftover `workflow`), **Code** (behavioral grading, per-check evidence, execution log, run project), **Conversations** (opt-out notice, in-session voice companion).

This replaced a maze: a right-side detail Sheet, a separate evaluation modal, a standalone Interview Details modal, a standalone Behavioral Grading Evidence modal, and two duplicate `View screen recording` shortcuts that existed only to jump past a default tab. Four ways to open evaluation and three renderings of the same behavioral evidence made the same content feel like different features. **Do not add a second path to any of this content** — deep-link a tab with `openReview(sub, "recording")` instead of building another modal. The video-load effect is still gated on `evaluationTab === "recording"`, so the recording only fetches when that tab is open.

### Subscription / Billing Flow
1. User clicks upgrade → `POST /api/billing/checkout` creates Stripe Checkout session
2. User completes payment on Stripe-hosted page
3. Stripe sends `checkout.session.completed` webhook → backend updates user's `subscriptionStatus` to `"active"`
4. Subscription changes (cancel, update, expire) come through as Stripe webhooks
5. Paid features are gated **inline in the controllers**, not by middleware: `controllers/assessment.ts` and `controllers/user.ts` read `user.subscriptionStatus || user.subscription?.subscriptionStatus` and compare against `"active"`. There is no `requireSubscription` middleware — it existed but was never mounted on a route, and was deleted.
6. `utils/subscription.ts` also exports `isSubscribed()` / `getSubscriptionStatus()` with the same top-level-then-legacy-nested fallback, but **nothing currently imports them** — the controllers duplicate that logic inline. Prefer calling the util if you touch this code.
7. Free tier limits: 1 assessment, 3 submissions. Paid tier: unlimited. The assessment cap is only enforced when `NODE_ENV === "production"` (`shouldEnforceFreeTierAssessmentLimit()`).

## Database Models

### User
Fields: `firebaseUid` (unique, indexed), `companyName`, `email` (unique, indexed), `companyLogoUrl`

Legacy subscription (nested): `subscription.tier` (free/paid), `subscription.stripeCustomerId`, `subscription.stripeSubscriptionId`, `subscription.subscriptionStatus`, `subscription.currentPeriodEnd`

Current subscription (top-level): `stripeCustomerId` (sparse indexed), `stripeSubscriptionId` (sparse indexed), `subscriptionStatus` (active/canceled/past_due/trialing/incomplete/incomplete_expired/unpaid/null), `currentPeriodEnd`, `cancelAtPeriodEnd`, `cancellationReason`, `cancellationDate`

### Assessment
Fields: `userId` (ref User, indexed), `title` (max 200), `description`, `timeLimit` (minutes, min 1), `starterFilesGitHubLink`, `starterCodeFiles[]` { path, content }, `evidenceMode` (`both` default for new assessments / `none` / leftover `workflow` / leftover `screen` — see below), `behavioralChecks[]` (plain-language observable product behaviors; stack-agnostic), `evaluationCriteria[]` (proctoring/transcript rubric), `evaluationCriteriaGroundings` (optional)

**`evidenceMode` — how a candidate's work is observed.** Employer choice in AssessmentEditor's timing panel is **Observe session** (`both`, default) or **None**. `both`: record the screen for human playback and low-res surface classification, and analyse the hook stream — the video is **not** transcribed (no OCR stills, no `TRANSCRIPT_ENGINE=gemini` on that movie). `none`: no screen recording and no capture-kit. `workflow` (hooks only, no screen) and `screen` (video + AI transcript) are leftover values: still honoured for existing assessments, not offered as new choices. Documents with no field still resolve to `screen`. Resolution lives in [`server/src/utils/evidenceMode.ts`](server/src/utils/evidenceMode.ts): the assessment field is returned as-is (`none` / `workflow` / `both` / leftover `screen`). There is no `WORKFLOW_CAPTURE_ENABLED` rewrite — that flag is unused, and `/api/workflow-capture` is always mounted. Never read the raw field client-side; `GET /api/submissions/token/:token` returns the *resolved* `evidenceMode`. The candidate sees the `capture-kit` setup command on the in-progress screen when observation is on (`both` or leftover `workflow`). `ensureProctoringTranscriptAndEvaluate` grades the hook stream for `workflow`/`both`, runs the video transcript for legacy `screen`, and skips observational evaluation for `none`. PNG frames are captured only for leftover `screen` (OCR); `both` still records sidecar events (tab/blur/clipboard/idle/stream_lost — the kit does not).

### Competition
Fields: `slug` (unique, lowercase), `assessmentId` (ref Assessment), optional `title` / `description` / `rulesMarkdown` (dashboard copy; title/description fall back to assessment), `registrationOpen`, `competitionStartsAt`, `competitionEndsAt`, `leaderboardPublic` (default true). **Ops:** create an assessment in the app, then insert or update a `Competition` document with that `assessmentId` and share `/HackathonDashboard?slug=<slug>`.

### Submission
Core: `token` (unique, indexed), `assessmentId` (ref Assessment, indexed), `candidateName`, `candidateEmail`, `status` (pending/in-progress/submitted/expired/opted-out), `startedAt`, `submittedAt`, `timeSpent` (minutes)

Code source: `codeSource` (`github`/`upload`), `codeUpload` { storageKey, originalFilename, sizeBytes, sha256, uploadedAt }

GitHub: `githubLink`, `githubRepo` { owner, repo, refType (commit/branch), ref, pinnedCommitSha }

Scores (legacy bag; not used for combined ranking): `scores` { overall, completeness… } — orphaned Trace/completeness fields may remain on old Mongo docs; app logic does not write or read them for scoring.

Screen evaluation: `evaluationReport`, `evaluationStatus`, `evaluationError`, `screenRecordingTranscript`, `enrichedTranscript`, `refinedTranscript`

Opt-out: `optedOut`, `optOutReason`, `optedOutAt`

Metadata: `metadata` { ipAddress, userAgent }

Behavioral grading: `behavioralGradingStatus` (`pending`/`completed`/`failed`), `behavioralGradingError`, `behavioralGradingReport` (runbook summary, per-check verdict/evidence, artifact keys, timings, sandbox metadata), `behavioralGradingProgress`

Indexes: `{ assessmentId: 1, status: 1 }`, `{ assessmentId: 1, candidateEmail: 1 }`, `{ candidateEmail: 1 }`

### PlayChallenge (bridge-play DB)
Fields: `slug` (unique, lowercase `a-z0-9-`), `challengeDate` (unique, `YYYY-MM-DD` UTC), `title` (max 120), `prompt`, `tokenBudget`, `category` (`widget`/`game`/`tool`/`other`), `status` (`draft`/`published`), `makeMode` (optional `e2b`/`serverless`; unset → `SHORTS_MAKE_MODE` default — the site's Build-mode toggle), `windowStartsAt`/`windowEndsAt` (optional Date pair: explicit round window override — the challenge is live exactly while now ∈ [start, end], regardless of the cadence grid, and the round countdown/session-expiry cap use `windowEndsAt`; `challengeDate` stays the key submissions/votes/sessions attach to, so a window never rekeys data. Consumers resolve "the current round" through `getActiveChallengeDate()` in `services/shorts/challenges.ts` (window-aware), not raw `getCurrentPeriodKey()`. Set via Mongo directly — not exposed in the admin UI yet)

Indexes: unique on `slug`, unique on `challengeDate`, `{ status: 1, challengeDate: -1 }`

### PlayBuildSession (bridge-play DB)
Fields: `anonymousId` (indexed), `challengeSlug`, `challengeDate` (`YYYY-MM-DD`), `status` (`provisioning`/`active`/`failed`/`expired`/`submitted`), `makeMode` (optional `e2b`/`serverless`; stamped at creation, unset → treated as `e2b`), `e2bSandboxId` (absent for serverless), `previewUrl` (serverless: backend `/session/:id/preview`; E2B: sandbox URL), `tokenBudget`, `tokensUsed` (default 0), `llmProxyToken` (Bearer for Messages proxy; never returned to browser), `llmCalls` (optional counter), `startedAt`, `expiresAt` (end of the challenge round — there is no per-build clock), `chatMessages[]` `{ role, text, createdAt }` (persisted Claude chat), `workspaceSnapshot[]` `{ path, content }` + `workspaceSnapshotAt` (E2B: file backup for sandbox recreate; serverless: the authoritative generated file(s)), `sandboxPaused` (bool; paused sessions excluded from concurrent cap), `error` (optional)

Indexes: `{ anonymousId: 1, challengeDate: 1, status: 1 }`

**Resume:** same `anonymousId` + challenge day reconnects the E2B sandbox when alive (or **paused** — connect resumes it); if the box is gone, a new sandbox is provisioned on the **same** session document and `workspaceSnapshot` is restored. Leaving Build pauses the sandbox after a short idle (`POST …/pause`); returning resumes it (`POST …/resume`). Auto-timeout also pauses (not kills) via E2B `lifecycle.onTimeout=pause`. Claude chat survives refresh via `chatMessages`. The session stays usable until it is submitted or its round ends (`expiresAt`); after that it is expired and the sandbox is killed.

**No build clock (removed 2026-08-06):** builds are limited by **credits only**. There
used to be a per-session wall-clock window (default 10 min, `SHORTS_BUILD_TIME_LIMIT_MINUTES`
or per-challenge `timeLimitMinutes`) plus a whole apparatus around it — a header countdown, a
60s warning pop-up, a time's-up pop-up, a full-screen expired state, and a `submitHoldAt`
"submit clock" (`POST /session/:id/submit-hold`) that paused the deadline while the submit
dialog was open. All of it is gone, along with `BuildTimeModal.jsx` and
`getBuildTimeLimitMinutes()`. The reason: the clock's failure mode was losing a *finished*
build while its author typed a name or signed in — the worst thing the product can do — and
the hold that patched it was itself a request that could fail (a rate-limited `submit-hold`
silently resumed the clock). `expiresAt` now means one thing only: the end of the challenge
round. Resume **extends** a legacy short `expiresAt` up to the round end so builds in flight
across the rollout do not die on the old timer. If a per-build limit is ever wanted again, add
it as a visible, server-enforced budget — do not reintroduce a countdown that can strand a
finished build at submit time.

### PlaySubmission (bridge-play DB)
Fields: `anonymousId` (indexed), `firebaseUid` (optional, sparse-indexed — set when the builder was signed in at submit time), `displayName` (max 40), `challengeSlug`, `challengeDate`, `sessionId`, `files[]` `{ path, content }`, `fileCount`, `totalBytes`, `submittedAt`, Bayesian rating: `ratingMean` (μ, default 25), `ratingDeviation` (σ, default 25/3), `rankingScore` (μ−3σ), `wins`, `losses`, `matches`

Indexes: `{ anonymousId: 1, challengeDate: 1, submittedAt: -1 }`, `{ challengeDate: -1, submittedAt: -1 }`, `{ challengeDate: 1, rankingScore: -1 }`, sparse `{ firebaseUid: 1, submittedAt: -1 }`

**Submissions are independent entries.** A builder may submit any number of builds for the same challenge; each is its own document with its own rating. There is **no** uniqueness on `{ anonymousId, challengeDate }` — that unique index was removed (submitting used to overwrite the previous build, and the replacement inherited the old build's votes). `anonymousId` remains as a non-unique owner tag powering `isMine`, self-vote exclusion, and the "Your submissions" gallery section; `firebaseUid` is the *account*-level owner, stamped when the submit request carried a valid Firebase ID token, so a build submitted right after signing in from the submit dialog belongs to that account even if the browser id is never linked again. `GET /account/submissions` is the union of both. `displayName` is a free-form label — duplicates are allowed and it is not an identity. Existing deployments must drop the legacy unique index once: `npx tsx --env-file=config.env src/scripts/dropShortsSubmissionUniqueIndex.ts` (Mongoose does not drop indexes removed from a schema).

### PlayVote (bridge-play DB)
Fields: `anonymousId`, `challengeDate`, `winnerId`, `loserId` (refs PlaySubmission), `pairKey` (`minId:maxId`), timestamps

Indexes: unique `{ anonymousId: 1, challengeDate: 1, pairKey: 1 }`, `{ challengeDate: 1, createdAt: -1 }`

### PlayVoteRound (bridge-play DB)
Fields: `anonymousId`, `challengeDate`, `roundIndex`, `rankSnapshot` (Map of submissionId → `{ rank, score, displayName }` at round start), `seenSubmissionIds[]`, `votesInRound`, `completed`

Indexes: unique `{ anonymousId: 1, challengeDate: 1, roundIndex: 1 }`

### PlayAccountLink (bridge-play DB)
Fields: `firebaseUid` (indexed), `anonymousId`, timestamps. One row per claimed (account, anonymousId) pair — signing in on a device claims that browser's id; account history queries the union of linked ids. Submissions/votes are never rewritten to the account.

Indexes: unique `{ firebaseUid: 1, anonymousId: 1 }`

### ProctoringSession
Core: `submissionId` (ref Submission, unique index), `token` (indexed), `status` (pending/active/paused/completed/failed)

Consent: `consent` { granted, grantedAt, screens }

Screens: `screens[]` { screenIndex, label, width, height, addedAt }

Frames: `frames[]` { storageKey, screenIndex, capturedAt, sizeBytes, width, height, isDuplicate, clientHash }

Sidecar Events: `sidecarEvents[]` { type (enum: tab_switch/window_blur/window_focus/clipboard_copy/clipboard_paste/url_change/idle_start/idle_end/stream_lost/stream_restored), timestamp, metadata (Mixed) }

Transcript: `transcript` { status (not_started/generating/completed/failed), storageKey, generatedAt, error, frameCount, tokenUsage { prompt, completion, total } }

Video: `videoChunks[]` { storageKey, screenIndex, startTime, endTime, sizeBytes } — screen-0 entries are removed after a successful eager merge; other screens' chunk references stay so multi-monitor recordings remain playable and transcribable. Chunk entries are dedup-guarded on `storageKey` (a client retry of an already-recorded chunk neither duplicates the array entry nor double-counts stats).

Merged recording (screen 0): `mergedVideo` { status (`not_started` / `merging` / `ready` / `failed`), storageKey (typically `{sessionId}/playback.webm`), sizeBytes, durationSeconds, mergedAt, error, chunksDeletedAt, mergingStartedAt }. After **complete**, **submit** (all submit paths), or **opt-out**, the server merges + remuxes chunk WebMs into one file in storage, updates Mongo, then deletes screen-0 chunk objects. The playback/download endpoints also run the merge on demand (idempotent, only once the session is `completed`/`failed`) so an early employer view persists the merged file instead of rebuilding it per request. **Video is never proxied through the API** — those routes only return or redirect to a presigned S3 GET. **Memory rule for this pipeline:** video is never held whole in RAM — chunk uploads land on disk via multer diskStorage, the merge streams chunk → temp file → storage (`storeBlobFromFile`), and transcript frame extraction returns disk-backed lazy frames (`makeDiskBackedFrame`; callers own `PreparedSessionData.cleanup()`). Don't reintroduce `fs.readFile` of merged videos or all-frames-in-an-array collections. Also never write `pipeline(src, out, { end: false })` in a per-chunk loop — pipeline does not detach its error/close/finish/end listeners from a destination it didn't end, so N chunks leak ~4N listeners on one WriteStream (a 470-chunk session leaked ~1,900 and OOMed the 512 MB instance); use the `writeWithBackpressure` helper in `videoMerge.ts`. Chunk reads skip blobs missing from storage rather than aborting the whole merge — Mongo can hold `videoChunks` refs to deleted S3 objects, and a merge that fails permanently means every playback request rebuilds the recording from scratch.

Stats: `stats` { totalFrames, uniqueFrames, duplicatesSkipped, totalSizeBytes, captureStartedAt, captureEndedAt }

Companion: `companion` { status (not_started/active/completed/failed), conversationId, startedAt, endedAt, error } — in-session ElevenLabs voice companion transcript stored as JSONL chunks under storage prefix `{sessionId}/companion/`.

Indexes: `{ submissionId: 1 }` (unique), `{ token: 1 }`, `{ status: 1 }`

### WorkflowCaptureSession / WorkflowEvent / WorkflowFileState (experimental)
Hooks-first AI-workflow capture (see the `/api/workflow-capture` routes).

**WorkflowCaptureSession:** `submissionId` (ref Submission, indexed), `submissionToken` (indexed), `captureToken` (unique, secret — returned once at creation, never in review responses), `candidateName`, `source` (default `claude-code`), `status` (`pending`/`active`/`completed`), `consent` { granted, grantedAt, disclosureVersion }, `startedAt`/`lastEventAt`/`completedAt`, `stats` { totalEvents, promptCount, toolUseCount, payloadBytes }, `environment` { cwd, gitBranch, gitRemote, toolVersion, platform }

**WorkflowEvent:** `sessionId` (ref, indexed), `type` (`session_start`/`user_prompt`/`tool_use`/`tool_result`/`assistant_message`/`session_end`/`notification`), `at`, `seq` (kit-assigned monotonic counter), `toolSessionId`, `toolName`, `text` (prompt/reply/command, capped 20k chars), `payload` (Mixed — tool input/result), `truncated`, `cwd`, `gitBranch`, `receivedAt`. Indexes: **unique `{ sessionId, seq }`** (this is what makes ingest idempotent under kit retries), `{ sessionId, at }`

**WorkflowFileState:** `sessionId` (indexed), `path`, `content` (capped 100k chars), `truncated`, `sizeBytes`, `origin` (`agent` = Write contents, Read results, or Edit results with `originalFile`; `snapshot` = kit scan), `revision`, `updatedAt`. Unique `{ sessionId, path }`. Live code for the companion. An Edit tool_use carries only a diff — ingesting that as an empty file is forbidden (it made the voice companion tell a candidate `server.js` was empty). Contents come from the matching `tool_result` (`originalFile` + old/new strings) or a Read, and the kit snapshot fills in the rest. Snapshot uses `git status` when there is a repo; unzipped starters often have none, so the kit falls back to a bounded project walk.

Events live in their own collection rather than an array on the session — a long session produces thousands, and unbounded subdocument arrays are what OOMed the proctoring pipeline (see `videoChunks` history).

### RepoIndex
Fields: `submissionId` (ref Submission, indexed), `source` (`github`/`upload`), `owner` (indexed, github source), `repo` (indexed, github source), `pinnedCommitSha` (indexed, github source), `uploadSha256` (indexed, upload source), `status` (queued/indexing/ready/failed), `pinecone` { indexName, namespace }, `stats` { fileCount, chunkCount, totalChars, filesSkipped }, `error` { message, stack, at }

Indexes: github partial indexes `{ submissionId: 1, pinnedCommitSha: 1 }`, `{ owner: 1, repo: 1, pinnedCommitSha: 1 }`; upload partial index `{ submissionId: 1, uploadSha256: 1 }`

## AI Provider Configuration

The app uses LangChain to abstract AI providers. You can configure providers globally or per use case:

| Use Case                 | Env Override Key                          | Default Model                         |
|--------------------------|-------------------------------------------|---------------------------------------|
| Assessment generation    | `AI_PROVIDER_ASSESSMENT_GENERATION`       | Varies by provider                    |
| Assessment chat          | `AI_PROVIDER_ASSESSMENT_CHAT`             | Varies by provider                    |

Global default: `AI_PROVIDER` (defaults to `openai`).

Default models per provider:
- OpenAI: `gpt-5.6-luna` (`gpt-5.6-terra` for assessment generation)
- Anthropic: `claude-3-5-sonnet-20241022`
- Gemini: `gemini-1.5-pro`

Per-provider per-use-case model overrides follow the pattern: `{PROVIDER}_MODEL_{USECASE}` (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION=gpt-5.6-sol`).

## Deployment

- **Frontend**: Deployed on **Vercel**. Builds with `vite build` from the `client/` directory. SPA rewrites via `vercel.json`.
- **Backend**: Deployed on **Render**. Runs via `npm start` which executes `tsx src/server.ts`. No Docker. Environment variables set in Render's dashboard.
- **Database**: MongoDB Atlas (cloud).
- **No CI/CD**: No GitHub Actions or automated pipeline configured. Deployments are triggered via Git pushes to Vercel/Render.
- **Stripe webhooks**: Production endpoint is `https://bridge-assessements-1.onrender.com/api/billing/webhook`.

## Code Quality & Config

- **ESLint**: Client-side only (`client/eslint.config.js`, flat config v9+). Lints JSX components and pages. Plugins: react, react-hooks, unused-imports.
- **TypeScript**: Backend runs via `tsx` (no compile step). Frontend uses `jsconfig.json` with path aliases.
- **Tailwind CSS**: Custom theme in `client/tailwind.config.js` with Shadcn UI variables, sidebar variants, accordion animations, dark mode (class strategy).
- **Shadcn UI**: Configured in `client/components.json` with "new-york" style, Lucide icons, CSS variables enabled.
- **No Prettier** config found.

### Bridge design system (`client/`, the assessments app)

The app is styled to match the marketing site at `bridge-jobs.com`: warm monochrome, ink
`#21201C` on white and cream `#FAF9F2`, Inter at weight 500 with negative tracking for
headings, **Geist Mono uppercase** (`0.03em`) for CTA and nav labels. Fonts load from Google
Fonts in [`client/index.html`](client/index.html) — Inter is requested **with its `opsz` axis**,
so `font-optical-sizing: auto` gives the display cut the landing calls "Inter Display".

Three files own the look; change tokens there, not in pages:

| File | Owns |
|---|---|
| [`client/src/index.css`](client/src/index.css) | shadcn CSS variables (warm palette), `h1–h4` weight/tracking, the `.eyebrow` mono label utility |
| [`client/tailwind.config.js`](client/tailwind.config.js) | colour-ramp remap, `fontFamily`, `ink`/`cream`/`paper`, `rounded-card` + `rounded-pill` |
| `client/src/components/ui/` | primitive shapes — pill buttons, card radius, input height |

**Gotcha — the colour ramps are remapped.** In `tailwind.config.js`, `gray` / `slate` /
`zinc` / `neutral` / `stone` **and the cool accents** `blue` / `indigo` / `violet` / `purple` /
`sky` / `cyan` / `teal` all resolve to one warm neutral ramp. Writing `text-blue-600` gets you
warm grey, not blue — that is deliberate, and it is what let ~1,400 pre-existing utilities go
warm without touching JSX. Status colours stay distinguishable but warmed: `red`/`rose`/`pink`
→ brick, `amber`/`yellow` → ochre, `orange` → clay, `green`/`emerald`/`lime` → sage. For a
genuinely new accent, add a named colour rather than reaching for a cool ramp.

`Button` puts Geist Mono uppercase on the CTA-shaped variants (`default`, `secondary`,
`outline`, `destructive`) and deliberately leaves `ghost` and `link` in Inter sentence case —
those back inline table actions and dropdown triggers, where uppercase mono wrecks density.
The one deliberate exception to the monochrome rule is `REGION_COLORS` in
[`BoundingBoxOverlay.jsx`](client/src/components/proctoring/BoundingBoxOverlay.jsx) and
`FrameDebugViewer.jsx`: six proctoring region hues that encode data over screenshots, so they
stay separable (warmed and desaturated, but not collapsed).

## Keeping This File Updated

**This file must be updated whenever any of the following changes are made:**

1. **API routes**: A route is added, removed, or its path/method/auth changes → update "API Routes Summary"
2. **Pages or frontend routes**: A new page is added or routing changes → update "Frontend Architecture" and "Routing"
3. **Port configuration**: Server `PORT` default or Vite config changes → update "Ports and URLs"
4. **Database models**: A model is added or schema fields change → update "Database Models"
5. **External services**: A new integration is added (AI provider, payment, webhook, email) → update "Tech Stack" and relevant sections
6. **Environment variables**: Variables are added or changed → update "Environment Variables"
7. **Deployment**: Hosting targets change → update "Deployment"
8. **Middleware or rate limiting**: New middleware or rate limit rules → update "Rate Limiting" or "Backend Architecture"
9. **Authentication flow**: Auth mechanism changes → update "Authentication Flow"
10. **Directory structure**: Files/folders are added, moved, or removed → update the relevant directory layout
11. **AI provider configuration**: New use cases or providers → update "AI Provider Configuration"
12. **CORS origins**: Allowed origins change → update "Ports and URLs" and the `allowedOrigins` array in `server/src/server.ts`
13. **Prompts**: New AI prompts are added → update "AI Prompts" section
14. **New services or controllers**: Update the backend directory layout and add descriptions
15. **Frontend components**: New components added to `client/src/components/` → update the frontend directory layout
16. **Dependencies**: Major new packages added → update "Tech Stack"

**When in doubt, update this file.** It is the single source of truth for understanding this codebase.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. The
skill has multi-step workflows, checklists, and quality gates that produce better
results than an ad-hoc answer. When in doubt, invoke the skill. A false positive is
cheaper than a false negative.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke /office-hours
- Strategy, scope, "think bigger", "what should we build" → invoke /plan-ceo-review
- Architecture, "does this design make sense" → invoke /plan-eng-review
- Design system, brand, "how should this look" → invoke /design-consultation
- Design review of a plan → invoke /plan-design-review
- Developer experience of a plan → invoke /plan-devex-review
- "Review everything", full review pipeline → invoke /autoplan
- Bugs, errors, "why is this broken", "wtf", "this doesn't work" → invoke /investigate
- Test the site, find bugs, "does this work" → invoke /qa (or /qa-only for report only)
- Code review, check the diff, "look at my changes" → invoke /review
- Visual polish, design audit, "this looks off" → invoke /design-review
- Developer experience audit, try onboarding → invoke /devex-review
- Ship, deploy, create a PR, "send it" → invoke /ship
- Merge + deploy + verify → invoke /land-and-deploy
- Configure deployment → invoke /setup-deploy
- Post-deploy monitoring → invoke /canary
- Update docs after shipping → invoke /document-release
- Weekly retro, "how'd we do" → invoke /retro
- Second opinion, codex review → invoke /codex
- Safety mode, careful mode, lock it down → invoke /careful or /guard
- Restrict edits to a directory → invoke /freeze or /unfreeze
- Upgrade gstack → invoke /gstack-upgrade
- Save progress, "save my work" → invoke /context-save
- Resume, restore, "where was I" → invoke /context-restore
- Security audit, OWASP, "is this secure" → invoke /cso
- Make a PDF, document, publication → invoke /make-pdf
- Launch real browser for QA → invoke /open-gstack-browser
- Import cookies for authenticated testing → invoke /setup-browser-cookies
- Performance regression, page speed, benchmarks → invoke /benchmark
- Review what gstack has learned → invoke /learn
- Tune question sensitivity → invoke /plan-tune
- Code quality dashboard → invoke /health
