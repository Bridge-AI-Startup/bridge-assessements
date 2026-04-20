# Mini Bridge — Full-stack Bugfix + Feature Challenge

## Scenario

You joined the Bridge team as a full-stack engineer. A simplified internal assessment tool already exists, but several production-like issues slipped in before launch.

Your goal is to fix the app and complete missing features so the system behaves correctly for both employers and candidates.

## What you will build

You will work in a full-stack starter:

- **Backend:** Node.js + Express + TypeScript
- **Frontend:** React + Vite
- **Data layer:** in-memory repository (no external DB setup required)

The app supports creating assessments, generating candidate links, candidate token-based submissions, and an employer submissions dashboard.

## Requirements (must-have)

### A) Submission lifecycle

1. `POST /token/:token/start` must reject invalid transitions (already submitted, opted-out, expired).
2. `POST /token/:token/submit` must prevent double submit.
3. `timeSpent` must be computed correctly from `startedAt` to `submittedAt` (whole minutes; document the rounding choice).
4. Duplicate candidate emails for the same assessment must always return 409 after normalization (trim + case-insensitive).

### B) Candidate/public API scope

5. `GET /submissions/token/:token` must return only candidate-safe fields.
6. `GET /submissions/assessments/public/:id` must return only public assessment fields.

### C) Employer list + access control

7. `GET /submissions/assessments/:assessmentId/submissions` must enforce owner scope (only owning employer can access).
8. `status` query filter must work.
9. `search` must match both candidate name and candidate email (case-insensitive substring).

### D) Cross-cutting features

10. `displayName` must be fully wired end-to-end (invite/create, token response, employer list UI).
11. Pagination (`page`, `limit`) must work with correct offset and documented ordering.

### E) Hardening

12. Invite endpoint must enforce honeypot: if hidden field `website` is non-empty, return 400.

## Acceptance Criteria (definition of done)

- [ ] Lifecycle endpoints enforce valid transitions and reject invalid states.
- [ ] `timeSpent` is correct and deterministic.
- [ ] Duplicate emails are prevented consistently.
- [ ] Public/token responses do not leak internal linkage or employer-only fields.
- [ ] Employer submissions list enforces ownership, status filter, and search behavior.
- [ ] `displayName` appears correctly in API responses and frontend.
- [ ] Pagination returns the expected page slice.
- [ ] Honeypot validation blocks bot-like submissions.
- [ ] Frontend still runs and reflects corrected backend behavior.

## Constraints

- Do not replace the app architecture.
- Keep the in-memory repository approach (no MongoDB/Atlas required).
- Focus on correctness and product behavior, not visual redesign.

## Provided / assumptions

- Starter includes intentional bugs and partial implementations.
- Seeded data is created in-process on server startup.
- You can run the app locally with `npm install` + `npm run dev` in server/client.

## Deliverables

1. Updated source code with fixes/features.
2. README notes if you changed behavior assumptions.
3. Brief explanation of key decisions/tradeoffs.

## Nice-to-haves (optional)

- Add focused automated tests for key corrected behaviors.
- Improve error messages for edge cases.
- Add small UI quality-of-life improvements without changing core flow.
