# AGENTS.md - BridgeAI Codebase Reference

## What This App Is

BridgeAI is a technical hiring assessment platform. Employers create take-home coding assessments from job descriptions using AI, share unique links with candidates, and then candidates submit their code via GitHub or a local archive. While the candidate works, an optional in-session ElevenLabs voice companion can capture their reasoning. Submissions are scored across process (how they worked) and behavioral (does the product pass checks) dimensions. Employers view results through an analytics dashboard with recordings, transcripts, and scoring breakdowns.

## Monorepo Structure

```
bridge-assessements/
├── client/          # React frontend (Vite + JSX/TS) — assessments product
├── play/client/     # React frontend — Play consumer app (separate Vercel deploy)
├── play/e2b-template/ # Custom E2B image for Play (Codex + static preview)
├── server/          # Express.js backend (TypeScript, run via tsx) — assessments + /api/play
├── notebooks/       # Jupyter notebooks (test-assessment-generation.ipynb)
├── package.json     # Root-level shared deps (firebase-admin, express-validator, @vercel/analytics)
└── *.md             # Documentation files
```

The client, play/client, play/e2b-template, and server each have their own `package.json` and `node_modules` where applicable. They are NOT managed by a workspace tool -- you must install dependencies and run commands independently in each directory.

## Play product (consumer daily challenge)

Separate promotional product — **not** part of hiring assessments. See [`play/README.md`](play/README.md).

| Piece | Location | Deploy |
|-------|----------|--------|
| Frontend | `play/client/` | Vercel project #2 (root `play/client`), e.g. `play.bridge-jobs.com` |
| API | `server/src/routes/play.ts` | Same Render service as assessments (`/api/play/*`) |
| Database | `bridge-play` on same Atlas cluster | `PLAY_DB_NAME` env var |
| Models | `server/src/models/play/` | Registered on Play Mongoose connection |
| E2B template | `play/e2b-template/` | Custom image `bridge-play-dev` / `bridge-play-v1` (no-cache preview :8080, Codex CLI; no code-server) |

- `PLAY_ENABLED=false` by default — gates feature routes; `GET /api/play/health` is always on.
- Phase A (implemented): daily challenges, `GET /today`, Firebase-gated admin CRUD at `/admin/challenges/*`, Play client `Home` + `/Admin` page, build sessions (`POST/GET /session`) with E2B iframes on `/Build`, submit snapshot (`POST /submit`) + Admin Submissions tab (files + blob preview).
- Codex + token budget: Anthropic-compatible Messages proxy at `/session/:id/llm/v1/messages` (Bearer `llmProxyToken`, meters `tokensUsed` / `tokenBudget`); sandbox provisioned with `ANTHROPIC_BASE_URL` + session token (no user Anthropic login). Build page: desktop defaults to **Chat** mode (chat stream + live preview; toggle to **Studio** for Monaco + chat + preview); mobile (<768px) is always chat-first with change-triggered preview cards and a fullscreen interactive preview. Preference stored in `localStorage` (`playBuildLayout.v1`). Chat relay `POST /session/:id/Codex/message` → `Codex -p` in E2B. Chat + workspace files persist on the session (refresh/resume within the build window; snapshot restore if sandbox dies). **Wall-clock build limit:** `expiresAt = min(startedAt + limit, end of challenge period)` — challenge `timeLimitMinutes` or `PLAY_BUILD_TIME_LIMIT_MINUTES` (default 10). Leaving Build pauses the sandbox; paused sessions do **not** count toward `PLAY_MAX_CONCURRENT_SESSIONS`. Requires `PLAY_LLM_PROXY_PUBLIC_URL` (E2B cannot reach localhost). Server still exposes `/session/:id/terminal*` PTY routes (unused by Build UI). code-server is **removed** from the Play E2B template.
- Admin auth: Firebase + `PLAY_ADMIN_EMAIL` allowlist (default `saaz.m@icloud.com`); looks up assessments `User` by `firebaseUid`.
- No shared models with assessments `Submission`; admin reuses Bridge Firebase accounts.
- Play E2B: build via `cd play/e2b-template && npx tsx build.dev.ts`; smoke with `npx tsx src/scripts/play-sandbox-smoke.ts` from `server/`. The Python preview server sends `Cache-Control: no-store` so live JS/CSS edits cannot be replaced by cached starter assets. Set `PLAY_E2B_TEMPLATE_ID`. Grading still uses the default E2B image.
- **Vote / browse / leaderboard:** public gallery + pairwise five-vote rounds with recap; Bayesian (TrueSkill-style) ranking; date-scoped leaderboard. Must submit same UTC day to vote. Saved submission previews are served by `GET /api/play/preview/:id/:revision/*` (API-origin iframes by default); Build live previews still use E2B. Client toggle: `play/client/src/config/submissionPreview.js` `SUBMISSION_PREVIEW_MODE` (`"api"` | `"blob"`).
## Ports and URLs

| Service         | Dev URL                          | Production URL                                           |
|-----------------|----------------------------------|----------------------------------------------------------|
| Frontend (Vite) | `http://localhost:5173`          | `https://www.bridge-jobs.com` (Vercel)                   |
| Play (Vite)     | `http://localhost:5174`          | `https://play.bridge-jobs.com` (Vercel, root `play/client`) |
| Backend (Express)| `http://localhost:5050`         | `https://bridge-assessements-1.onrender.com` (Render)    |
| Health check    | `http://localhost:5050/health`   | `https://bridge-assessements-1.onrender.com/health`      |
| API base        | `http://localhost:5050/api`      | `https://bridge-assessements-1.onrender.com/api`         |
| Play API        | `http://localhost:5050/api/play` | `https://bridge-assessements-1.onrender.com/api/play`    |

- The backend port is configured via `PORT` env var (defaults to `5050`).
- The frontend Vite dev server runs on port `5173` by default; Play runs on `5174`.
- The client resolves its API base URL in `client/src/config/api.js`: uses `VITE_API_URL` env var if set, otherwise `localhost:5050` in dev mode and the Render URL in production.
- Play client uses `play/client/src/config/api.js` with base `${VITE_API_URL}/api/play`.
- CORS allowed origins are hardcoded in `server/src/server.ts` -- if you add a new frontend domain, update the `allowedOrigins` array there.
- Current allowed CORS origins: `FRONTEND_URL`, `PLAY_FRONTEND_URL`, `https://play.bridge-jobs.com`, `https://www.bridge-jobs.com`, two Vercel preview domains, plus `localhost:5173`, `localhost:5174`, and `localhost:3000` in dev.

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
- **ElevenLabs React SDK** for the in-session voice companion
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
- `OPENAI_API_KEY` / `OPENAI_MODEL` -- OpenAI config (default model: `gpt-4o-mini`)
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` -- Anthropic config (default: `Codex-3-5-sonnet-20241022`)
- `GEMINI_API_KEY` / `GEMINI_MODEL` -- Gemini config (default: `gemini-1.5-pro`)
- Per-use-case model overrides: `{PROVIDER}_MODEL_{USECASE}` (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION`)

**Vector DB:**
- `PINECONE_API_KEY` / `PINECONE_INDEX_NAME` -- Pinecone vector DB

**Behavioral Grading Sandbox:**
- `E2B_API_KEY` -- API key for E2B sandbox execution
- `GRADING_STORAGE_DIR` -- Local directory for behavioral grading artifacts/reports (default: `./storage/grading`)
- `SUBMISSION_UPLOAD_STORAGE_DIR` -- Local directory for uploaded submission archives when not using S3 (default: `./storage/submissions`)
- `SUBMISSION_UPLOAD_STORAGE_BACKEND` -- `s3` or `local`. If unset, S3 is used whenever `SUBMISSION_S3_BUCKET` / `PROCTORING_S3_BUCKET` / `AWS_S3_BUCKET` is set (same durable-storage rule as proctoring). Production must use S3 — Render's disk is ephemeral, and a missing zip breaks runtime setup and behavioral grading.
- `SUBMISSION_S3_BUCKET` -- Optional bucket override for submission zips (default: the proctoring/AWS bucket). Objects are stored under `submissions/{submissionId}/archives/…`
- `SUBMISSION_SOURCE_MODE` -- Allowed candidate submission sources (`both`/`github`/`upload`, default: `both`)
- `SUBMISSION_UPLOAD_MAX_BYTES` -- Max upload bytes accepted by `/api/submissions/token/:token/upload` (default: `104857600`)
- `SUBMISSION_UPLOAD_MAX_EXTRACTED_BYTES` -- Max bytes after archive extraction for indexing/execution (default: `314572800`)
- `SUBMISSION_UPLOAD_MAX_EXTRACTED_FILES` -- Max extracted file count per uploaded archive (default: `20000`)
- `BEHAVIORAL_GRADING_MAX_CONCURRENT` -- Max concurrent behavioral grading jobs (default: `2`)
- `BEHAVIORAL_GRADING_UPLOAD_ENABLED` -- Enable behavioral grading for uploaded archives (default: `true`)

**Runtime setup (post-submit candidate-authored run config):**
- `RUNTIME_SETUP_ENABLED` -- Gate candidate runtime-setup routes and UI (default: disabled)
- `RUNTIME_SETUP_MAX_CONCURRENT` -- Cap on **running or provisioning** setup sandboxes (default: `3`); `paused` boxes are excluded on purpose
- `RUNTIME_SETUP_SANDBOX_TTL_MS` -- Hard cap per live sandbox (default: `1800000` = 30m)
- `RUNTIME_SETUP_IDLE_PAUSE_MS` -- Idle → E2B pause (default: `240000` = 4m); status **and log** polls count as activity
- `RUNTIME_SETUP_INSTALL_TIMEOUT_MS` / `RUNTIME_SETUP_BUILD_TIMEOUT_MS` -- per-step caps
- `RUNTIME_SETUP_RUN_MAX_MS` -- whole-run budget shared by install/build/start/health (default: `900000`). No CPU/memory env knobs: sandbox size is a template property in E2B
- `RUNTIME_SETUP_DENY_EGRESS_AT_RUNTIME` -- After start, lock outbound traffic except `declaredEgressDomains` (default: `true`; requires E2B `updateNetwork`, SDK ≈2.28+)
- `RUNTIME_SETUP_RUNS_PER_HOUR` -- Per-submission run cap (default: `12`)
- `RUNTIME_SETUP_HEALTH_WAIT_MS` -- Poll for app ready after start (default: `90000`)

**Play (consumer daily challenge):**
- `PLAY_ENABLED` -- Gate `/api/play` feature routes (default: disabled); `GET /api/play/health` always on
- `PLAY_DB_NAME` -- Mongo database for Play product (default: `bridge-play`, same Atlas cluster)
- `PLAY_FRONTEND_URL` -- CORS origin for Play Vercel app (e.g. `https://play.bridge-jobs.com`)
- `PLAY_ADMIN_EMAIL` -- Email allowed to manage challenges via `/api/play/admin/*` (default: `saaz.m@icloud.com`)
- `PLAY_E2B_TEMPLATE_ID` -- Custom E2B template for Play sandboxes (default `bridge-play-dev`; build from `play/e2b-template/`)
- `PLAY_MAX_CONCURRENT_SESSIONS` -- Soft cap on **running** (non-paused) Play sessions (default: `5`)
- `PLAY_BUILD_TIME_LIMIT_MINUTES` -- Wall-clock build window from start (default: `10`); overridden by challenge `timeLimitMinutes`; always capped by challenge period end
- `PLAY_LLM_PROXY_PUBLIC_URL` -- Public base URL for the Play LLM proxy that E2B sandboxes can reach (e.g. Render or a tunnel). Required for Codex; sandboxes cannot call `localhost`
- `PLAY_ANTHROPIC_MODEL` -- Optional default model for Codex in Play sandboxes
- `ANTHROPIC_API_KEY` -- Org Anthropic key used by the Play Messages proxy (never written into the sandbox)

**Billing:**
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` / `APP_URL` -- Stripe billing

**In-session voice companion (ElevenLabs):**
- `AGENT_SECRET` -- Authenticates ElevenLabs agent tool requests

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
- Repair unseekable merged recordings (raw concat, no Cues/duration): `npx tsx src/scripts/repairMergedPlaybackVideos.ts` (dry-run default; `--apply` remuxes + overwrites, keeping the original at `{sessionId}/playback-preremux.webm`)
- `TRANSCRIPT_GENERATION_ENABLED` -- Enable/disable AI transcript generation (default: `true`)
- `PROCTORING_FRAME_INTERVAL_MS` -- Capture interval in ms (default: `5000`)
- `PROCTORING_DEDUP_THRESHOLD` -- Pixel diff threshold for dedup (default: `0.03`)
- `TRANSCRIPT_REGION_BATCH_SIZE` -- Max crops per region before flush (default: `5`)
- `TRANSCRIPT_LAYOUT_REDETECT_INTERVAL` -- Re-detect layout every N frames (default: `90`)
- `TRANSCRIPT_LAYOUT_MAX_PIXELS` -- Max dimension for layout image sent to vision (default: `1280`)
- `TRANSCRIPT_OCR_CACHE_CHANGE_THRESHOLD` -- Thumb-diff threshold for reusing cached OCR (default: `0.6`)
- `TRANSCRIPT_DEBUG_SAVE_CACHE_THUMBS` -- Save cached region thumbs to disk (default: `false`)
- `TRANSCRIPT_DEBUG_CACHE_THUMBS_DIR` -- Directory for debug thumbs (default: `{PROCTORING_STORAGE_DIR}/ocr-cache-thumbs`)
- `TRANSCRIPT_INCREMENTAL_ENABLED` -- Enable sliding-window incremental transcript for active sessions (default: `false`). Set to `true` in production so transcript is built during the assessment and submit only finalizes.
- `TRANSCRIPT_INCREMENTAL_INTERVAL_MS` -- Interval for incremental runs in ms (default: `60000`)

### Frontend (`client/.env.local`)
- `VITE_API_URL` -- Override API base URL (optional, auto-detected from mode)
- `VITE_DEFAULT_COMPETITION_SLUG` -- Optional override for the competition slug (overrides [`client/src/config/competition.js`](client/src/config/competition.js) `SINGLE_COMPETITION_SLUG` when set)
- `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID`
- `VITE_ELEVENLABS_AGENT_ID`

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
│   ├── submission.ts      # Submission schema (token, candidate info, GitHub repo, scores)
│   ├── runtimeSetupSession.ts # Ephemeral E2B box for candidate runtime setup / recruiter replay
│   ├── repoIndex.ts       # Repository indexing metadata for Pinecone
│   └── proctoringSession.ts  # Proctoring session (frames, events, transcript, video chunks)
├── routes/
│   ├── user.ts            # /api/users/* -- create, whoami, delete
│   ├── assessment.ts      # /api/assessments/* -- CRUD + generate + chat
│   ├── submission.ts      # /api/submissions/* -- link generation, token access, submit, scoring
│   ├── competition.ts     # /api/competitions/* -- public competition metadata, self-serve join, leaderboard
│   ├── ops.ts             # /api/ops/* -- workload dashboard (OPS_ADMIN_EMAIL)
│   ├── billing.ts         # /api/billing/* -- checkout, status, cancel, reactivate, webhook
│   ├── agentTools.ts      # /api/agent-tools/* -- ElevenLabs agent context retrieval
│   └── proctoring.ts      # /api/proctoring/* -- screen capture sessions, frames, transcripts
├── controllers/
│   ├── user.ts            # User creation, login (with tier limits), account deletion
│   ├── assessment.ts      # Assessment CRUD, AI generation, chat
│   ├── submission.ts      # All submission handlers (share links, submissions, scoring)
│   ├── runtimeSetup.ts    # Candidate/recruiter runtime setup (config, run, pause, finalize, replay)
│   ├── competition.ts     # Public competitions: get by slug, join (creates pending submission), leaderboard
│   ├── ops.ts             # Ops workload aggregation (employer attribution for heavy jobs)
│   ├── billing.ts         # Stripe checkout, status, cancel, reactivate, webhook handler
│   ├── agentTools.ts      # Code context retrieval for ElevenLabs agent (Pinecone search)
│   └── proctoring.ts      # Proctoring: session CRUD, frame upload, consent, sidecar, transcript generation
├── services/
│   ├── langchainAI.ts     # LangChain abstraction: createChatCompletion(), structured output, provider/model selection
│   ├── assessmentGeneration.ts  # 3-step AI assessment generation (extract reqs → generate → quality review)
│   ├── assessmentChat.ts  # AI chat for assessment editing
│   ├── assessmentPackage.ts    # ZIP package generation for assessment download
│   ├── email.ts           # Resend email service for candidate invitations
│   ├── repoIndexing.ts    # GitHub repo → Pinecone indexing (download, chunk, embed, upsert)
│   ├── repoRetrieval.ts   # Code chunk retrieval from Pinecone (search, dedup, budget)
│   ├── stripe.ts          # Stripe client initialization (API v2024-12-18.acacia)
│   ├── behavioralGrading/
│   │   ├── index.ts           # E2B behavioral grading orchestrator + in-process concurrency queue
│   │   ├── planner.ts         # LLM: README → runbook plan (install/test/start)
│   │   ├── runtimeConfigRunbook.ts # Candidate's finalized+verified runtimeConfig → runbook (skips the LLM planner)
│   │   ├── schema.ts          # Zod schemas for runbook
│   │   ├── executor.ts        # Executes runbook commands (optional candidate envVars, secret-scrubbed evidence); saves report JSON; readmeFromSandbox
│   │   ├── extractUiControls.ts # Source-grounded button/textbox/link catalog; UI locators come from here
│   │   ├── judge.ts           # One-shot LLM judge (stdout/source/HTTP seed)
│   │   ├── agentJudge.ts      # Tool-using judge (run_command/read_file in sandbox, then finish)
│   │   └── artifacts.ts       # collectJudgeArtifacts + bashLc helpers
│   ├── runtimeSetup/
│   │   ├── sessions.ts        # Persistent E2B lifecycle (create/pause/resume/run/finalize)
│   │   ├── run.ts             # Candidate runtimeConfig → install/build/start + health
│   │   ├── sandbox.ts         # Long-lived sandbox (does not auto-kill like grader)
│   │   ├── network.ts         # Two-phase egress via updateNetwork
│   │   └── schema.ts          # Zod runtimeConfig + secret redaction helpers
│   ├── play/
│   │   ├── challenges.ts      # Play daily challenge CRUD + UTC today lookup
│   │   ├── sandbox.ts         # Play E2B create/getUrls/kill (custom template)
│   │   ├── sessions.ts        # Create/resume build sessions + response shaping
│   │   ├── submissions.ts     # Snapshot workspace → PlaySubmission (rejects starter-only)
│   │   ├── starterDetection.ts # Heuristics for unchanged / near-empty Play starter
│   │   ├── voting.ts          # Public gallery, pairwise votes, Bayesian ranking, leaderboard
│   │   ├── preview.ts         # Revisioned API-origin submission file previews (path-safe)
│   │   ├── bayesianRating.ts  # TrueSkill-style 1v1 updates + matchmaking heuristic
│   │   ├── ratingConstants.ts # Shared μ/σ defaults + round size caps
│   │   ├── llmProxy.ts        # Anthropic Messages proxy + token budget + Codex -p relay
│   │   ├── claudeProvision.ts # Write Codex settings + ANTHROPIC_BASE_URL/AUTH_TOKEN in sandbox
│   │   ├── workspaceFiles.ts  # List/read/write E2B project files for Monaco sync
│   │   ├── models.ts          # Allowed Codex models / aliases for Play
│   │   ├── terminal.ts        # Multi-PTY bridge (shell/preview; unused by Play Build UI)
│   │   ├── sessionPersist.ts  # Codex chat + workspace snapshot save/restore for resume
│   │   └── index.ts
│   ├── gradingEvidence/
│   │   └── storage.ts         # Artifact storage abstraction for behavioral grading reports/screenshots
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
├── middleware/
│   ├── requireSubscription.ts  # Returns 402 if user lacks active subscription
│   └── requireOpsAdmin.ts      # Firebase + OPS_ADMIN_EMAIL allowlist for /api/ops
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
│       ├── generator.ts   # Orchestrator: batch → vision → stitch → store; parallel region flushes; generateTranscriptIncremental
│       ├── incrementalScheduler.ts # Sliding-window: run incremental transcript for active sessions on interval
│       ├── batcher.ts     # Split frames into vision API batches
│       ├── visionClient.ts # OpenAI GPT-4o-mini vision API calls (detail:high)
│       ├── stitcher.ts    # Merge batch outputs into chronological JSONL; parseTranscriptJsonlToSegments for merge
│       └── manifestInjector.ts  # Inject sidecar events into transcript
└── scripts/               # Utility/migration scripts
    ├── backfillMergedProctoringVideos.ts # Merge legacy WebM chunks → playback.webm + mergedVideo
    ├── repairMergedPlaybackVideos.ts # Re-remux stored playback.webm files that shipped as raw concats (unseekable); dry-run default, --apply backs up original first
    ├── duplicateSubmissionWithTrace.ts
    ├── listSubmissions.ts
    ├── seedCompetition.ts   # Link Mongo Competition slug → assessment (hackathon dashboard)
    ├── seedRuntimeSetupMernDemo.ts # Upsert MERN Notes Board assessment + candidate link; submit folder is demos/runtime-setup-mern
    ├── seedRuntimeSetupPathfinderDemo.ts # Upsert Warehouse Pathfinder (Python A*/TSP) assessment + candidate link; submit folder is demos/runtime-setup-pathfinder
    ├── seedPlayChallenge.ts # Upsert Play daily challenge from play/challenges/*.json
    ├── play-sandbox-smoke.ts # Create Play E2B template sandbox; print preview URL + Codex check
    ├── replaceSubmissionWithGeneratedMarkdown.ts
    ├── replaceTraceWithMarkdown.ts
    ├── behavioral-grading-smoke.ts
 ├── e2b-smoke.ts
    ├── test-assessment-generation.ts
    └── validateMarkdownTrace.ts
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
- `PATCH /:id` -- Update assessment (auth required)
- `DELETE /:id` -- Delete assessment + all submissions + Pinecone data (auth required)
- `POST /:id/chat` -- Chat with AI about assessment (auth required)

**Competition routes** (`/api/competitions`, public):
- `GET /:slug` -- Competition + assessment summary for hackathon dashboard (metadata, rules, dates)
- `POST /:slug/join` -- Self-serve registration: creates a **pending** submission (same as employer generate-link) and returns `token` + `shareLink`; does **not** apply employer free-tier submission limits; stricter rate limit in production (30/hour/IP); duplicate email per assessment returns 409
- `GET /:slug/leaderboard` -- Public leaderboard for submitted candidates (rank by `scores.overall`, then completeness, then workflow overall score); top 50 default, `?limit=` max 100; respects `leaderboardPublic` on the competition document

**Ops routes** (`/api/ops`, Firebase auth + `OPS_ADMIN_EMAIL` allowlist — cross-account):
- `GET /workload` -- Aggregated heavy/risk workload: active merges, transcript generation, pending behavioral/evaluation, large sessions; attributes employer (email/company), assessment, submission, proctoring stats; includes in-process merge/grading queue depths for this Render instance. Query: `hours` (default 24), `limit` (default 80). Not crash telemetry — correlate with Render logs.

**Play routes** (`/api/play`, consumer product — requires `PLAY_ENABLED=true` except health):
- `GET /health` -- Always on; smoke check `{ ok: true, product: "play" }`
- `GET /round` -- Manually selected current round (`isActive: true`); 404 `{ error: "no_active_round" }` if none. `/today` remains a legacy alias. Publishing/dates do not change rounds; use the admin activate endpoint.
- `GET /period` -- `{ cadence, periodKey, periodEndsAt, label }` for clients
- `GET /admin/challenges` -- List challenges (Firebase + `PLAY_ADMIN_EMAIL`; query: `limit`, `from`, `to`, `status`)
- `GET /admin/challenges/:slug` -- Single challenge (admin)
- `POST /admin/challenges` -- Create challenge (admin)
- `PATCH /admin/challenges/:slug` -- Update challenge (admin)
- `POST /session` -- Create or resume E2B build session (`{ anonymousId }`); returns `previewUrl`, `chatMessages`, `expiresAt` (wall-clock build limit); reconnects sandbox or restores `workspaceSnapshot` if box died; provisions Codex `ANTHROPIC_*` + `llmProxyToken`. When running seats are full: **503** `{ code: "session_queue", activeCount, maxConcurrent, estimatedWaitSeconds }` (client waitlist polls)
- `POST /session/:id/pause` -- Pause E2B sandbox while user leaves Build (`{ anonymousId }`); session stays active until end of UTC day
- `POST /session/:id/cancel` -- Abandon build (`{ anonymousId }`): kill sandbox, mark session expired so concurrent seats free; client returns to Shorts home (`/`)
- `POST /session/:id/restart` -- Reset active build to starter once per session (`restartsUsed` max 1; **409** `restart_limit`); clears chat + workspace, reprovisions E2B / refreshes serverless preview; credits unchanged
- `POST /session/:id/resume` -- Resume paused sandbox / keep-alive running box; refresh `previewUrl`
- `GET /session/:id/usage` -- Token meter (`?anonymousId=`) → `{ tokensUsed, tokenBudget, remaining, exhausted }`
- `GET /session/:id/files` -- List workspace files for Monaco (`?anonymousId=`)
- `GET /session/:id/file` -- Read one file (`?anonymousId=&path=`)
- `PUT /session/:id/file` -- Write one file (`{ anonymousId, path, content }`) into E2B; upserts session `workspaceSnapshot`
- `GET /session/:id/workspace-revision` -- Workspace fingerprint for preview refresh (`?anonymousId=`)
- `POST /session/:id/llm/v1/messages` -- Anthropic-compatible Messages proxy for Codex in E2B (Bearer `llmProxyToken`); streams; increments `tokensUsed`; **429** when over `tokenBudget`
- `POST /session/:id/Codex/message` -- Chat relay: run `Codex -p` in sandbox (`{ anonymousId, prompt }`); appends `chatMessages` + refreshes `workspaceSnapshot`; returns stdout text
- `POST /session/:id/terminal` -- Create/resume named E2B PTY (unused by Build UI; kept for possible future use)
- `GET /session/:id/terminals` -- List terminal tabs (`?anonymousId=`)
- `GET /session/:id/terminal/stream` -- SSE PTY output (`?anonymousId=&terminalId=&pid=`)
- `POST /session/:id/terminal/input` -- Send keystrokes to PTY
- `POST /session/:id/terminal/resize` -- Resize PTY
- `POST /submit` -- Snapshot workspace files into `PlaySubmission` (`{ sessionId, anonymousId, displayName }`), mark session submitted, kill sandbox; **400** `{ code: "starter_only" }` if snapshot is still the unchanged / near-empty starter
- `GET /submissions` -- Public gallery list (`challengeDate`, `limit`, `anonymousId`); metadata only (no `files`); includes `previewRevision`
- `GET /submissions/:id` -- Public submission detail (`previewRevision`; optional `includeFiles`, default true; omit `files` when false)
- `PATCH /submissions/:id` -- Owner-rename (`{ displayName, anonymousId? }` + optional Bearer); same ownership as Shorts owner-delete; displayName 1–40 chars
- `GET /preview/:id/:revision` -- Serve stored `index.html` for a submission at immutable `submittedAt` revision (security headers + long cache)
- `GET /preview/:id/:revision/*` -- Serve a stored snapshot asset by exact relative path (same headers); path-safe, skips `.claude`/`.git`/`node_modules`
- `GET /admin/submissions` -- List submissions (admin; query `challengeDate`, `limit`; omits `files`)
- `GET /admin/submissions/:id` -- Full submission including `files` (admin)
- `GET /vote/next` -- Next pairwise pair (`anonymousId`, optional `challengeDate`, `preferId`, `includeFiles` default true); requires same-day submit; returns round counter (`n/5`) + `previewRevision`
- `POST /vote` -- Cast pairwise vote (Bayesian rating update); optional body `includeFiles` (default true); every 5th vote returns round ranking recap; continues until unique pairs run out
- `GET /leaderboard` -- Rankings by conservative Bayesian score `μ−3σ` (`challengeDate`, `limit`, `anonymousId`)

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
- `POST /:submissionId/runtime/preview` -- Recruiter replay: accept a `kind: "replay"` sandbox job for the **finalized** runtime config (auth + ownership); returns quickly (`accepted`) and runs install/build/start in the background. Reuses a `ready`, still-listening box; `{ restart: true }` forces a cold rebuild. **409** if any behavioral grade is in flight in this process — a new replay sandbox must not evict the grading box; warm reconnect is still allowed
- `GET /:submissionId/runtime/preview/status` -- Recruiter poll: session state + redacted config + previewUrl/health (auth + ownership)
- `GET /:submissionId/runtime/preview/logs` -- Recruiter poll: build/runtime logs (`?after=` seq; auth + ownership)
- `POST /:submissionId/runtime/preview/stop` -- Kill the recruiter replay sandbox (auth + ownership)

*Candidate endpoints (no auth, token-based):*
- `GET /assessments/public/:id` -- Get public assessment details
- `GET /token/:token` -- Get submission by token
- `POST /token/:token/start` -- Start assessment (pending → in-progress, captures metadata)
- `POST /token/:token/submit` -- Legacy GitHub URL submit flow (can be disabled via `SUBMISSION_SOURCE_MODE`); accepts late submits within a 5-minute grace period after `timeLimit`, then returns 400 once grace expires
- `POST /token/:token/submit-recording-only` -- Finalize timed-out attempts with proctoring/screen-recording evidence only (no code repo required); marks submission `expired`
- `POST /token/:token/upload` -- Submit code by archive upload (`multipart/form-data`, field `archive`), stores upload metadata, starts indexing, auto-triggers behavioral grading; same 5-minute post-time-limit grace window as GitHub submit
- `POST /token/:token/opt-out` -- Opt out with reason
- `PUT /token/:token/runtime/config` -- Autosave runtime config (feature-gated: `RUNTIME_SETUP_ENABLED`)
- `POST /token/:token/runtime/session` -- Create or resume the setup sandbox (loads snapshot; reconnects paused/running box)
- `POST /token/:token/runtime/restart` -- Kill the current sandbox (if any) and provision a fresh one from the submitted snapshot
- `POST /token/:token/runtime/run` -- Install → build → start using saved config; requires a live setup sandbox (`running`/`paused`); **409** if the environment has not been started; returns previewUrl
- `GET /token/:token/runtime/status` -- Session state + previewUrl + health + last run
- `GET /token/:token/runtime/logs` -- Poll build/runtime logs (`?after=` seq)
- `POST /token/:token/runtime/pause` / `.../resume` -- Idle pause / reconnect
- `POST /token/:token/runtime/finalize` -- Persist config, mark verified, tear down sandbox
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
- `POST /sessions/:sessionId/companion/prompt` -- Get system prompt + spoken opener for the ElevenLabs companion (body: token). `firstMessage` is a post-start briefing (check-in, title-only intro, unzip / Node command); resume is a short welcome-back. Prompt includes standing instructions to help with post-start setup if asked, and to tell the candidate to reshare their entire screen whenever capture drops.
- `POST /sessions/:sessionId/companion/messages` -- Record companion transcript messages (body: token, conversationId?, messages[])
- `GET /sessions/:sessionId/companion/transcript` -- Get persisted companion transcript (query token or auth)

*Employer endpoints (auth required):*
- `POST /sessions/:sessionId/generate-transcript` -- Trigger AI transcript generation
- `GET /sessions/by-submission/:submissionId` -- Get session by submission ID
- `GET /sessions/:sessionId/playback-video` -- Presigned S3 URL only (auth + ownership; never streams WebM)
- `GET /sessions/:sessionId/download-video` -- Same as playback (auth + ownership)

**Workflow capture routes** (`/api/workflow-capture` — always mounted; `WORKFLOW_CAPTURE_ENABLED` is unused):
- Candidate kit ingest (`POST /sessions`, `/events`, `/snapshot`, `/complete`) plus employer review (`GET /sessions/:id`). `both` records **one** movie (proctoring `playback.webm`); kit `POST /video/*` is refused. Classification of that WebM writes `screen_context` after merge. `workflow` has no screen share. Leftover `screen` keeps frames + OCR.

**Agent tools** (`/api/agent-tools`):
- `POST /context` -- Context center for the in-session voice companion (X-Agent-Secret)

### Rate Limiting (production only, disabled in dev)
- General API: 100 requests / 15 minutes per IP (shared across most `/api/*` routes; proctoring and all `/api/shorts` + `/api/play` excluded)
- Proctoring (`/api/proctoring/*`): 8000 requests / 15 minutes per IP (separate limiter; screen capture is high-volume)
- Shorts API (`/api/shorts/*`, `/api/play/*` except preview): 8000 requests / 15 minutes per IP (separate limiter; Build polls + E2B LLM proxy)
- Play preview (`/api/play/preview/*` / `/api/shorts/preview/*`): 3000 requests / 15 minutes per IP (separate limiter; gallery iframe assets)
- Auth endpoints (`/api/users/whoami`): 5 requests / 15 minutes per IP
- Competition join (`POST /api/competitions/:slug/join`): 30 requests / 60 minutes per IP

### Raw Body Parsing
`/api/billing/webhook` uses `express.raw()` before `express.json()` to preserve the raw body for Stripe signature verification. This is configured in `server.ts`.

### AI Prompts (`server/src/prompts/index.ts`)
- `PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS` -- Extract requirements, infer stack/level from job description
- `PROMPT_GENERATE_ASSESSMENT_COMPONENTS` -- Generate assessment title, description, timeLimit (with few-shot examples)
- `PROMPT_GENERATE_BEHAVIORAL_CHECKS` -- Generate stack-agnostic behavioral checks plus default UI/HTTP acceptance specs (agent is the rare leftover)
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
│   ├── CandidateAssessment.jsx # Candidate views assessment -- workspace setup before the timer (Start gated on entire-screen share when recording is required; no skip), then brief + submit local folder upload (auto-zipped client-side), opt-out
│   ├── CandidateSubmission.jsx # Shows mock submission data with code review
│   ├── CandidateSubmitted.jsx  # Post-submission confirmation; CTA into RuntimeSetup when enabled
│   ├── RuntimeSetup.jsx        # Candidate runtime config + one-button "Run project" (provisions if needed) + live preview/logs + Restart environment + Finalize
│   ├── HackathonDashboard.jsx  # Challenge join + dashboard/leaderboard only; marketing landing may live on Framer (slug: `?slug=` > env > `config/competition.js`)
│   ├── OpsDashboard.jsx        # Internal ops workload dashboard (OPS_ADMIN_EMAIL); heavy merge/transcript/grading attribution
│   ├── SubmissionsDashboard.jsx # Employer views submissions -- stats, filtering, dropoff analysis, Review dialog (incl. runtime replay)
│   ├── Subscription.jsx        # Billing plans -- Free tier vs Early Access
│   ├── Pricing.jsx             # Public pricing page
│   ├── BillingSuccess.jsx      # Stripe success redirect
│   ├── BillingCancel.jsx       # Stripe cancel redirect
│   ├── CancelSubscription.jsx  # Cancellation form with reason
│   └── Contact.jsx             # Contact/support page
├── api/
│   ├── requests.ts        # Base HTTP client (fetch wrapper: get/post/put/patch/del; parses JSON error bodies so a user sees `error`/`message`, not the raw payload)
│   ├── assessment.ts      # Assessment API: create, list, get, update, delete, generate, chat
│   ├── submission.ts      # Submission API: generateLink, bulk, invites, start, submit, optOut, uploadTrace
│   ├── runtimeSetup.ts    # Candidate runtime setup + recruiter replay (preview/status/logs/stop)
│   ├── competition.ts     # Public competition API: get by slug, join, leaderboard
│   ├── ops.ts             # Ops workload API (admin allowlist)
│   ├── billing.ts         # Billing API: checkout, status, cancel, reactivate
│   ├── user.ts            # User API: verifyUser (whoami), createUser, deleteAccount
│   └── proctoring.ts      # Proctoring API: createSession, grantConsent, uploadFrame, events, complete, video
├── components/
│   ├── auth/AuthModal.jsx              # Email/password sign-in via Firebase, backend verification
│   ├── assessment/
│   │   ├── AISidebar.jsx               # AI chat sidebar for assessment editing (quick action chips)
│   │   ├── AssessmentPanel.jsx         # Assessment display panel
│   │   ├── AssessmentResult.jsx        # Results display after submission
│   │   ├── AssessmentSetup.jsx        # Pre-timer gate: entire-screen share + voice-companion probe required to enable Start when recording/companion is on; zip/brief wait until start
│   │   ├── CandidatePreviewModal.jsx   # Candidate assessment preview modal
│   │   ├── ChatInput.jsx              # Input field for AI chat
│   │   ├── DocumentBlock.jsx          # Reusable content block with edit, auto-resizing textarea
│   │   └── PresetPills.jsx            # Quick preset job descriptions
│   ├── BulkInviteModal.jsx            # 3-step CSV upload wizard: upload → review → success
│   ├── submissions/
│   │   ├── BehavioralGradingLiveTrace.jsx # Live behavioral-grading progress while grading is pending
│   │   └── RuntimeReplayPanel.jsx     # Recruiter read-only runtime config + finalized-run evidence card + Run project / Restart preview/logs (stops the replay sandbox on unmount)
│   ├── proctoring/
│   │   ├── ConsentScreen.jsx          # Consent dialog before screen recording (no Skip when recording is required)
│   │   ├── ScreenShareSetup.jsx       # Multi-monitor picker UI
│   │   ├── RecordingIndicator.jsx     # Floating red recording badge
│   │   ├── StreamStatusPanel.jsx      # Upload stats panel (frames, uploads, dedup)
│   │   ├── ResharePrompt.jsx          # Stream-lost recovery modal (`required` hides continue-without)
│   │   └── ProctoringCompanionNotch.jsx # In-session ElevenLabs voice companion (mounts after Start; startSession overrides.agent.firstMessage)
│   └── ui/                             # 60+ Shadcn UI components (auto-generated, rarely edited)
├── config/
│   ├── api.js             # API_BASE_URL: VITE_API_URL || localhost:5050 (dev) || Render URL (prod)
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
    ├── apiClient.js
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
2. User signs in via `AuthModal.jsx`: `signInWithEmailAndPassword()` + `verifyUser()` (GET /users/whoami) → redirect to Home
3. Firebase ID token is sent as `Authorization: Bearer <token>` header on all authenticated API calls
4. Server validates token via `verifyAuthToken` middleware using Firebase Admin SDK
5. Server maps Firebase UID to MongoDB User document via `getUserIdFromFirebaseUid()`
6. Auth state checked via `onAuthStateChanged()` in page components; redirects to `/` if not authenticated

### Data Flow: Assessment Lifecycle
1. **Employer creates assessment**: Landing page → enters job description → stored in localStorage → CreateAssessment page auto-fills → AI generates assessment (extract requirements → generate components → quality review → behavioral checks) → saves to DB; manual path calls `generate-behavioral-checks` then create
2. **Employer edits assessment**: AssessmentEditor page → AI chat sidebar for refinements → configure time limit, starter files, custom instructions
3. **Employer shares link**: Generates unique token-based URL for candidate (single or bulk via CSV upload with email invitations via Resend)
4. **Candidate accesses assessment**: Opens token URL → CandidateAssessment page → pre-timer gate (consent + entire-screen share; starter files and the brief stay hidden). When `evidenceMode` records the screen (`both` or leftover `screen`), sharing is mandatory: no skip/continue-without, Start is disabled until they share their entire screen (`displaySurface === "monitor"`, or any share if the browser does not report a surface), and a lost stream must be reshared (no dismiss). The in-session companion tells them to reshare their entire screen on every drop after the timer starts. Observation off (`none`) or leftover `workflow` does not require screen share. Start assessment begins the timer (`in-progress`), downloads the zip, and reveals the assignment
5. **Candidate submits code**: Uploads project folder (client auto-zips) or submits GitHub link → backend stores source metadata (upload archive or pinned commit SHA) → status: submitted
6. **Code indexing**: Repo is downloaded, chunked (200 lines/chunk, 40 line overlap), embedded via OpenAI, and upserted to Pinecone (used by the companion context center's code section when the index is ready)
7. **Scoring**: Combined employer/leaderboard score from available signals — Process (how-they-worked rubric via `evaluationReport`) and Behavioral (E2B check pass rate)
8. **Employer reviews**: SubmissionsDashboard → stats, filtering, dropoff analysis, and the single candidate Review dialog

### Subscription / Billing Flow
1. User clicks upgrade → `POST /api/billing/checkout` creates Stripe Checkout session
2. User completes payment on Stripe-hosted page
3. Stripe sends `checkout.session.completed` webhook → backend updates user's `subscriptionStatus` to `"active"`
4. Subscription changes (cancel, update, expire) come through as Stripe webhooks
5. `requireSubscription` middleware gates paid features, returns 402 if not active
6. `isSubscribed()` checks `user.subscriptionStatus === "active"` (with fallback to legacy nested field)
7. Free tier limits: 1 assessment, 3 submissions. Paid tier: unlimited.

## Database Models

### User
Fields: `firebaseUid` (unique, indexed), `companyName`, `email` (unique, indexed), `companyLogoUrl`

Legacy subscription (nested): `subscription.tier` (free/paid), `subscription.stripeCustomerId`, `subscription.stripeSubscriptionId`, `subscription.subscriptionStatus`, `subscription.currentPeriodEnd`

Current subscription (top-level): `stripeCustomerId` (sparse indexed), `stripeSubscriptionId` (sparse indexed), `subscriptionStatus` (active/canceled/past_due/trialing/incomplete/incomplete_expired/unpaid/null), `currentPeriodEnd`, `cancelAtPeriodEnd`, `cancellationReason`, `cancellationDate`

### Assessment
Fields: `userId` (ref User, indexed), `title` (max 200), `description`, `timeLimit` (minutes, min 1), `starterFilesGitHubLink`, `starterCodeFiles[]` { path, content }, `evidenceMode` (`both` default for new assessments / `none` / leftover `workflow` / leftover `screen`; missing field resolves to `screen`; no env fallback), `behavioralChecks[]` (plain-language observable product behaviors; stack-agnostic), `evaluationCriteria[]` (proctoring/transcript rubric), `evaluationCriteriaGroundings` (optional)

### Competition
Fields: `slug` (unique, lowercase), `assessmentId` (ref Assessment), optional `title` / `description` / `rulesMarkdown` (dashboard copy; title/description fall back to assessment), `registrationOpen`, `competitionStartsAt`, `competitionEndsAt`, `leaderboardPublic` (default true). **Ops:** create an assessment in the app, then insert or update a `Competition` document with that `assessmentId` and share `/HackathonDashboard?slug=<slug>`.

### Submission
Core: `token` (unique, indexed), `assessmentId` (ref Assessment, indexed), `candidateName`, `candidateEmail`, `status` (pending/in-progress/submitted/expired/opted-out), `startedAt`, `submittedAt`, `timeSpent` (minutes)

Code source: `codeSource` (`github`/`upload`), `codeUpload` { storageKey, originalFilename, sizeBytes, sha256, uploadedAt }

GitHub: `githubLink`, `githubRepo` { owner, repo, refType (commit/branch), ref, pinnedCommitSha }

Scores: `scores` { overall (0-100), completeness { score (0-100), breakdown { requirementsMet, totalRequirements, details } }, calculatedAt, calculationVersion }

Opt-out: `optedOut`, `optOutReason`, `optedOutAt`

Metadata: `metadata` { ipAddress, userAgent }

Scores bag may still exist on old docs; Trace/llmWorkflow scoring was removed. Combined ranking uses Screen + Behavioral only.

Behavioral grading: `behavioralGradingStatus` (`pending`/`completed`/`failed`), `behavioralGradingError`, `behavioralGradingReport` (runbook summary, per-check verdict/evidence, artifact keys, timings, sandbox metadata)

Runtime setup: `runtimeConfig` { rootDir, runtime (`auto`/`node20`/`python312` — stored but never read at execution time; not surfaced in either UI), installCommand, buildCommand, startCommand, port, healthPath, executionProfile (`web_server`/`cli_stdout`/`unclear`), envVars[] { key, value, secret }, declaredEgressDomains[] }; `runtimeSetup` { status (`not_started`/`in_progress`/`finalized`), verified, lastRunAt, lastRunResult, finalizedAt, snapshotSha256, evidence { healthOk, healthSummary, port, capturedAt, logTail[] } — captured at finalize so the recruiter panel can show what `Verified` means without booting a sandbox }. Secret env values are write-only (never returned on GET); redacted rows carry `hasValue` so a saved secret is distinguishable from an empty one.

Behavioral grading prefers these commands over the README planner: when setup is `finalized` and `verified`, `services/behavioralGrading/runtimeConfigRunbook.ts` maps the config onto a runbook (candidate `envVars` + `PORT` applied to every step), the LLM planner call is skipped, and the report carries `runbookSource: "candidate_config" | "llm"` plus `runbookFallbackReason` when the candidate config failed to come up and grading re-planned from the README.

Indexes: `{ assessmentId: 1, status: 1 }`, `{ assessmentId: 1, candidateEmail: 1 }`, `{ candidateEmail: 1 }`

### RuntimeSetupSession
Ephemeral E2B box for candidate setup (`kind: setup`) or recruiter replay (`kind: replay`). Durable record is `Submission.runtimeConfig` + the stored code snapshot.

Fields: `submissionId` (indexed), `token`, `kind` (`setup`/`replay`), `e2bSandboxId`, `status` (`provisioning`/`running`/`paused`/`dead`), `runPhase`, `repoPath`, `port`, `previewUrl`, `health`, `startedAt`, `lastActiveAt`, `pausedAt`, `error`, `logLines[]`, `codeLoaded`

Indexes: unique `{ submissionId: 1, kind: 1 }`

Status **and** log polls bump `lastActiveAt` so a watched preview is not idle-paused; `logLines` survive resume (only an explicit restart clears them); a recruiter re-`Run` on a `ready` session reuses the warm box, and cold rebuild is the panel's separate **Restart**.

### PlayChallenge (bridge-play DB)
Fields: `slug` (unique, lowercase `a-z0-9-`), `challengeDate` (unique, `YYYY-MM-DD` UTC), `title` (max 120), `prompt`, `tokenBudget`, `timeLimitMinutes` (optional), `category` (`widget`/`game`/`tool`/`other`), `status` (`draft`/`published`)

Indexes: unique on `slug`, unique on `challengeDate`, `{ status: 1, challengeDate: -1 }`

### PlayBuildSession (bridge-play DB)
Fields: `anonymousId` (indexed), `challengeSlug`, `challengeDate` (`YYYY-MM-DD`), `status` (`provisioning`/`active`/`failed`/`expired`/`submitted`), `e2bSandboxId`, `previewUrl`, `vscodeUrl` (legacy; unused by Monaco Build UI), `tokenBudget`, `tokensUsed` (default 0), `llmProxyToken` (Bearer for Messages proxy; never returned to browser), `llmCalls` (optional counter), `startedAt`, `expiresAt` (wall-clock build limit: `min(startedAt + timeLimit, end of UTC day)`), `chatMessages[]` `{ role, text, createdAt }` (persisted Codex chat), `workspaceSnapshot[]` `{ path, content }` + `workspaceSnapshotAt` (file backup for sandbox recreate), `sandboxPaused` (bool; paused sessions excluded from concurrent cap), `error` (optional)

Indexes: `{ anonymousId: 1, challengeDate: 1, status: 1 }`

**Resume:** same `anonymousId` + challenge day reconnects the E2B sandbox when alive (or **paused** — connect resumes it); if the box is gone, a new sandbox is provisioned on the **same** session document and `workspaceSnapshot` is restored. Leaving Build pauses the sandbox after a short idle (`POST …/pause`); returning resumes it (`POST …/resume`). Auto-timeout also pauses (not kills) via E2B `lifecycle.onTimeout=pause`. Codex chat survives refresh via `chatMessages`. Wall-clock build countdown until `expiresAt`; after that the session is expired and the sandbox is killed.

### PlaySubmission (bridge-play DB)
Fields: `anonymousId` (indexed), `displayName` (max 40), `challengeSlug`, `challengeDate`, `sessionId`, `files[]` `{ path, content }`, `fileCount`, `totalBytes`, `submittedAt`, Bayesian rating: `ratingMean` (μ, default 25), `ratingDeviation` (σ, default 25/3), `rankingScore` (μ−3σ), `wins`, `losses`, `matches`

Indexes: unique `{ anonymousId: 1, challengeDate: 1 }`, `{ challengeDate: -1, submittedAt: -1 }`, `{ challengeDate: 1, rankingScore: -1 }`

### PlayVote (bridge-play DB)
Fields: `anonymousId`, `challengeDate`, `winnerId`, `loserId` (refs PlaySubmission), `pairKey` (`minId:maxId`), timestamps

Indexes: unique `{ anonymousId: 1, challengeDate: 1, pairKey: 1 }`, `{ challengeDate: 1, createdAt: -1 }`

### PlayVoteRound (bridge-play DB)
Fields: `anonymousId`, `challengeDate`, `roundIndex`, `rankSnapshot` (Map of submissionId → `{ rank, score, displayName }` at round start), `seenSubmissionIds[]`, `votesInRound`, `completed`

Indexes: unique `{ anonymousId: 1, challengeDate: 1, roundIndex: 1 }`


### ProctoringSession
Core: `submissionId` (ref Submission, unique index), `token` (indexed), `status` (pending/active/paused/completed/failed)

Consent: `consent` { granted, grantedAt, screens }

Screens: `screens[]` { screenIndex, label, width, height, addedAt }

Frames: `frames[]` { storageKey, screenIndex, capturedAt, sizeBytes, width, height, isDuplicate, clientHash }

Sidecar Events: `sidecarEvents[]` { type (enum: tab_switch/window_blur/window_focus/clipboard_copy/clipboard_paste/url_change/idle_start/idle_end/stream_lost/stream_restored), timestamp, metadata (Mixed) }

Transcript: `transcript` { status (not_started/generating/completed/failed), storageKey, generatedAt, error, frameCount, tokenUsage { prompt, completion, total } }

Video: `videoChunks[]` { storageKey, screenIndex, startTime, endTime, sizeBytes } — cleared after a successful eager merge.

Merged recording (screen 0): `mergedVideo` { status (`not_started` / `merging` / `ready` / `failed`), storageKey (typically `{sessionId}/playback.webm`), sizeBytes, durationSeconds, mergedAt, error, chunksDeletedAt, mergingStartedAt }. After **complete**, **submit** (all submit paths), or **opt-out**, the server merges + remuxes chunk WebMs into one file in storage, updates Mongo, then deletes per-chunk objects. The remux (`playbackRemux.ts`) is EBML-segment-aware: a recording is often several MediaRecorder sessions back to back (each restart writes a fresh EBML header and resets timestamps to 0), plain `ffmpeg -c copy` on that byte-concat fails with non-monotonic dts, and the old fallback shipped the raw concat — a file with no duration and no Cues that the Review player cannot seek (an evidence-chip jump from Summary stalled on a black frame until a page reload). It now splits at EBML header offsets and feeds the segments to ffmpeg's concat demuxer, which re-stamps timestamps; `repairMergedPlaybackVideos.ts` retrofits already-stored broken files.

Stats: `stats` { totalFrames, uniqueFrames, duplicatesSkipped, totalSizeBytes, captureStartedAt, captureEndedAt }

Companion: `companion` { status (not_started/active/completed/failed), conversationId, startedAt, endedAt, error } — in-session ElevenLabs voice companion transcript stored as JSONL chunks under storage prefix `{sessionId}/companion/`.

Indexes: `{ submissionId: 1 }` (unique), `{ token: 1 }`, `{ status: 1 }`

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
- OpenAI: `gpt-4o-mini`
- Anthropic: `Codex-3-5-sonnet-20241022`
- Gemini: `gemini-1.5-pro`

Per-provider per-use-case model overrides follow the pattern: `{PROVIDER}_MODEL_{USECASE}` (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION=gpt-4o`).

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
