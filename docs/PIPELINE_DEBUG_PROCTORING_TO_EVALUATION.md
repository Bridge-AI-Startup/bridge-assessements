# Pipeline: Proctoring → Transcript → Evaluation (debug checklist)

End-to-end flow and where it can fail. Use this to debug when the submission has no `screenRecordingTranscript` or `evaluationReport`.

---

## 1. Pipeline overview

```
CLIENT (candidate)                    SERVER / DB
─────────────────────────────────────────────────────────────────────────────
1. Open assessment link (token in URL)
   GET /api/submissions/token/:token
   → Submission exists? (created when link was generated)

2. Click "Start" → Consent screen shown

3. Grant consent
   POST /api/proctoring/sessions  { token }     ← VALIDATION: body must have "token" only (no submissionId)
   → 201 + session { _id, submissionId }
   → ProctoringSession created in DB with submissionId = submission._id

   POST /api/proctoring/sessions/:sessionId/consent  { token, screens }
   → Session status = "active"

4. During assessment: capture + upload
   - Frames: POST /api/proctoring/sessions/:sessionId/frames (multipart) OR batch
   - Video: POST /api/proctoring/sessions/:sessionId/video (chunks)
   → Session must have frames[] or videoChunks[] for transcript later

5. Submit
   POST /api/submissions/token/:token/submit  { githubLink }
   → Submission saved (status=submitted)
   → ensureProctoringTranscriptAndEvaluate(submission._id) run in background

BACKGROUND (ensureProctoringTranscriptAndEvaluate)
─────────────────────────────────────────────────────────────────────────────
6. Load submission + assessment
   → If no assessment.evaluationCriteria or length 0 → EXIT (no transcript/eval)

7. Find proctoring session
   ProctoringSessionModel.findOne({ submissionId })
   → If no session → EXIT + console.warn "No proctoring session..."
   → Check: same submissionId? (Mongoose casts string to ObjectId if schema is ObjectId)

8. Transcript on session
   - If transcript.status === "generating" → poll until completed or timeout
   - If "not_started" or "failed" → call generateTranscript(session._id)
     - Env: TRANSCRIPT_GENERATION_ENABLED must not be "false"
     - prepareSessionForTranscript: needs session.frames.length > 0 OR session.videoChunks.length > 0
     - If 0 frames → throw "No frames available for transcript generation" → EXIT
     - Else: VLM + stitch → store transcript.jsonl → session.transcript.status = "completed", storageKey set

9. Load transcript and attach to submission
   getProctoringTranscriptForSubmission(submissionId)
   → Finds session, requires transcript.status === "completed" and transcript.storageKey
   → Reads from frame storage, converts to TranscriptEvent[]
   → If null or length 0 → EXIT
   → submission.screenRecordingTranscript = transcript; save()

10. Run evaluation
    evaluateTranscript(transcript, assessment.evaluationCriteria, { groundings })
    → submission.evaluationReport = report; save()
```

---

## 2. Failure points (check in order)

| # | Check | Where / How |
|---|--------|-------------|
| 1 | **Proctoring session created?** | DB: `proctoringsessions` has doc with `submissionId` = your submission `_id`. If missing, step 3 failed (e.g. validation error before fix, or createProctoringSession never called / returned error). |
| 2 | **Request body for create session** | Client must send only `{ token }`. Validator used to require `submissionId` too → 400; now fixed to token only. Restart server after validator change. |
| 3 | **Assessment has evaluation criteria** | DB: `assessments` doc for this submission’s `assessmentId` must have `evaluationCriteria` (array of strings, length > 0). If empty/missing, ensureProctoringTranscriptAndEvaluate exits at step 6. |
| 4 | **Frames or video on session** | DB: `proctoringsessions` doc for this submission: either `frames` (array) or `videoChunks` (array) must be non-empty. If both empty, generateTranscript throws "No frames available". Client must be uploading during the assessment (frame upload hook or video chunks). |
| 5 | **TRANSCRIPT_GENERATION_ENABLED** | Env: If set to `"false"`, generateTranscript throws and transcript never completes. Omit or set to true. |
| 6 | **Transcript status on session** | DB: `proctoringsessions.transcript.status` = `"completed"` and `transcript.storageKey` set. If "failed", check `transcript.error`. If "generating" and never completes, check server logs for VLM/storage errors. |
| 7 | **Storage** | Transcript is read from frame storage (e.g. GCS or local) by `storageKey`. If storage is misconfigured or key wrong, getProctoringTranscriptForSubmission returns null. |
| 8 | **submissionId type** | ensureProctoringTranscriptAndEvaluate passes `submission._id.toString()`. findOne({ submissionId }) with string and schema ObjectId usually works (Mongoose cast). If not, session might not be found. |

---

## 3. Key code locations

| Step | File | Symbol / line |
|------|------|----------------|
| Create session (client) | `client/src/pages/CandidateAssessment.jsx` | handleConsentGranted → createProctoringSession(token) |
| Create session (server) | `server/src/controllers/proctoring.ts` | createSession (body: token only) |
| Create session validation | `server/src/validators/proctoringValidation.ts` | createSessionValidation (token only) |
| On submit trigger | `server/src/controllers/submission.ts` | submitSubmissionByToken → ensureProctoringTranscriptAndEvaluate |
| Pipeline logic | `server/src/controllers/submission.ts` | ensureProctoringTranscriptAndEvaluate |
| Session lookup | `server/src/controllers/submission.ts` | ProctoringSessionModel.findOne({ submissionId }) |
| Transcript generation | `server/src/ai/transcript/generator.ts` | generateTranscript(sessionId) |
| Frames for transcript | `server/src/services/capture/framePrep.ts` | prepareSessionForTranscript → frames or videoChunks |
| Load transcript for submission | `server/src/services/evaluation/proctoringTranscriptAdapter.ts` | getProctoringTranscriptForSubmission(submissionId) |
| Evaluation | `server/src/services/evaluation/orchestrator.ts` | evaluateTranscript(transcript, criteria, options) |

---

## 4. Quick DB checks (MongoDB)

Replace `SUBMISSION_ID` with the submission `_id` (e.g. `69a689b903a86747d396a8dd`).

```javascript
// 1) Submission and assessment criteria
db.submissions.findOne(
  { _id: ObjectId("SUBMISSION_ID") },
  { assessmentId: 1, screenRecordingTranscript: 1, evaluationReport: 1, candidateName: 1 }
);
db.assessments.findOne(
  { _id: ObjectId("ASSESSMENT_ID_FROM_ABOVE") },
  { evaluationCriteria: 1, evaluationCriteriaGroundings: 1 }
);

// 2) Proctoring session for this submission
db.proctoringsessions.findOne({ submissionId: ObjectId("SUBMISSION_ID") });
// If null → session never created (check step 1–2).

// 3) Session transcript and frames
db.proctoringsessions.findOne(
  { submissionId: ObjectId("SUBMISSION_ID") },
  { "transcript.status": 1, "transcript.storageKey": 1, "transcript.error": 1, frames: 1, videoChunks: 1 }
);
// transcript.status must be "completed" and transcript.storageKey set.
// frames.length or videoChunks.length must be > 0 for generation to succeed.
```

---

## 5. Server logs to watch

- `[ensureProctoringTranscriptAndEvaluate] No proctoring session for submission ...` → Session missing (create-session flow or wrong submissionId).
- `[ensureProctoringTranscriptAndEvaluate] Transcript generation failed for submission ...` → generateTranscript threw (no frames, env disabled, or VLM/storage error).
- `[transcript] Prepared: 0 frames` or `No frames available for transcript generation` → Client did not upload frames/video, or upload failed.
- `[submitSubmissionByToken] ensureProctoringTranscriptAndEvaluate failed for ...` → Unhandled error in the pipeline (see stack trace).

---

## 6. Summary checklist

1. **Session exists:** `proctoringsessions.submissionId` = submission `_id`.
2. **Create session API:** Client sends `POST /api/proctoring/sessions` with body `{ token }` only; server returns 201.
3. **Assessment:** Has `evaluationCriteria` (non-empty array).
4. **Frames or video:** Session has `frames` or `videoChunks` (client uploads during assessment).
5. **Env:** `TRANSCRIPT_GENERATION_ENABLED` not `"false"`.
6. **Transcript:** Session `transcript.status` = `"completed"`, `transcript.storageKey` set.
7. **Storage:** Transcript file readable at `storageKey` (frame storage configured).
8. **Evaluation:** Runs after transcript is attached; errors logged if evaluateTranscript fails.

Use the DB queries and logs above to see which step fails for a given submission.

---

## 7. Where to view raw and processed transcripts manually

### Raw transcript (VLM JSONL)

The **raw** transcript is the direct output of the vision pipeline: one JSON object per line (`ts`, `region`, `text_content`, etc.).

- **On disk (local storage):**  
  `server/storage/proctoring/<sessionId>/transcript.jsonl`  
  Default base dir is `PROCTORING_STORAGE_DIR` or `./storage/proctoring` (relative to server cwd).

- **How to get `sessionId`:**  
  From MongoDB: `db.proctoringsessions.findOne({ submissionId: ObjectId("SUBMISSION_ID") }, { _id: 1 })`  
  The `_id` of that document is the session ID (e.g. `69a742b8b82729680ad29a0f`). The file is then  
  `storage/proctoring/69a742b8b82729680ad29a0f/transcript.jsonl`.

- **Via API:**  
  `GET /api/proctoring/sessions/:sessionId/transcript` (returns the same JSONL string). You need the proctoring session ID (from the DB query above).

### Processed transcript (enriched, activity interpreter output)

The **processed** transcript is the result of the activity interpreter: behavioral events, session narrative, and deterministic timestamps. It is stored only in the database.

- **In MongoDB:**  
  On the **Submission** document, field `enrichedTranscript`. It has:
  - `events[]` — each with `ts`, `ts_end`, `behavioral_summary`, `intent`, `regions_present`, `ai_tool`, `raw_regions`
  - `session_narrative`
  - `strategy` — `"chunked"` or `"stateful"`
  - `processing_stats`

  Example (mongosh):
  ```javascript
  db.submissions.findOne(
    { _id: ObjectId("SUBMISSION_ID") },
    { enrichedTranscript: 1, candidateName: 1 }
  );
  ```

- **Via API:**  
  Any endpoint that returns the full submission (e.g. employer fetch of a submission by ID) will include `enrichedTranscript` if present.

### Stage 1 transcript (TranscriptEvent[] on submission)

Between raw JSONL and enriched transcript, the pipeline also stores **Stage 1** transcript on the submission:

- **In MongoDB:**  
  `Submission.screenRecordingTranscript` — array of `TranscriptEvent` (action_type, ts, description, etc.). This is what evaluation runs on.

  Example:
  ```javascript
  db.submissions.findOne(
    { _id: ObjectId("SUBMISSION_ID") },
    { screenRecordingTranscript: 1 }
  );
  ```

### Test harness (no real submission)

When you run the interpreter test script only (no full pipeline):

- **Raw:** Fixture files in `server/src/scripts/evals/transcripts/` — e.g. `raw_two_sum.jsonl`, `raw_weak_candidate.jsonl`.
- **Processed:** Output files in `server/src/scripts/evals/outputs/` — e.g. `raw_two_sum_chunked.json`, `raw_two_sum_stateful.json`.
