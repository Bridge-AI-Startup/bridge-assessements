# Video Proctoring System — How It Works

A concise guide to the full flow: session → capture → storage → transcript → refine → interpret.

---

## 1. Session lifecycle

| Step | API | What happens |
|------|-----|--------------|
| **Create** | `POST /api/proctoring/sessions` | Client sends submission `token`. Server creates a **ProctoringSession** (or returns existing) with `status: "pending"`. |
| **Consent** | `POST .../consent` | Client sends `token` + `screens`. Server sets `consent.granted`, `consent.grantedAt`, and **`status: "active"`**. Only after this can frames/video be uploaded. |
| **Complete** | `POST .../complete` | Client calls when recording stops. Server sets **`status: "completed"`**. |

The **ProctoringSession** document (MongoDB) stores: `submissionId`, `token`, `status`, `consent`, `screens`, `frames[]`, `sidecarEvents[]`, `videoChunks[]`, `transcript` (status, storageKey, refinedStatus, generationId, lastIncrementalAt, etc.), and `stats` (totalFrames, uniqueFrames, captureStartedAt, captureEndedAt).

---

## 2. Capture (client → server)

Two capture paths:

### Video (primary)

- Client uses `getDisplayMedia()` and records with **MediaRecorder** (WebM).
- Chunks are sent to `POST .../sessions/:sessionId/video` (FormData with token + chunk blob).
- Server calls **`storeVideoChunk`**: writes to storage as `{sessionId}/video/{ts}-{screenIndex}.webm` and appends to `session.videoChunks[]`.

### Screenshots (fallback)

- If video isn't used or fails, client captures canvas frames at an interval (with optional pixel-diff dedup) and uploads to `POST .../sessions/:sessionId/frames`.
- Server calls **`storeFrame`**: writes PNG as `{sessionId}/frames/{ts}-{screenIndex}.png`, appends to `session.frames[]`, and updates `stats` (totalFrames, totalSizeBytes, captureStartedAt/EndedAt).

**Sidecar events** (tab_switch, blur, focus, copy, paste, etc.) go to `POST .../events` and are stored in `session.sidecarEvents[]`.

**Storage** is behind **IFrameStorage**: **LocalFrameStorage** (default, under `PROCTORING_STORAGE_DIR`) or **S3FrameStorage** when `PROCTORING_STORAGE_BACKEND=s3` or `PROCTORING_S3_BUCKET` is set. Keys are identical in both modes: `{sessionId}/frames/...`, `{sessionId}/video/...`, `{sessionId}/transcript.jsonl`, `{sessionId}/transcript_refined.jsonl`, `{sessionId}/transcript-gen-checkpoint.json`.

### S3 (production)

- **Env (API server):** `PROCTORING_STORAGE_BACKEND=s3`, `PROCTORING_S3_BUCKET`, `AWS_REGION`, and `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (IAM user for the host, e.g. Render), unless you rely on another credential source in the default chain.
- **AWS:** Create a private bucket (block public access), default encryption (SSE-S3 is fine). IAM policy on that user: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` on `arn:aws:s3:::BUCKET` and `arn:aws:s3:::BUCKET/*`. No S3 CORS is required if only the Node server calls S3.
- **Cutover:** New uploads go to S3 after you flip env. Existing data on disk must be copied first if you need old sessions: run `npx tsx src/scripts/migrateProctoringLocalToS3.ts` (see `--help`) or `aws s3 sync ./storage/proctoring s3://BUCKET/` preserving relative paths as keys.

---

## 3. Frame preparation for transcript

Before the AI runs, frames are prepared by **framePrep**:

- **`prepareSessionForTranscript(sessionId)`**
  - If the session has **video chunks** and ffmpeg is available: **video frame extraction** — extract candidate frames from WebM (e.g. every 0.5s), build small thumbnails, keep frames where pixel diff exceeds a threshold (and at least one frame every N seconds). Result: list of **PreparedFrame** (buffer, capturedAt, screenIndex, width, height).
  - If no video or extraction fails: **screenshot fallback** — load each `session.frames[]` from storage by `storageKey` into the same **PreparedFrame** format.
  - Also loads **sidecar events** and **screens**.
  - Returns **PreparedSessionData**: `frames`, `sidecarEvents`, `screens`, `captureStartedAt`, `captureEndedAt`.

- **`prepareSessionForTranscriptSince(sessionId, sinceMs)`**  
  Same as above but only frames (and sidecar events) with `capturedAt` / `timestamp >= sinceMs`. Used by the **incremental (sliding-window)** pipeline.

So the "video" input to the AI is either **smart-extracted video frames** or **screenshot frames**, normalized to this prepared format.

---

## 4. Transcript generation (raw OCR transcript)

**Entry point:** `generateTranscript(sessionId)` in `server/src/ai/transcript/generator.ts`.

### Generation ID and "regenerate from scratch"

- Each run sets `transcript.generationId = Date.now()` and `transcript.status = "generating"`.
- Only the run whose `generationId` still matches the DB at the end writes `completed` or `failed`.
- So you can **"regenerate from scratch"** even while a previous run is still generating; the newest run wins.

### Two modes

1. **Prompt-only** (default): Frames are batched; each batch is sent to the vision API with one system prompt. The model returns JSONL lines per region. No per-region cropping.

2. **Region detection** (`TRANSCRIPT_REGION_DETECTION=true`):
   - **Layout:** For each frame (with caching), get bounding boxes for regions (ai_chat, terminal, editor, file_tree, browser) via **detectRegions** (vision). Layout is reused for many frames and re-detected on interval or when the image changes enough.
   - **aiChatLocation:** Inferred from layout: `"sidebar"` if ai_chat exists, `"terminal"` if only terminal, else `"none"`. This decides which region is treated as "the" AI chat for model choice and caching.
   - **Crop:** Each region is cropped and queued per region type in **pendingCrops**.
   - **Parallel flush:** When any region hits batch size, **all** region types with pending crops are flushed **in parallel** (`Promise.all`). So GPT-4o for ai_chat runs alongside file_tree/terminal/editor (4o-mini or Tesseract), reducing wall-clock time.
   - **Per-region OCR:**
     - **ai_chat** (and **terminal** when `aiChatLocation === "terminal"`): Always vision, **GPT-4o**, no cache.
     - **file_tree** and **terminal** (when not the chat): **Aggressive cache** — if a small thumb of the crop is < ~50% different from the last cached thumb, reuse last OCR and re-emit for current timestamps; otherwise run OCR (Tesseract then vision) and cache the result.
     - Editor, browser, other: 4o-mini (or Tesseract where applicable), no cache.
   - **Idle/dedup:** Identical full-frame hashes are skipped; low-priority regions can be deduped by crop hash.
   - **Debug:** With `TRANSCRIPT_DEBUG_SAVE_CACHE_THUMBS=true`, cached thumbs are written under `TRANSCRIPT_DEBUG_CACHE_THUMBS_DIR` so you can verify cache accuracy.

### Stitch and store

- All region batch outputs (and re-emitted cached JSONL) are merged by the **stitcher** (parse → sort by `ts` → single JSONL).
- **injectSidecarEvents** merges in tab_switch, blur, etc. from prepared sidecar events.
- Result is saved as `{sessionId}/transcript.jsonl` and session is updated: `transcript.status = "completed"`, `transcript.storageKey`, token usage, etc. (only if the run's `generationId` still matches).

---

## 5. Incremental (sliding-window) transcript

If **TRANSCRIPT_INCREMENTAL_ENABLED=true**, a **scheduler** runs on a timer (e.g. every 60s):

- Finds sessions with **`status === "active"`** and **`transcript.status !== "generating"`**.
- For each, **sinceMs** = `transcript.lastIncrementalAt` or `stats.captureStartedAt` (or 0).
- **`generateTranscriptIncremental(sessionId, { sinceMs })`**:
  - Uses **`prepareSessionForTranscriptSince(sessionId, sinceMs)`** to get only frames (and sidecar events) since that time.
  - Runs the **same** region-detection pipeline on that subset.
  - Reads existing **transcript.jsonl** (if any), parses segments, appends new segments, sorts by `ts`, writes merged JSONL back.
  - Updates **`transcript.lastIncrementalAt`** and **`transcript.storageKey`** (does not set `status` to `completed`; that's for the full run).

So during an **active** recording, the transcript file can be extended every N seconds; the full "Generate transcript" run is still used for a final pass (e.g. after the session is completed).

---

## 6. Refinement and interpretation

- **Refine** (`POST .../refine-transcript`): Reads raw **transcript.jsonl**, chunks it (with overlap), sends each chunk to **GPT-4o**. Model returns cleaned **descriptions**. Result is stored as **`{sessionId}/transcript_refined.jsonl`** and **transcript.refinedStatus** (etc.) are updated.

- **Interpret** (`POST .../interpret-transcript`): Takes raw (or refined) transcript and runs two strategies ("chunked" and "stateful") to produce **behavioral summaries**, **intents**, and a **session narrative**. Result is returned in the API response.

---

## 7. Test pages

- **ProctoringTest:** Full flow — create test session → consent → capture (video + optional screenshots) → complete → **Generate transcript** → **Refine** → **Interpret**.
- **ProctoringStorageTest:** Lists session dirs under **storage/proctoring** (dev-only). Pick a session that already has frames/video and run **Generate**, **Refine**, **Interpret**. **"Regenerate from scratch"** works even when status is still **generating** (new run gets a new generationId; only the latest run's result is kept).

---

## End-to-end summary

1. **Candidate** opens link → starts proctoring → **consent** → **capture** (video and/or screenshots + sidecar events) → **complete**.
2. **Storage:** Frames and video under **storage/proctoring/{sessionId}/** and in the **ProctoringSession** document.
3. **Transcript (raw):** On demand (or incrementally for active sessions), **framePrep** loads frames (video extraction or screenshots), then **generator** runs **region detection** (layout cache, aiChatLocation, OCR cache for file_tree/terminal, parallel flushes, generationId). Output: **transcript.jsonl**.
4. **Refinement:** Raw → GPT-4o refiner → **transcript_refined.jsonl**.
5. **Interpretation:** Raw/refined → activity interpreter → behavioral summary and narrative for review.
