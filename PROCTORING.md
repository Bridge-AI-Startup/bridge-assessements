# Proctoring / Screen Capture Feature

## Overview

The proctoring feature captures a candidate's screen during a coding assessment via browser `getDisplayMedia` APIs, takes periodic screenshots, and after the session generates a raw visual transcript using OpenAI's vision API (GPT-4o-mini). The transcript is stored as JSONL and can be fed to a separate analysis step.

**Key design decisions:**
- **Storage**: Local filesystem abstracted behind an `IFrameStorage` interface so it can be swapped to S3 later. Storage keys follow S3 conventions: `{sessionId}/frames/{ts}-{screenIndex}.png`
- **AI isolation**: All AI/VLM code lives in `server/src/ai/transcript/` -- nothing outside `ai/` imports from it except a single dynamic import in `controllers/proctoring.ts`
- **Optional**: Proctoring is opt-in. Candidates see a consent screen before starting. Declining starts the assessment normally without any recording.

---

## Architecture

### Data Flow

```
Candidate Browser                         Server
==================                        ======

1. ConsentScreen shown
   |
2. User grants consent
   |-- getDisplayMedia() ------------>
   |   (browser share picker)
   |
3. Proctoring session created -------> POST /api/proctoring/sessions
   |                                      -> ProctoringSession doc in MongoDB
   |
4. Consent granted ------------------> POST /api/proctoring/sessions/:id/consent
   |                                      -> session.status = "active"
   |
5. Every 5 seconds:
   |-- captureFrameFromStream()
   |-- computePixelDiff() (dedup)
   |-- queue frame blob
   |
6. Every 10 seconds:
   |-- flush frame queue ------------> POST /api/proctoring/sessions/:id/frames
   |   (FormData with PNG blob)           -> stored in storage/proctoring/{id}/frames/
   |                                      -> session.frames[] updated
   |
7. Every 10 seconds:
   |-- flush sidecar events ---------> POST /api/proctoring/sessions/:id/events
   |   (blur/focus/copy/paste)            -> session.sidecarEvents[] updated
   |
8. Every 30 seconds:
   |-- MediaRecorder chunk ----------> POST /api/proctoring/sessions/:id/video
   |   (WebM video chunk)                -> stored in storage/proctoring/{id}/video/
   |
9. On submit:
   |-- final flush
   |-- complete session -------------> POST /api/proctoring/sessions/:id/complete
                                          -> session.status = "completed"

10. Employer triggers transcript ----> POST /api/proctoring/sessions/:id/generate-transcript
                                          -> frames loaded from storage
                                          -> batched through GPT-4o-mini vision
                                          -> JSONL transcript stored
                                          -> sidecar events injected
```

### File Map

```
Server (14 new files)
=====================
server/src/
├── models/proctoringSession.ts          # Mongoose model
├── routes/proctoring.ts                 # Express router (11 endpoints)
├── controllers/proctoring.ts            # Request handlers
├── validators/proctoringValidation.ts   # express-validator arrays
├── errors/proctoring.ts                 # ProctoringError class
├── services/capture/
│   ├── storage.ts                       # IFrameStorage interface + LocalFrameStorage
│   ├── frameStorage.ts                  # Store/retrieve frames, update model
│   ├── serverDedup.ts                   # SHA-256 hash-based dedup
│   └── framePrep.ts                     # PreparedSessionData (boundary contract for AI)
├── ai/transcript/
│   ├── generator.ts                     # Orchestrator: prep → batch → vision → stitch → store
│   ├── batcher.ts                       # Split frames into vision API batches
│   ├── visionClient.ts                  # GPT-4o-mini vision calls (detail:high)
│   ├── stitcher.ts                      # Merge batch outputs into JSONL
│   └── manifestInjector.ts              # Inject sidecar events into transcript
└── prompts/index.ts                     # + PROMPT_TRANSCRIPT_SYSTEM

Client (11 new files)
=====================
client/src/
├── api/proctoring.ts                    # API calls (FormData for frames, JSON for events)
├── hooks/
│   ├── useScreenCapture.js              # getDisplayMedia stream lifecycle
│   ├── useScreenshotCapture.js          # Canvas-based PNG extraction at intervals
│   ├── useFrameDedup.js                 # Client-side pixel-diff dedup
│   └── useFrameUpload.js               # Batched upload with retry + flush
├── lib/captureUtils.js                  # Pure utils: capture, diff, resize, MediaRecorder
└── components/proctoring/
    ├── ConsentScreen.jsx                # Consent dialog
    ├── ScreenShareSetup.jsx             # Multi-monitor picker
    ├── RecordingIndicator.jsx           # Floating red recording badge
    ├── StreamStatusPanel.jsx            # Upload stats panel
    └── ResharePrompt.jsx               # Stream-lost recovery modal

Modified (6 files)
==================
server/src/server.ts                     # Route registration + rate limiter
server/src/errors/index.ts               # Export ProctoringError
server/src/prompts/index.ts              # PROMPT_TRANSCRIPT_SYSTEM
client/src/pages/CandidateAssessment.jsx # Full proctoring integration
server/config.env.example                # 4 new env vars
CLAUDE.md                                # Documentation updates
```

---

## API Endpoints

### Candidate Endpoints (token-based, no Firebase auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/proctoring/sessions` | Create proctoring session for a submission token |
| `POST` | `/api/proctoring/sessions/:sessionId/consent` | Grant screen recording consent |
| `POST` | `/api/proctoring/sessions/:sessionId/frames` | Upload a single frame (multer, FormData) |
| `POST` | `/api/proctoring/sessions/:sessionId/frames/batch` | Batch frame upload (not yet implemented) |
| `POST` | `/api/proctoring/sessions/:sessionId/events` | Record sidecar events (JSON body) |
| `POST` | `/api/proctoring/sessions/:sessionId/complete` | Mark session as completed |
| `POST` | `/api/proctoring/sessions/:sessionId/video` | Upload video chunk (multer, FormData) |

### Shared Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/proctoring/sessions/:sessionId` | Get session details |
| `GET` | `/api/proctoring/sessions/:sessionId/transcript` | Get JSONL transcript content |

### Employer Endpoints (Firebase auth required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/proctoring/sessions/:sessionId/generate-transcript` | Trigger AI transcript generation |
| `GET` | `/api/proctoring/sessions/by-submission/:submissionId` | Look up session by submission |

---

## Database Model: ProctoringSession

One session per submission (unique index on `submissionId`).

```
submissionId    ObjectId (ref Submission, unique index)
token           String (indexed)
status          "pending" | "active" | "paused" | "completed" | "failed"

consent {
  granted       Boolean
  grantedAt     Date
  screens       Number (how many screens shared)
}

screens[] {
  screenIndex   Number
  label         String (e.g., "Built-in Retina Display")
  width         Number
  height        Number
  addedAt       Date
}

frames[] {
  storageKey    String (e.g., "{sessionId}/frames/1706123456789-0.png")
  screenIndex   Number
  capturedAt    Date
  sizeBytes     Number
  width         Number
  height        Number
  isDuplicate   Boolean
  clientHash    String
}

sidecarEvents[] {
  type          "tab_switch" | "window_blur" | "window_focus" |
                "clipboard_copy" | "clipboard_paste" | "url_change" |
                "idle_start" | "idle_end" | "stream_lost" | "stream_restored"
  timestamp     Date
  metadata      Mixed
}

transcript {
  status        "not_started" | "generating" | "completed" | "failed"
  storageKey    String
  generatedAt   Date
  error         String
  frameCount    Number
  tokenUsage    { prompt, completion, total }
}

videoChunks[] {
  storageKey    String
  screenIndex   Number
  startTime     Date
  endTime       Date
  sizeBytes     Number
}

stats {
  totalFrames        Number
  uniqueFrames       Number
  duplicatesSkipped  Number
  totalSizeBytes     Number
  captureStartedAt   Date
  captureEndedAt     Date
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROCTORING_STORAGE_DIR` | `./storage/proctoring` | Local directory for frames, video, transcripts |
| `TRANSCRIPT_GENERATION_ENABLED` | `true` | Enable/disable AI transcript generation |
| `PROCTORING_FRAME_INTERVAL_MS` | `5000` | Capture interval in milliseconds |
| `PROCTORING_DEDUP_THRESHOLD` | `0.03` | Pixel diff threshold (0.0-1.0) for client-side dedup |

---

## Implementation Stages

The feature was built in 12 incremental stages, each independently verifiable:

### Stage 1: Model & Routes (Stubs)
Created the Mongoose model, ProctoringError class, express-validator arrays, controller stubs (all returning 501), Express router with 11 endpoints, and registered routes in `server.ts`.

### Stage 2: Basic Screen Capture
Created `captureUtils.js` (pure utility functions for OffscreenCanvas capture, pixel-diff, size enforcement, MediaRecorder), `useScreenCapture.js` (manages getDisplayMedia streams), `ConsentScreen.jsx` (consent dialog with checkbox), and `RecordingIndicator.jsx` (floating red badge). Modified `CandidateAssessment.jsx` to show consent screen when "Start Assessment" is clicked -- accepting triggers browser share picker, declining starts without proctoring.

### Stage 3: Screenshot Extraction
Created `useScreenshotCapture.js` -- every 5 seconds, draws each stream to an OffscreenCanvas, exports as PNG blob, and pushes to a frame queue. Frames are drained via `consumeFrames()`.

### Stage 4: Upload Pipeline
Created `client/src/api/proctoring.ts` (API layer using raw `fetch()` with FormData for frames, JSON helpers for other endpoints), `useFrameUpload.js` (batched upload every 10s with exponential backoff retry, max 3 attempts), `server/src/services/capture/storage.ts` (IFrameStorage interface + LocalFrameStorage implementation), and `server/src/services/capture/frameStorage.ts` (stores frames to disk and updates session document). Fleshed out controller methods: `createSession`, `grantConsent`, `uploadFrame`, `completeSession`, `getSession`, `getSessionBySubmission`. Added multer middleware (25MB for frames, 50MB for video) to routes.

### Stage 5: Multi-Monitor
Created `ScreenShareSetup.jsx` -- a step-by-step UI to add multiple getDisplayMedia streams. The `useScreenCapture.js` hook already supports multiple streams via `addStream()`, and `useScreenshotCapture.js` iterates all streams.

### Stage 6: Client-Side Dedup
Created `useFrameDedup.js` -- compares each new frame against the last accepted frame per screen using `computePixelDiff()` on downscaled 64x64 thumbnails. Frames with < 3% pixel difference are skipped.

### Stage 7: Server-Side Frame Prep
Created `serverDedup.ts` (SHA-256 hash-based secondary dedup) and `framePrep.ts` (builds `PreparedSessionData` -- the boundary contract between the capture services and the AI module). `prepareSessionForTranscript()` loads non-duplicate frames from storage, sorts chronologically, and includes sidecar events.

### Stage 8: AI Transcript Generation
Created the full `server/src/ai/transcript/` module:
- **generator.ts**: Orchestrator that coordinates the pipeline: prep session data -> batch frames -> process through vision API -> stitch outputs -> inject sidecar events -> store JSONL
- **batcher.ts**: Splits frames into batches of ~5 (reduced to 3 for 4K+ frames)
- **visionClient.ts**: Singleton OpenAI client calling GPT-4o-mini with `detail: 'high'`, 16384 max_tokens
- **stitcher.ts**: Merges batch JSONL outputs into one chronological transcript
- **manifestInjector.ts**: Inserts sidecar event annotations at correct timestamps

Added `PROMPT_TRANSCRIPT_SYSTEM` to `prompts/index.ts` -- instructs the model to be a raw observer outputting JSONL with character-level text accuracy.

Fleshed out `generateSessionTranscript` controller to dynamically import from the AI module (maintaining the isolation boundary).

### Stage 9: Sidecar Capture
Added a `useEffect` in `CandidateAssessment.jsx` that listens for `blur`, `focus`, `visibilitychange`, `copy`, and `paste` events, buffers them in a ref, and flushes every 10 seconds via `recordSidecarEvents()` API call. Fleshed out the `recordSidecarEvents` controller to validate token and `$push` events to the session document.

### Stage 10: Resilience
Created `ResharePrompt.jsx` (stream-lost recovery modal) and `StreamStatusPanel.jsx` (upload stats display). Added stream lost/restored callback handlers that record sidecar events and show/hide the reshare prompt. Added `beforeunload` handler to flush remaining frames on page close.

### Stage 11: Video Recording
Wired up `createVideoRecorder` from `captureUtils.js` in `CandidateAssessment.jsx`. A `useEffect` starts a MediaRecorder (WebM/VP9, 1Mbps, 30s timeslice) for each active stream. Video chunks are uploaded via `uploadVideoChunk` API as they arrive. The server stores them via `storeVideoChunk` in `frameStorage.ts`.

### Stage 12: Documentation
Updated `CLAUDE.md` with all new backend/frontend files, API routes, ProctoringSession model, environment variables, and AI prompt. Updated `config.env.example` with the 4 new proctoring env vars.

---

## Key Patterns Followed

| Pattern | Source | How Reused |
|---------|--------|------------|
| Controller structure | `controllers/submission.ts` | `RequestHandler`, try/catch/next, `validationErrorParser` |
| Route registration | `server.ts` | `apiLimiter` before routes, console.log after |
| Mongoose model | `models/submission.ts` | `timestamps:true`, `Schema.index()`, `export default` |
| Validators | `validators/submissionValidation.ts` | `.bail()` chaining, exported arrays |
| Custom errors | `errors/workflow.ts` | Static instances, extends `CustomError` |
| OpenAI SDK | `utils/embeddings.ts` | Singleton `getOpenAIClient()` (NOT LangChain) |
| File uploads | `utils/fileUpload.ts` | `multer.memoryStorage()`, multipart skips JSON parsing |
| Client API (token) | `api/submission.ts` | No auth header, FormData for files, `handleAPIError` |
| Hooks | `hooks/use-mobile.jsx` | `useState` + `useEffect`, cleanup on unmount |
| Components | `components/BulkInviteModal.jsx` | Shadcn UI, Framer Motion, Lucide icons |

---

## Storage Layout

```
storage/proctoring/
└── {sessionId}/
    ├── frames/
    │   ├── 1706123456789-0.png    # timestamp-screenIndex
    │   ├── 1706123461789-0.png
    │   └── ...
    ├── video/
    │   ├── 1706123456789-0.webm   # timestamp-screenIndex
    │   └── ...
    └── transcript.jsonl           # Final AI-generated transcript
```

## Transcript Format (JSONL)

Each line is a JSON object representing a distinct activity period:

```jsonl
{"ts":"2024-01-15T10:30:00.000Z","ts_end":"2024-01-15T10:30:15.000Z","screen":0,"description":"VS Code is open with file src/App.tsx on line 42. The candidate is writing a useEffect hook..."}
{"ts":"2024-01-15T10:30:15.000Z","screen":0,"description":"[EVENT] Candidate switched browser tabs"}
{"ts":"2024-01-15T10:30:16.000Z","ts_end":"2024-01-15T10:30:25.000Z","screen":0,"description":"Chrome browser showing Stack Overflow page: 'React useEffect cleanup function'..."}
```

---

## Verification Checklist

1. Start server + client dev servers
2. Open candidate assessment URL -> consent screen appears
3. Grant consent -> browser share picker -> red recording indicator
4. Work for 30s -> frames upload to `storage/proctoring/{sessionId}/frames/`
5. StreamStatusPanel shows captured/uploaded counts
6. Submit assessment -> flush remaining frames -> session marked complete
7. As employer, trigger transcript generation -> JSONL produced in storage
8. Sidecar events (tab switches, copy/paste) appear in transcript
9. Stream drop mid-session -> ResharePrompt appears -> reshare works
10. All existing assessment functionality unchanged when proctoring is declined
