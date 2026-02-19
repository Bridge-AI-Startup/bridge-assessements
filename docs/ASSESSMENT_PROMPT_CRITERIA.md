# Assessment Prompt Quality Criteria

This document defines checkable criteria for generated assessments. Use it for manual review and as the source of truth for automated checks in the eval checker.

---

## 1. Format (JSON)

- [ ] **Valid JSON** — Output parses as JSON.
- [ ] **Required keys** — Object has exactly: `title`, `description`, `timeLimit` (no extra top-level keys required; extras are ignored).
- [ ] **timeLimit type and range** — `timeLimit` is an integer between 30 and 480 (minutes).

---

## 2. Title

- [ ] **Word count** — Between 6 and 12 words.
- [ ] **Specific and professional** — No buzzwords; describes the assessment concretely.

---

## 3. Description structure

- [ ] **Word count** — Between 300 and 650 words.
- [ ] **Required sections present** — All of the following Markdown headers appear, in this order:
  1. `## Scenario`
  2. `## What you will build`
  3. `## Requirements (must-have)`
  4. `## Acceptance Criteria (definition of done)`
  5. `## Constraints`
  6. `## Provided / Assumptions` (or `## Provided` or `## Assumptions` as acceptable variants)
  7. `## Deliverables`
  8. `## Nice-to-haves (optional)` (or `## Nice-to-haves`)

---

## 4. Acceptance Criteria checklist

- [ ] **Checklist format** — The "Acceptance Criteria" section contains checklist items using `- [ ]` (or `* [ ]`).
- [ ] **Minimum count** — At least 10 checklist items in that section.

---

## 5. Quality (manual or heuristic)

- [ ] **Specific scenario** — Not a generic "build an app"; has a named product/feature and concrete situation.
- [ ] **Requirements count** — "Requirements (must-have)" lists 5–8 items.
- [ ] **Observable criteria** — Acceptance criteria describe observable behavior or output, not style or taste.
- [ ] **No subjective wording** — Description avoids unqualified terms like "clean code", "well-structured", "elegant", "production-ready" without concrete criteria.

---

## 6. Fit to role (manual)

- [ ] **Aligns with job description** — Technologies and scope match the job description; no scope creep from domain context.
- [ ] **Completable in time limit** — A strong candidate could realistically complete the project within `timeLimit` minutes.

---

## Automated vs manual

| Criterion                    | Automated |
|-----------------------------|-----------|
| Valid JSON, required keys   | Yes       |
| timeLimit in [30, 480]      | Yes       |
| Title word count 6–12       | Yes       |
| Description word count 300–650 | Yes   |
| Required sections present (and order) | Yes |
| ≥10 acceptance checklist items | Yes  |
| Specific scenario / requirements count | Optional (regex or simple heuristics) |
| Subjective wording check    | Optional (blocklist) |
| Fit to role / completable   | Manual    |

---

## Good vs bad examples (for prompt tuning)

**Bad requirement:** "Implement auth."  
**Good requirement:** "Implement login that accepts email + password and returns a session token or 401."

**Bad acceptance criterion:** "Code is well-structured."  
**Good acceptance criterion:** "GET /api/users returns 200 with a JSON array of user objects when the request includes a valid session token."

**Bad scenario:** "Build a task manager app."  
**Good scenario:** "You're extending the backend for **TaskFlow**, an internal tool. The team needs a new endpoint to assign tasks to users with validation and audit logging."

Use these in the system prompt as few-shot examples or as explicit "do / don't" guidance when iterating on prompts.
