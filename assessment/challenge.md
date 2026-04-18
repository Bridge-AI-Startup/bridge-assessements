# Take-home challenges (mini Bridge)

Fix the codebase so behavior matches **this document** and the **tests** (when provided). Some issues are **silent** (no stack trace); rely on seeds, API contracts, and tests.

---

## A — Submission lifecycle

| ID | Issue | Expected behavior |
|----|--------|-------------------|
| **A1** | Invalid transitions | `POST .../start` must not succeed when status is already `submitted` (or `opted-out` / `expired`). `POST .../submit` must not allow double submit. |
| **A2** | `timeSpent` | On submit, `timeSpent` must be **whole minutes** between `startedAt` and `submittedAt` (sensible rounding; document your choice). |
| **A3** | Duplicate email | Same email on the same assessment must always 409 after **normalization** (trim + case-insensitive). |

---

## B — Token / public API scope

| ID | Issue | Expected behavior |
|----|--------|-------------------|
| **B1** | Token response leak | `GET /api/submissions/token/:token` must expose **only** candidate-safe fields. No internal ids that enable cross-assessment access. |
| **B2** | Public assessment leak | `GET /api/submissions/assessments/public/:id` must return **only** public assessment fields (e.g. title, description, timeLimit). No employer/user ids. |

---

## C — Employer list & auth

| ID | Issue | Expected behavior |
|----|--------|-------------------|
| **C1** | Status filter | `GET .../submissions?status=submitted` (etc.) must filter server-side. |
| **C2** | Search | `?search=` must match **both** candidate name and email (case-insensitive substring). |
| **C3** | Owner scope | Only the **owning employer** may list submissions for an assessment. Guessing another assessment id must **404**. |

---

## D — Features (cross-cutting)

| ID | Issue | Expected behavior |
|----|--------|-------------------|
| **D1** | `displayName` | Optional display name at invite time; returned on token GET and employer list; shown in UI. |
| **D2** | Pagination | `?page=` & `?limit=` on employer list with correct offset; stable ordering documented. |

---

## E — Hardening

| ID | Issue | Expected behavior |
|----|--------|-------------------|
| **E1** | (Optional) | If you add numeric scores later, define tie-break rules. Not required for this mini app. |
| **E2** | Honeypot | `POST .../generate-link`: if hidden field `website` is non-empty, return **400** (bot). Humans leave it blank. |

---

## Grading notes (for you)

- Prefer **automated tests** for A–C; D–E can be partial credit from manual review.
- Keep **connection string** and API tokens out of the candidate repo you publish if using shared Atlas.
