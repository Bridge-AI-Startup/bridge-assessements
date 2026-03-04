# Transcript & Criteria Evaluation (concise)

How screen-recording **transcripts** and **evaluation criteria** are used to score candidates.

---

## Flow

```
Setup:    Job description → Suggest criteria → Employer edits → Validate → Save (optional: ground & save)
Capture:  Screen recording → Stage 1 VLM → transcript events → submission.screenRecordingTranscript
Eval:     On submit: Load transcript + criteria → Validate → Ground → Retrieve → Evaluate + Session summary → evaluationReport
```

---

## Transcript

- **What:** Array of events from the candidate’s session (Stage 1 VLM turns recording into events).
- **Where:** `Submission.screenRecordingTranscript`.
- **Event fields:** `ts`, `ts_end`, `action_type` (`reading` | `coding` | `testing` | `ai_prompt` | `ai_response` | `searching` | `idle`), `ai_tool`, `prompt_text`, `description`.

AI usage comes from `ai_prompt` / `ai_response` events and `description` / `prompt_text`.

---

## Criteria (assessment setup)

- **Suggest:** `POST /evaluation/suggest-criteria` — LLM suggests up to 5 criteria from job description; each is validated (must be observable from a recording). Only valid returned.
- **Validate:** `POST /evaluation/validate-criterion` — `{ valid, reason? }`. Rejects vague/subjective criteria.
- **Ground:** Turns a criterion into a rubric: `definition`, `positive_indicators`, `negative_indicators`, `relevant_action_types`. Stored in `Assessment.evaluationCriteriaGroundings` on save (optional).

---

## Evaluation pipeline (on submit)

When submission has transcript and assessment has criteria, backend runs (in background):

1. **Validate** each criterion (observable from recording?).
2. **Ground** — use `evaluationCriteriaGroundings` if present, else ground per criterion.
3. **Retrieve** — for each criterion, filter transcript by `relevant_action_types` and ±30s context; dedupe, sort.
4. **Evaluate** — LLM gets grounded definition + filtered transcript → `CriterionResult` (score 1–10, confidence, verdict, evidence, evaluable).
5. **Session summary** — one LLM call on full transcript → narrative.

All per-criterion work + session summary run in parallel. Result → `Submission.evaluationReport`.

```
Inputs: Transcript, Criteria, Groundings (optional)
  → Validate → Ground (or use saved) → Retrieve (±30s) → Evaluate → CriterionResult
  → Session summary (parallel)
  → EvaluationReport (criteria_results + session_summary)
```

---

## Data

**EvaluationReport:** `{ session_summary: string, criteria_results: CriterionResult[] }`  
**CriterionResult:** `criterion`, `score` (1–10), `confidence`, `verdict`, `evidence: [{ ts, ts_end, observation }]`, `evaluable` (false → excluded from overall).  
**Overall score (X/10):** Average of `score` over criteria where `evaluable === true` (`averageScoreOverEvaluableCriteria`).

---

## Where things live

| What       | Where                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| Transcript | `Submission.screenRecordingTranscript`                                        |
| Criteria   | `Assessment.evaluationCriteria`                                               |
| Groundings | `Assessment.evaluationCriteriaGroundings` (optional)                          |
| Report     | `Submission.evaluationReport`                                                 |
| Run eval   | Auto on submit, or `POST /evaluation/evaluate-transcript` with `submissionId` |

---

## Dashboard

- **Table:** Score cell shows X/100 (legacy) and **X/10** (average over evaluable criteria). Click X/10 → evaluation modal.
- **Modal:** Session summary + per-criterion score, confidence, verdict, expandable **Evidence** (ts–ts_end + observation).
