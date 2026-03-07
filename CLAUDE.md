# CLAUDE.md - BridgeAI Codebase Reference

## What This App Is

BridgeAI is a technical hiring assessment platform. Employers create take-home coding assessments from job descriptions using AI, share unique links with candidates, and then candidates submit their code via GitHub. After submission, an AI-powered voice interview is conducted using ElevenLabs to evaluate the candidate's understanding of their code. Submissions are scored across multiple dimensions. Employers view results through an analytics dashboard with diff analysis, interview transcripts, and scoring breakdowns.

## Monorepo Structure

```
bridge-assessements/
├── client/          # React frontend (Vite + JSX/TS)
├── server/          # Express.js backend (TypeScript, run via tsx)
├── notebooks/       # Jupyter notebooks (test-assessment-generation.ipynb)
├── package.json     # Root-level shared deps (firebase-admin, express-validator, @vercel/analytics)
└── *.md             # Documentation files
```

The client and server each have their own `package.json` and `node_modules`. They are NOT managed by a workspace tool -- you must install dependencies and run dev commands independently in each directory.

## Ports and URLs

| Service         | Dev URL                          | Production URL                                           |
|-----------------|----------------------------------|----------------------------------------------------------|
| Frontend (Vite) | `http://localhost:5173`          | `https://www.bridge-jobs.com` (Vercel)                   |
| Backend (Express)| `http://localhost:5050`         | `https://bridge-assessements-1.onrender.com` (Render)    |
| Health check    | `http://localhost:5050/health`   | `https://bridge-assessements-1.onrender.com/health`      |
| API base        | `http://localhost:5050/api`      | `https://bridge-assessements-1.onrender.com/api`         |

- The backend port is configured via `PORT` env var (defaults to `5050`).
- The frontend Vite dev server runs on port `5173` by default.
- The client resolves its API base URL in `client/src/config/api.js`: uses `VITE_API_URL` env var if set, otherwise `localhost:5050` in dev mode and the Render URL in production.
- CORS allowed origins are hardcoded in `server/src/server.ts` -- if you add a new frontend domain, update the `allowedOrigins` array there.
- Current allowed CORS origins: `FRONTEND_URL` env var, `https://www.bridge-jobs.com`, two Vercel preview domains, plus `localhost:5173` and `localhost:3000` in dev.

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
- **ElevenLabs React SDK** for voice interview client
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
  - Interview question generation from candidate code (RAG)
  - Interview summary generation from transcripts
  - Base code generation
  - Code change / diff analysis
  - Completeness scoring
- **AI Provider SDKs**: OpenAI (`openai`), Anthropic (`@anthropic-ai/sdk`), Google Gemini (`@google/generative-ai`)
- **Pinecone** vector database for code indexing and retrieval
- **Stripe** for subscription billing (checkout sessions + webhooks)
- **Resend** for sending candidate invitation emails
- **ElevenLabs** webhooks for receiving post-call interview transcripts
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

**AI Providers:**
- `AI_PROVIDER` -- Global default: `openai`, `anthropic`, or `gemini`
- `AI_PROVIDER_ASSESSMENT_GENERATION` / `AI_PROVIDER_ASSESSMENT_CHAT` / `AI_PROVIDER_INTERVIEW_QUESTIONS` / `AI_PROVIDER_INTERVIEW_SUMMARY` -- Per-use-case overrides
- `OPENAI_API_KEY` / `OPENAI_MODEL` -- OpenAI config (default model: `gpt-4o-mini`)
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` -- Anthropic config (default: `claude-3-5-sonnet-20241022`)
- `GEMINI_API_KEY` / `GEMINI_MODEL` -- Gemini config (default: `gemini-1.5-pro`)
- Per-use-case model overrides: `{PROVIDER}_MODEL_{USECASE}` (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION`)

**Vector DB:**
- `PINECONE_API_KEY` / `PINECONE_INDEX_NAME` -- Pinecone vector DB

**Billing:**
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` / `APP_URL` -- Stripe billing

**Voice Interviews:**
- `AGENT_SECRET` -- Authenticates ElevenLabs agent tool requests
- `ELEVENLABS_WEBHOOK_SECRET` -- Verifies ElevenLabs webhook signatures

**Email:**
- `RESEND_API_KEY` -- Resend email service key

**LLM Proxy (cost/budget control):**
- `LLM_PROXY_MAX_COST` -- Max cost in USD per submission (default: 10.00)
- `LLM_PROXY_MAX_TIME` -- Max time in ms (default: 3600000 = 1 hour)
- `REQUIRE_LLM_TRACE` -- Require trace upload before submission (default: true)

**Task Execution:**
- `TASK_EXECUTION_TIMEOUT` -- Task timeout in ms (default: 30000)
- `TASK_MAX_CONCURRENT` -- Max concurrent tasks (default: 5)

**Proctoring / Screen Capture:**
- `PROCTORING_STORAGE_DIR` -- Local storage path for frames/transcripts (default: `./storage/proctoring`)
- `TRANSCRIPT_GENERATION_ENABLED` -- Enable/disable AI transcript generation (default: `true`)
- `PROCTORING_FRAME_INTERVAL_MS` -- Capture interval in ms (default: `5000`)
- `PROCTORING_DEDUP_THRESHOLD` -- Pixel diff threshold for dedup (default: `0.03`)
- `TRANSCRIPT_REGION_BATCH_SIZE` -- Max crops per region before flush (default: `5`)
- `TRANSCRIPT_LAYOUT_REDETECT_INTERVAL` -- Re-detect layout every N frames (default: `90`)
- `TRANSCRIPT_LAYOUT_MAX_PIXELS` -- Max dimension for layout image sent to vision (default: `1280`)
- `TRANSCRIPT_OCR_CACHE_CHANGE_THRESHOLD` -- Thumb-diff threshold for reusing cached OCR (default: `0.6`)
- `TRANSCRIPT_DEBUG_SAVE_CACHE_THUMBS` -- Save cached region thumbs to disk (default: `false`)
- `TRANSCRIPT_DEBUG_CACHE_THUMBS_DIR` -- Directory for debug thumbs (default: `{PROCTORING_STORAGE_DIR}/ocr-cache-thumbs`)
- `TRANSCRIPT_INCREMENTAL_ENABLED` -- Enable sliding-window incremental transcript for active sessions (default: `false`)
- `TRANSCRIPT_INCREMENTAL_INTERVAL_MS` -- Interval for incremental runs in ms (default: `60000`)

### Frontend (`client/.env.local`)
- `VITE_API_URL` -- Override API base URL (optional, auto-detected from mode)
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
│   ├── submission.ts      # Submission schema (token, candidate info, GitHub repo, interview, scores, LLM workflow)
│   ├── repoIndex.ts       # Repository indexing metadata for Pinecone
│   ├── taskConfig.ts      # Task configuration for workflow evaluation
│   └── proctoringSession.ts  # Proctoring session (frames, events, transcript, video chunks)
├── routes/
│   ├── user.ts            # /api/users/* -- create, whoami, delete
│   ├── assessment.ts      # /api/assessments/* -- CRUD + generate + chat
│   ├── submission.ts      # /api/submissions/* -- link generation, token access, submit, interview, scoring
│   ├── billing.ts         # /api/billing/* -- checkout, status, cancel, reactivate, webhook
│   ├── agentTools.ts      # /api/agent-tools/* -- ElevenLabs agent context retrieval
│   ├── webhook.ts         # /webhooks/* -- ElevenLabs post-call webhook
│   ├── llmProxy.ts        # /api/llm-proxy/* -- LLM chat proxy for workflow evaluation
│   └── proctoring.ts      # /api/proctoring/* -- screen capture sessions, frames, transcripts
├── controllers/
│   ├── user.ts            # User creation, login (with tier limits), account deletion
│   ├── assessment.ts      # Assessment CRUD, AI generation, chat
│   ├── submission.ts      # All submission handlers (share links, submissions, interviews, scoring)
│   ├── billing.ts         # Stripe checkout, status, cancel, reactivate, webhook handler
│   ├── webhook.ts         # ElevenLabs post-call transcript processing + summary generation
│   ├── agentTools.ts      # Code context retrieval for ElevenLabs agent (Pinecone search)
│   ├── taskRunner.ts      # Task execution for workflow evaluation
│   └── proctoring.ts      # Proctoring: session CRUD, frame upload, consent, sidecar, transcript generation
├── services/
│   ├── langchainAI.ts     # LangChain abstraction: createChatCompletion(), structured output, provider/model selection
│   ├── assessmentGeneration.ts  # 3-step AI assessment generation (extract reqs → generate → quality review)
│   ├── assessmentChat.ts  # AI chat for assessment editing
│   ├── interviewGeneration.ts  # RAG-based interview question generation + summary generation
│   ├── scoring.ts         # Completeness scoring (requirements matching)
│   ├── assessmentPackage.ts    # ZIP package generation for assessment download
│   ├── email.ts           # Resend email service for candidate invitations
│   ├── repoIndexing.ts    # GitHub repo → Pinecone indexing (download, chunk, embed, upsert)
│   ├── repoRetrieval.ts   # Code chunk retrieval from Pinecone (search, dedup, budget)
│   ├── stripe.ts          # Stripe client initialization (API v2024-12-18.acacia)
│   ├── llmProxy/
│   │   ├── costCalculator.ts  # Token estimation and cost calculation by provider/model
│   │   └── logger.ts          # LLM call logging, budget tracking, trace storage
│   ├── taskRunner/
│   │   └── taskRunner.ts      # Task execution engine (runs tests, captures git diffs)
│   ├── workflowScoring/
│   │   └── workflowScorer.ts  # 5-dimensional workflow scoring (correctness/efficiency/promptQuality/structure/reliability)
│   ├── capture/
│   │   ├── storage.ts       # IFrameStorage interface + LocalFrameStorage impl (S3-ready)
│   │   ├── frameStorage.ts  # Store/retrieve frames and video chunks, update session model
│   │   ├── serverDedup.ts   # SHA-256 hash-based server-side frame deduplication
│   │   └── framePrep.ts     # PreparedSessionData builder (boundary contract for AI module)
│   └── schemas/
│       └── assessmentGeneration.ts  # Zod schemas for assessment generation structured output
├── types/
│   └── assessmentGeneration.ts  # TypeScript types for assessment generation
├── middleware/
│   └── requireSubscription.ts  # Returns 402 if user lacks active subscription
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
│   ├── firebase.ts        # Firebase Admin Auth export
│   ├── github.ts          # parseGithubRepoUrl(), resolvePinnedCommit(), fetchRepoMetadata(), resolveBranchToCommit()
│   ├── embeddings.ts      # generateEmbedding(), generateEmbeddings() -- OpenAI embeddings
│   ├── pinecone.ts        # getPineconeClient(), getPineconeIndex(), upsertVectors(), deleteNamespace(), queryPinecone()
│   ├── repoSnapshot.ts    # downloadAndExtractRepoSnapshot(), cleanupRepoSnapshot()
│   ├── fileUpload.ts      # LLM trace file upload handling (multer)
│   └── validationErrorParser.ts  # Express-validator error formatting
├── prompts/
│   └── index.ts           # All AI prompt templates (see Prompts section below)
├── errors/
│   ├── errors.ts          # CustomError base class (statusCode, message)
│   ├── auth.ts            # AuthError: DECODE_ERROR, TOKEN_NOT_IN_HEADER, INVALID_AUTH_TOKEN
│   ├── internal.ts        # InternalError class
│   ├── proctoring.ts      # ProctoringError class (session/consent/frame/transcript errors)
│   ├── workflow.ts        # WorkflowError class for workflow evaluation errors
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
    ├── backfillInterviewQuestions.ts
    ├── duplicateSubmissionWithTrace.ts
    ├── generateDummyConversation.ts
    ├── listSubmissions.ts
    ├── replaceSubmissionWithGeneratedMarkdown.ts
    ├── replaceTraceWithMarkdown.ts
    ├── seedDummyInterview.ts
    ├── test-assessment-generation.ts
    └── validateMarkdownTrace.ts
```

### API Routes Summary

**User routes** (`/api/users`):
- `POST /create` -- Register new user (auth required)
- `GET /whoami` -- Get current user info / login with tier limits (auth required, strict rate limit: 5/15min)
- `POST /delete` -- Delete account + all data including Pinecone namespaces (auth required)

**Assessment routes** (`/api/assessments`):
- `POST /generate` -- AI-generate assessment from job description (auth required)
- `POST /` -- Create assessment with subscription tier check (auth required)
- `GET /` -- List user's assessments (auth required)
- `GET /:id` -- Get single assessment (auth required)
- `PATCH /:id` -- Update assessment (auth required)
- `DELETE /:id` -- Delete assessment + all submissions + Pinecone data (auth required)
- `POST /:id/chat` -- Chat with AI about assessment (auth required)

**Submission routes** (`/api/submissions`):

*Employer endpoints (auth required):*
- `POST /generate-link` -- Generate candidate share link (returns token + shareLink)
- `POST /bulk-generate-links` -- Bulk generate share links for multiple candidates (up to 100)
- `POST /send-invites` -- Send invitation emails to candidates via Resend
- `GET /assessments/:id/submissions` -- List submissions for assessment
- `DELETE /:submissionId` -- Delete submission
- `POST /:submissionId/generate-interview` -- Generate interview questions (requires indexed repo)
- `POST /:submissionId/index-repo` -- Index GitHub repo into Pinecone
- `GET /:submissionId/repo-index/status` -- Check repo indexing status
- `POST /:submissionId/search-code` -- Search indexed code (debug)
- `POST /:submissionId/execute-tasks` -- Execute workflow evaluation tasks
- `POST /:submissionId/calculate-workflow-scores` -- Calculate 5D workflow scores
- `POST /:submissionId/calculate-scores` -- Calculate completeness + workflow scores

*Candidate endpoints (no auth, token-based):*
- `GET /assessments/public/:id` -- Get public assessment details
- `GET /token/:token` -- Get submission by token
- `POST /token/:token/start` -- Start assessment (pending → in-progress, captures metadata)
- `POST /token/:token/submit` -- Submit code (parses GitHub URL, resolves commit, starts indexing)
- `POST /token/:token/generate-interview` -- Generate interview questions
- `POST /token/:token/opt-out` -- Opt out with reason
- `POST /token/:token/upload-trace` -- Upload LLM interaction trace file (multer)
- `POST /start` -- Start new submission (legacy)
- `PATCH /:id` -- Update submission (auto-save)
- `GET /:id` -- Get submission by ID
- `POST /:id/submit` -- Final submission (legacy)

*Shared endpoints (auth or token):*
- `GET /:submissionId/interview-agent-prompt` -- Get interview agent prompt
- `PATCH /:submissionId/interview-conversation-id` -- Set interview conversation ID

**Billing routes** (`/api/billing`):
- `POST /checkout` -- Create Stripe checkout session (auth required)
- `GET /status` -- Get billing status (auth required)
- `POST /cancel` -- Cancel subscription at period end (auth required)
- `POST /reactivate` -- Reactivate canceled subscription (auth required)
- `POST /webhook` -- Stripe webhook (signature verified, handles checkout.session.completed, subscription.*)

**LLM Proxy routes** (`/api/llm-proxy`):
- `POST /chat` -- LLM chat proxy with cost/time budgeting (no auth, checks submission status)

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

*Employer endpoints (auth required):*
- `POST /sessions/:sessionId/generate-transcript` -- Trigger AI transcript generation
- `GET /sessions/by-submission/:submissionId` -- Get session by submission ID

**Agent tools** (`/api/agent-tools`):
- `POST /get-context` -- ElevenLabs agent retrieves code context from Pinecone (X-Agent-Secret header, max 6 chunks / 16000 chars)

**Webhooks** (`/webhooks`):
- `POST /elevenlabs` -- ElevenLabs post-call transcript webhook (HMAC signature verified, generates summary)

### Rate Limiting (production only, disabled in dev)
- General API: 100 requests / 15 minutes per IP
- Auth endpoints (`/api/users/whoami`): 5 requests / 15 minutes per IP
- Webhooks: 50 requests / 15 minutes per IP

### Raw Body Parsing
Webhook routes (`/webhooks` and `/api/billing/webhook`) use `express.raw()` before `express.json()` to preserve the raw body for HMAC/Stripe signature verification. This is configured in `server.ts`.

### AI Prompts (`server/src/prompts/index.ts`)
- `PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS` -- Extract requirements, infer stack/level from job description
- `PROMPT_GENERATE_ASSESSMENT_COMPONENTS` -- Generate assessment title, description, timeLimit (with few-shot examples)
- `PROMPT_ASSESSMENT_QUALITY_REVIEW` -- Review and validate generated assessment quality
- `PROMPT_ASSESSMENT_CHAT` -- System prompt for AI assistant editing assessments
- `PROMPT_GENERATE_INTERVIEW_QUESTIONS_RETRIEVAL` -- Generate interview questions from RAG code chunks
- `PROMPT_GENERATE_INTERVIEW_SUMMARY` -- Summarize interview transcript
- `PROMPT_INTERVIEW_AGENT` -- System prompt for ElevenLabs voice interview agent
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
│   ├── AssessmentEditor.jsx    # Edit assessment -- title, desc, time, starter files, smart interviewer, share links, bulk invite
│   ├── CandidateAssessment.jsx # Candidate views assessment -- read-only details, start timer, submit GitHub link, opt-out
│   ├── CandidateSubmission.jsx # Shows mock submission data with code review
│   ├── CandidateSubmitted.jsx  # Post-submission -- polls for interview questions, ElevenLabs voice interview
│   ├── SubmissionsDashboard.jsx # Employer views submissions -- stats, filtering, dropoff analysis, interview modal, diff viewer
│   ├── Subscription.jsx        # Billing plans -- Free tier vs Early Access
│   ├── Pricing.jsx             # Public pricing page
│   ├── BillingSuccess.jsx      # Stripe success redirect
│   ├── BillingCancel.jsx       # Stripe cancel redirect
│   ├── CancelSubscription.jsx  # Cancellation form with reason
│   └── Contact.jsx             # Contact/support page
├── api/
│   ├── requests.ts        # Base HTTP client (fetch wrapper: get/post/put/patch/del with error handling)
│   ├── assessment.ts      # Assessment API: create, list, get, update, delete, generate, chat
│   ├── submission.ts      # Submission API: generateLink, bulk, invites, start, submit, interview, optOut, uploadTrace
│   ├── billing.ts         # Billing API: checkout, status, cancel, reactivate
│   ├── user.ts            # User API: verifyUser (whoami), createUser, deleteAccount
│   └── proctoring.ts      # Proctoring API: createSession, grantConsent, uploadFrame, events, complete, video
├── components/
│   ├── auth/AuthModal.jsx              # Email/password sign-in via Firebase, backend verification
│   ├── assessment/
│   │   ├── AISidebar.jsx               # AI chat sidebar for assessment editing (quick action chips)
│   │   ├── AssessmentPanel.jsx         # Assessment display panel
│   │   ├── AssessmentResult.jsx        # Results display after submission
│   │   ├── CandidatePreviewModal.jsx   # Candidate assessment preview modal
│   │   ├── ChatInput.jsx              # Input field for AI chat
│   │   ├── DocumentBlock.jsx          # Reusable content block with edit, auto-resizing textarea
│   │   └── PresetPills.jsx            # Quick preset job descriptions
│   ├── BulkInviteModal.jsx            # 3-step CSV upload wizard: upload → review → success
│   ├── ElevenLabsInterviewClient.jsx  # Voice interview UI (conversation hooks, transcript display)
│   ├── LLMProxyWrapper/LLMClient.ts   # Client-side LLM proxy (routes all LLM calls through backend)
│   ├── proctoring/
│   │   ├── ConsentScreen.jsx          # Consent dialog before screen recording
│   │   ├── ScreenShareSetup.jsx       # Multi-monitor picker UI
│   │   ├── RecordingIndicator.jsx     # Floating red recording badge
│   │   ├── StreamStatusPanel.jsx      # Upload stats panel (frames, uploads, dedup)
│   │   └── ResharePrompt.jsx          # Stream-lost recovery modal
│   └── ui/                             # 60+ Shadcn UI components (auto-generated, rarely edited)
├── config/
│   └── api.js             # API_BASE_URL: VITE_API_URL || localhost:5050 (dev) || Render URL (prod)
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
1. **Employer creates assessment**: Landing page → enters job description → stored in localStorage → CreateAssessment page auto-fills → AI generates assessment (3-step: extract requirements → generate components → quality review) → saves to DB
2. **Employer edits assessment**: AssessmentEditor page → AI chat sidebar for refinements → configure time limit, interview questions, smart interviewer, starter files, custom instructions
3. **Employer shares link**: Generates unique token-based URL for candidate (single or bulk via CSV upload with email invitations via Resend)
4. **Candidate accesses assessment**: Opens token URL → CandidateAssessment page → views read-only details → starts timer (status: pending → in-progress, captures IP/user agent)
5. **Candidate submits code**: Submits GitHub link → backend parses URL, resolves to pinned commit SHA → status: submitted
6. **Code indexing**: Repo is downloaded, chunked (200 lines/chunk, 40 line overlap), embedded via OpenAI, and upserted to Pinecone
7. **Interview questions generated**: AI uses retrieved code context (RAG, topK=8, max 30KB) to generate targeted questions with file anchors
8. **AI voice interview**: CandidateSubmitted page → ElevenLabs voice interview → agent calls `/api/agent-tools/get-context` for real-time code context
9. **Post-call processing**: ElevenLabs sends transcript via webhook → stored on submission → AI generates interview summary
10. **Scoring**: Completeness scoring (requirements matching) + optional 5D workflow scoring (correctness/efficiency/promptQuality/structure/reliability)
11. **Employer reviews**: SubmissionsDashboard → stats, filtering, dropoff analysis, interview modal with transcript + analysis, diff viewer

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
Fields: `userId` (ref User, indexed), `title` (max 200), `description`, `timeLimit` (minutes, min 1), `numInterviewQuestions` (1-4, default 2), `starterFilesGitHubLink`, `interviewerCustomInstructions`, `isSmartInterviewerEnabled` (default true)

### Submission
Core: `token` (unique, indexed), `assessmentId` (ref Assessment, indexed), `candidateName`, `candidateEmail`, `status` (pending/in-progress/submitted/expired/opted-out), `startedAt`, `submittedAt`, `timeSpent` (minutes)

GitHub: `githubLink`, `githubRepo` { owner, repo, refType (commit/branch), ref, pinnedCommitSha }

Interview questions: `interviewQuestions[]` { prompt, anchors[] { path, startLine, endLine }, createdAt }

Interview: `interview` { provider (default: elevenlabs), status (not_started/in_progress/completed/failed), conversationId (sparse indexed), transcript { turns[] { role (agent/candidate), text, startMs, endMs } }, summary, analysis, startedAt, completedAt, updatedAt, error { message, at, raw } }

Scores: `scores` { overall (0-100), completeness { score (0-100), breakdown { requirementsMet, totalRequirements, details } }, calculatedAt, calculationVersion }

Opt-out: `optedOut`, `optOutReason`, `optedOutAt`

Metadata: `metadata` { ipAddress, userAgent }

LLM Workflow: `llmWorkflow` { trace { sessionId (sparse indexed), events[] { timestamp, type (llm_call/tool_call/test_run/file_change), model, provider, prompt, response, tokens { input, output, total }, latency, cost, metadata }, totalTokens, totalCost, totalTime, totalCalls }, taskResults[] { taskId, taskName, status (passed/failed/timeout/error), testResults { passed, failed, total, failures[] }, executionTime, output, gitDiff, fileChanges[] }, scores { correctness (0-40) { breakdown: testPassRate/edgeCaseHandling/reliability, evidence }, efficiency (0-20) { breakdown: costPerTask/timeToGreen/turnEfficiency, evidence }, promptQuality (0-15) { breakdown: clarity/decomposition/feedbackUsage, evidence }, structure (0-20) { breakdown: modularity/configurability/observability/resilience, evidence }, reliability (0-5) { breakdown: failureHandling/safety, evidence }, overall { score (0-100), confidence (0-1), reasonCodes[] } }, evaluation { harnessVersion, tasksCompleted, tasksTotal, startedAt, completedAt } }

Indexes: `{ assessmentId: 1, status: 1 }`, `{ candidateEmail: 1 }`, `{ "interview.conversationId": 1 }` (sparse), `{ "llmWorkflow.trace.sessionId": 1 }` (sparse)

### TaskConfig
Fields: `taskId` (unique, indexed), `taskName`, `description`, `files[]` { path, content (base64), isHidden }, `tests` { command, timeout (default 30000), hiddenTests[] { name, test code } }, `weights` { correctness (40), efficiency (20), promptQuality (15), structure (20), reliability (5) }, `language`, `difficulty` (easy/medium/hard), `estimatedTime`

### ProctoringSession
Core: `submissionId` (ref Submission, unique index), `token` (indexed), `status` (pending/active/paused/completed/failed)

Consent: `consent` { granted, grantedAt, screens }

Screens: `screens[]` { screenIndex, label, width, height, addedAt }

Frames: `frames[]` { storageKey, screenIndex, capturedAt, sizeBytes, width, height, isDuplicate, clientHash }

Sidecar Events: `sidecarEvents[]` { type (enum: tab_switch/window_blur/window_focus/clipboard_copy/clipboard_paste/url_change/idle_start/idle_end/stream_lost/stream_restored), timestamp, metadata (Mixed) }

Transcript: `transcript` { status (not_started/generating/completed/failed), storageKey, generatedAt, error, frameCount, tokenUsage { prompt, completion, total } }

Video: `videoChunks[]` { storageKey, screenIndex, startTime, endTime, sizeBytes }

Stats: `stats` { totalFrames, uniqueFrames, duplicatesSkipped, totalSizeBytes, captureStartedAt, captureEndedAt }

Indexes: `{ submissionId: 1 }` (unique), `{ token: 1 }`, `{ status: 1 }`

### RepoIndex
Fields: `submissionId` (ref Submission, indexed), `owner` (indexed), `repo` (indexed), `pinnedCommitSha` (indexed), `status` (queued/indexing/ready/failed), `pinecone` { indexName, namespace }, `stats` { fileCount, chunkCount, totalChars, filesSkipped }, `error` { message, stack, at }

Indexes: `{ submissionId: 1, pinnedCommitSha: 1 }`, `{ owner: 1, repo: 1, pinnedCommitSha: 1 }`

## AI Provider Configuration

The app uses LangChain to abstract AI providers. You can configure providers globally or per use case:

| Use Case                 | Env Override Key                          | Default Model                         |
|--------------------------|-------------------------------------------|---------------------------------------|
| Assessment generation    | `AI_PROVIDER_ASSESSMENT_GENERATION`       | Varies by provider                    |
| Assessment chat          | `AI_PROVIDER_ASSESSMENT_CHAT`             | Varies by provider                    |
| Interview questions      | `AI_PROVIDER_INTERVIEW_QUESTIONS`         | Varies by provider                    |
| Interview summary        | `AI_PROVIDER_INTERVIEW_SUMMARY`           | Varies by provider                    |

Global default: `AI_PROVIDER` (defaults to `openai`).

Default models per provider:
- OpenAI: `gpt-4o-mini`
- Anthropic: `claude-3-5-sonnet-20241022`
- Gemini: `gemini-1.5-pro`

Per-provider per-use-case model overrides follow the pattern: `{PROVIDER}_MODEL_{USECASE}` (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION=gpt-4o`).

## Deployment

- **Frontend**: Deployed on **Vercel**. Builds with `vite build` from the `client/` directory. SPA rewrites via `vercel.json`.
- **Backend**: Deployed on **Render**. Runs via `npm start` which executes `tsx src/server.ts`. No Docker. Environment variables set in Render's dashboard.
- **Database**: MongoDB Atlas (cloud).
- **No CI/CD**: No GitHub Actions or automated pipeline configured. Deployments are triggered via Git pushes to Vercel/Render.
- **Stripe webhooks**: Production endpoint is `https://bridge-assessements-1.onrender.com/api/billing/webhook`.
- **ElevenLabs webhooks**: Production endpoint is `https://bridge-assessements-1.onrender.com/webhooks/elevenlabs`.

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
