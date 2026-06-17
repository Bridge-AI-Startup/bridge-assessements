# BridgeAI Demo-Readiness Test Suite

End-to-end verification of the full demo workflow — signup/auth → assessment +
candidate link → candidate completion → recruiter dashboard → adaptive video
processing → analysis — plus mocked unit tests for the core adaptive logic.

Results are written to [`results/results.json`](results/results.json) and
rendered as a navigable Cursor Canvas:
`~/.cursor/projects/Users-adityamittal-Coding-Projects-bridge-assessements/canvases/demo-readiness.canvas.tsx`.

---

## How to run

All commands run from `server/`.

```bash
# 1. Unit tests (mocked, deterministic, no spend)
npm run test:unit            # vitest run test/unit  → writes results/unit-results.json

# 2. Full live E2E suite (writes results/results.json, then cleans up tagged data)
npm run e2e                  # tsx test/e2e/runAll.ts

# Keep test data + write evidence/run-context.json (for manual screenshotting)
E2E_NO_CLEANUP=true npm run e2e

# Parameterize the simulated candidate duration (P3)
E2E_CANDIDATE_DURATION_MS=5000 npm run e2e

# 3. Video-evaluation deep-dive (generates a ~4 min coding screencast and drives
#    the real transcript + scoring pipeline; writes results/video-eval-results.json)
npm run test:video-eval

# Keep the seeded data + evidence artifacts (video/transcript/frame) for inspection
VIDEO_EVAL_NO_CLEANUP=true npm run test:video-eval
```

The suite expects the backend running on `http://localhost:5050` (it polls
`/health` first). Start it in a separate terminal with `npm run dev` — the
suite never blocks the terminal on a long server task (P7 guardrail).

### Regenerating the canvas data

The canvas embeds `results.json` inline (canvases cannot `fetch`). After a fresh
run, re-inject it:

```bash
node -e 'const fs=require("fs");const p=process.env.HOME+"/.cursor/projects/Users-adityamittal-Coding-Projects-bridge-assessements/canvases/demo-readiness.canvas.tsx";let s=fs.readFileSync(p,"utf8");const d=fs.readFileSync("test/results/results.json","utf8");s=s.replace(/const DATA: any = [\s\S]*?;\n\nconst PROCESS/, "const DATA: any = "+d.trim()+";\n\nconst PROCESS");fs.writeFileSync(p,s);'
```

(Or replace the `const DATA: any = …;` literal by hand.)

---

## Environment needed

Live tests hit the real configured services via `server/config.env`:

| Capability            | Env var(s)                                          | If missing |
|-----------------------|-----------------------------------------------------|------------|
| Auth (client mint)    | `VITE_FIREBASE_API_KEY` (web key, in harness config)| P1 cannot mint tokens |
| Auth (server verify)  | `FIREBASE_SERVICE_ACCOUNT_JSON` / `_PATH`           | **Blocker** — all employer APIs 401/500 |
| Database              | `ATLAS_URI`, `DB_NAME`                              | suite cannot seed/read |
| Transcript / vision   | `OPENAI_API_KEY` (+ `OPENAI_VISION_MODEL`)         | P5/P6 transcript fails |
| Storage               | `PROCTORING_STORAGE_BACKEND`, S3 vars or local dir  | frames/video fail |
| Code indexing         | `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`          | P6 indexing fails |
| Email invites         | `RESEND_API_KEY`                                    | P2 invite step blocked |
| Behavioral grading    | `E2B_API_KEY`, `BEHAVIORAL_GRADING_ENABLED`        | P6 grading step blocked |

Adaptive rate-limit knobs exercised by P5: `OPENAI_MAX_CONCURRENT`,
`TRANSCRIPT_BATCH_SIZE`, `TRANSCRIPT_BATCH_CONCURRENCY`.

---

## Processes

| ID | Script | What it verifies |
|----|--------|------------------|
| **P1** | [`processes/01-auth.ts`](e2e/processes/01-auth.ts) | Firebase signup mints a token; backend user-create + `whoami` authorize the session. |
| **P2** | [`processes/02-assessment-link.ts`](e2e/processes/02-assessment-link.ts) | Assessment created and a tokenized candidate link **resolves with no auth from any URL**. |
| **P3** | [`processes/03-candidate-complete.ts`](e2e/processes/03-candidate-complete.ts) | Start → proctoring (consent, frames, sidecar events) → arbitrary parameterized duration → submit by upload → complete session. |
| **P4** | [`processes/04-dashboard-update.ts`](e2e/processes/04-dashboard-update.ts) | The submitted candidate appears on the recruiter dashboard with correct status + metadata. |
| **P5** | [`processes/05-video-processing.ts`](e2e/processes/05-video-processing.ts) | Synthetic frames + a real WebM merge → `playback.webm` and transcribe within a hard budget; bounded concurrency = no rate-limit jam. |
| **P6** | [`processes/06-analysis-workflows.ts`](e2e/processes/06-analysis-workflows.ts) | Chunk-based repo indexing, RAG interview questions, scoring; all readable by the recruiter. |
| **P7** | [`processes/07-timing-guardrails.ts`](e2e/processes/07-timing-guardrails.ts) | Hard timeouts, request aborts, a 30-min recording rejected from inline analysis, responsive backgrounded server. |

---

## Video evaluation (does the scoring actually work on a real coding video?)

`npm run test:video-eval` ([`video-eval/runVideoEvaluation.ts`](video-eval/runVideoEvaluation.ts))
proves the **screen-recording → transcript → scoring** path end-to-end on a
realistic, multi-minute coding session — answering "does the video evaluation
actually work?" with hard evidence.

What it does:

1. **Generates a ~4 minute coding screencast** ([`video-eval/codingVideoFixture.ts`](video-eval/codingVideoFixture.ts)):
   33 editor/terminal states that build a prime-number module step by step
   (`is_prime` → `primes_up_to` → pytest tests), hit a failing test, fix the bug,
   and re-run to green. Encoded to a real WebM via the bundled ffmpeg.
2. Seeds a tagged submission + proctoring session, stores the WebM as a video
   chunk, and runs the **real** `generateTranscript()` (ffmpeg frame extraction +
   GPT-4o vision + stitch) — no auth/HTTP needed.
3. Measures **transcript quality** = code-token recall (do `is_prime`, `pytest`,
   `passed`, … appear in the transcript) + non-empty segment ratio.
4. Runs the **real** `evaluateTranscript()` and compares produced 1–10 scores
   against expected **bands** authored into the fixture:
   - incremental coding → **high** · runs tests → **high** · used an AI assistant
     → **low** (negative control: no assistant is present in the video).
5. Records **timing** for each phase and asserts **no permanent rate-limit jam**.

Latest run: **27 frames → 55 transcript segments in ~35s · 100% token recall ·
3/3 score bands matched (overall 8.5/10) · ~66s total · no rate-limit jam.**
The acceptance criteria (score created + compared to expected, timing noted) and
verification criteria (canvas section + tested script with unit tests) are met.

Pure logic lives in [`video-eval/scoring.ts`](video-eval/scoring.ts) and is unit
tested (`test/unit/videoEval/scoring.test.ts`, `fixture.test.ts`).

### Seed fallback

When the Firebase Admin credential is invalid (current environment), the
employer-authenticated HTTP routes return 401/500. To still verify the
downstream pipeline against **real** services, P2/P4/P6 fall back to the same
Mongoose models and service functions the controllers call (see
[`e2e/lib/seed.ts`](e2e/lib/seed.ts)). Only the Firebase auth layer is bypassed;
indexing/scoring/transcript still run live against Pinecone/OpenAI/S3. These
steps are recorded as `blocked` (not faked) with a recommendation.

---

## Unit tests (mocked)

`test/unit/` — 51 tests, deterministic, no network spend:

- `visionRetry.test.ts` — 429 backoff honors `Retry-After`; concurrency never
  exceeds the cap; max-retries throws.
- `sessionVideoMerge.test.ts` — chunk-key ordering + merge claim/idempotency.
- `stitcher.test.ts` / `batcher.test.ts` / `serverDedup.test.ts` — transcript
  parsing/stitching, batch sizing, hash dedup.
- `costCalculator.test.ts` — token/cost estimation per provider/model.
- `guards.test.ts` — large-input rejection + timeout guards.
- `lib/apiClient.test.ts` / `lib/firebaseAuth.test.ts` / `lib/runner.test.ts` —
  harness behavior (request timeout/abort, token shaping, step timing).
- `videoEval/scoring.test.ts` — score-band classification, score-vs-expected
  comparison, transcript-quality token recall, evaluable-only averaging.
- `videoEval/fixture.test.ts` — the coding-screencast state builder is
  deterministic, shows incremental coding + a pytest fail→pass, contains every
  expected OCR token, and never shows an AI assistant (negative control); SVG
  rendering escapes XML.

---

## Recommended fixes checklist

Mirrors the interactive checklist on the canvas (ordered by severity).

- [ ] **[blocker · P1] Firebase Admin credential.** Backend cannot verify ID
  tokens (`invalid_grant: Invalid JWT Signature`), so every authenticated
  employer endpoint returns 401/500. Generate a fresh service-account key
  (Firebase console → Project settings → Service accounts → Generate new private
  key), update `FIREBASE_SERVICE_ACCOUNT_JSON` in `server/config.env` (and
  Render), and verify host clock sync (NTP). Files: `server/config.env`,
  `server/src/config/firebaseAdmin.ts`, `server/src/utils/auth.ts`.
- [ ] **[major · P6] Behavioral grading (E2B).** Sandboxed run + per-check
  verdicts can't be exercised. Add `E2B_API_KEY` and set
  `BEHAVIORAL_GRADING_ENABLED=true`; validate with
  `server/src/scripts/behavioral-grading-smoke.ts`. Files: `server/config.env`,
  `server/src/services/behavioralGrading/index.ts`.
- [ ] **[minor · P2] Candidate invite emails (Resend).** Add `RESEND_API_KEY` to
  `server/config.env` (and Render) and re-run P2 with the send-invites step.
  Files: `server/config.env`, `server/src/services/email.ts`.
- [ ] **[minor · P6] ElevenLabs voice interview.** Live voice needs a real mic +
  agent. Verify the post-call path by POSTing a signed sample payload to
  `/webhooks/elevenlabs` (see `TESTING_WEBHOOK.md` / `server/test-webhook.js`);
  do one manual voice run in staging for full coverage.

---

## Data hygiene

All test entities are tagged with the `@bridge-e2e.test` email domain. `npm run
e2e` calls [`e2e/lib/cleanup.ts`](e2e/lib/cleanup.ts) at the end to delete tagged
users, assessments, submissions, proctoring sessions, and repo indexes from
Mongo (and best-effort Firebase user deletion — best-effort because it needs the
same Admin credential that is currently broken). Set `E2E_NO_CLEANUP=true` to
retain data for manual inspection/screenshots.
