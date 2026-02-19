# Improving Assessment Generation Prompts

This guide walks you through finding, editing, testing, and iterating on the prompts used to generate assessments from job descriptions.

---

## 1. Where the prompts live

**Single source of truth:** `server/src/prompts/index.ts`

- **`PROMPT_GENERATE_ASSESSMENT_COMPONENTS`** – Used when a user clicks “Generate” from a job description.
  - **`system`** – Long system prompt (instructions, JSON shape, section order, word counts, quality rules).
  - **`userTemplate(jobDescription, domain?, seed?)`** – Builds the user message; optionally adds “domain context” (e.g. “Music streaming website”) for narrative variety.

**How it’s used:**  
`server/src/services/openai.ts` imports this prompt and calls the LangChain AI with it (use case `"assessment_generation"`). The controller `server/src/controllers/assessment.ts` calls `generateAssessmentComponents(jobDescription)` when the client hits the generate endpoint.

So: **to change behavior, edit `server/src/prompts/index.ts`.**  
Do not rely on `AI_PROMPTS.md` for the live prompt text; it’s documentation and may be out of date. After you improve prompts, you can update `AI_PROMPTS.md` so the doc stays in sync.

---

## 2. Steps to improve the prompts

### Step 1: Clarify what you want to improve

Decide what “better” means, for example:

- **Quality:** More specific scenarios, clearer requirements, better “definition of done.”
- **Consistency:** Stricter structure (sections, word counts, checklist length).
- **Bias / fairness:** Less ambiguous requirements, clearer constraints so strong candidates aren’t penalized by vague wording.
- **Fit to role:** Stronger alignment with the job description (technologies, level, type of work).
- **Output format:** More reliable JSON (title, description, timeLimit) or new fields.

Write down 2–3 concrete criteria (e.g. “description always has exactly 5–8 requirements” or “acceptance criteria use only observable behaviors”).

### Step 2: Edit the prompt in code

1. Open **`server/src/prompts/index.ts`**.
2. Locate **`PROMPT_GENERATE_ASSESSMENT_COMPONENTS`**.
3. Edit **`system`** and/or **`userTemplate`**:
   - **System:** Change instructions, section order, constraints, examples, or JSON requirements.
   - **User template:** Change how the job description (and optional domain/seed) are presented.

**Tips:**

- Be explicit: “MUST”, “REQUIRED”, “Do not…” and numbered lists help.
- Put the most important rules near the top or repeat them where relevant.
- If you want a new output field, add it to the JSON description in the system prompt and update `server/src/services/openai.ts` (and any validators) to read and validate it.
- Keep the **exact** JSON keys the app expects: `title`, `description`, `timeLimit` (unless you change the backend to accept new/renamed keys).

### Step 3: Test your changes

**Option A – Notebook (recommended for quick iteration)**  
Use the existing notebook so you don’t need to run the full app or log in:

1. From **repo root**: start Jupyter (`jupyter notebook` or `jupyter lab`) so the notebook’s working directory is the repo root.
2. Open `notebooks/test-assessment-generation.ipynb`. The notebook runs `server/src/scripts/test-assessment-generation.ts` with a temp file containing `JOB_DESCRIPTION`.
3. Set `JOB_DESCRIPTION` in the first cell to a real job description (or one that previously caused issues).
4. Run all cells. Inspect the generated title, description, and time limit.

To run the script directly from the terminal (from `server/`):
```bash
cd server
echo "Backend Engineer – Node.js, REST APIs, PostgreSQL." > /tmp/job.txt
npx tsx src/scripts/test-assessment-generation.ts /tmp/job.txt
```

**Option B – API with curl**  
Run the server and call the generate endpoint with a valid Firebase token:

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2 (replace YOUR_FIREBASE_ID_TOKEN with a real token from the client app)
curl -X POST http://localhost:5050/api/assessments/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_ID_TOKEN" \
  -d '{"description":"Backend Engineer – Node.js. Requirements: Node, REST APIs, PostgreSQL, JWT."}'
```

**Option C – Full app**  
Run client + server, sign in, create an assessment, and use “Generate” from a job description. Check the generated assessment in the UI.

For prompt tweaks, Option A (notebook) or B (curl) is usually fastest.

### Step 4: Iterate and compare

- Keep a few **fixed job descriptions** (e.g. in a small markdown or text file) and run them before/after changes to compare outputs.
- If you have examples of “bad” vs “good” outputs, add them to the system prompt as few-shot examples (or as “good description” / “bad description” guidance).
- After each edit, run the same 2–3 job descriptions and check:
  - JSON parses and has `title`, `description`, `timeLimit`.
  - Description matches your new structure and length rules.
  - Time limit is in 30–480 and feels reasonable.

### Step 5: (Optional) Sync documentation

- Update **`AI_PROMPTS.md`** with the new (or simplified) prompt text and any new JSON fields so future readers and fine-tuning stay aligned with the code.

---

## 3. Systematic eval (run all jobs + automated checks)

To compare prompt changes on a fixed set of inputs and get automated pass/fail checks:

1. **Criteria** — See `docs/ASSESSMENT_PROMPT_CRITERIA.md` for the checklist and what the checker enforces.
2. **Eval set** — Job descriptions live in `server/eval/jobs/` (one `.txt` or `.md` per file). Optional gold outputs go in `server/eval/gold/` (see `server/eval/README.md`).
3. **Run evals** — From `server/`:
   ```bash
   npx tsx src/scripts/run-eval.ts
   ```
   This generates an assessment for each job in `eval/jobs/`, writes outputs to `server/eval_runs/<date>/`, runs the checker on each output, and writes `summary.json` (pass/fail counts and violations). Use `--no-check` to skip the checker.
4. **Check a single output** — Validate one JSON file without running generation:
   ```bash
   npx tsx src/scripts/eval-assessment-output.ts path/to/output.json
   ```

Use the same eval set before and after prompt edits to compare results and ensure no regressions.

---

## 4. Quick reference

| Goal                         | Where to look / what to do |
|-----------------------------|----------------------------|
| Change instructions/format  | `server/src/prompts/index.ts` → `PROMPT_GENERATE_ASSESSMENT_COMPONENTS.system` |
| Change how job desc is sent  | `server/src/prompts/index.ts` → `PROMPT_GENERATE_ASSESSMENT_COMPONENTS.userTemplate` |
| Change domain/seed behavior | Same object: `userTemplate` and the code in `openai.ts` that passes domain/seed |
| See how prompt is invoked    | `server/src/services/openai.ts` → `generateAssessmentComponents()` |
| See API endpoint             | `server/src/controllers/assessment.ts` (generate) and `server/src/routes/assessment.ts` |
| Document prompts             | `AI_PROMPTS.md` (update after changes) |

---

## 5. Summary

1. **Edit** `server/src/prompts/index.ts` → `PROMPT_GENERATE_ASSESSMENT_COMPONENTS`.
2. **Test** via the notebook (with a small script that calls `generateAssessmentComponents`) or via the running API.
3. **Iterate** with a few fixed job descriptions and optional few-shot examples in the prompt.
4. **Document** in `AI_PROMPTS.md` when you’re happy with the result.

All assessment generation from job descriptions goes through this single prompt, so improvements there apply app-wide.
