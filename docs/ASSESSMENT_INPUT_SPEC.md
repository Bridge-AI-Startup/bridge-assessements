# Assessment Input Spec & Parser

This doc describes the infrastructure for breaking down user input (job description) into structured aspects so we can build **better assessment prompts**.

## What gets extracted

When a user pastes a job description, we optionally run an **input parser** that produces an `AssessmentInputSpec`:

| Field | Type | Example |
|-------|------|--------|
| `skillLevel` | `intern` \| `junior` \| `mid` \| `senior` \| `staff` \| `principal` \| null | `"senior"` |
| `roleFocus` | `backend` \| `frontend` \| `fullstack` \| `mobile` \| `devops` \| `data` \| `embedded` \| `other` \| null | `"backend"` |
| `techStack` | string[] | `["Node.js", "PostgreSQL", "TypeScript"]` |
| `experienceYears` | string \| null | `"5+"` or `"3-5"` |
| `roleSummary` | string \| null | One-sentence role summary |
| `scopeHints` | string[] | e.g. "under 2 hours", "no external APIs" |
| `confidence` | `low` \| `medium` \| `high` | How clear the signals were |

## Flow

1. **Client** sends `description` (job description text) to `POST /api/assessments/generate`.
2. **Server** (when `ENABLE_ASSESSMENT_INPUT_PARSING` is not `false`):
   - Calls `parseAssessmentInput(description)` → LLM returns JSON → normalized to `AssessmentInputSpec`.
   - If the spec has any useful fields (tech stack, skill level, role focus, or role summary), the **generation prompt** is built with `userTemplateWithSpec(...)`, which injects a "Structured context" block so the model can align scope and difficulty.
   - Otherwise, the original `userTemplate(...)` is used (raw job description only).
3. **Assessment generation** runs as before, with the same system prompt and JSON output; the user message now includes the structured context when available.

## Files

- **Types:** `server/src/types/assessmentInputSpec.ts` — `AssessmentInputSpec`, `SkillLevel`, `RoleFocus`, default spec.
- **Prompt:** `server/src/prompts/index.ts` — `PROMPT_PARSE_ASSESSMENT_INPUT` (parse job description to JSON), and `userTemplateWithSpec` on `PROMPT_GENERATE_ASSESSMENT_COMPONENTS`.
- **Service:** `server/src/services/assessmentInputAnalyzer.ts` — `parseAssessmentInput(description)` using the parse prompt and `createChatCompletion("assessment_input_parsing", ...)`.
- **Wiring:** `server/src/services/openai.ts` — before generating, calls the analyzer and uses `userTemplateWithSpec` when the spec has useful fields.
- **LangChain use case:** `server/src/services/langchainAI.ts` — `AIUseCase` includes `"assessment_input_parsing"` so you can set `AI_PROVIDER_ASSESSMENT_INPUT_PARSING` or `OPENAI_MODEL_ASSESSMENT_INPUT_PARSING` etc. if needed.

## Configuration

- **Enable/disable parsing:** `ENABLE_ASSESSMENT_INPUT_PARSING` — default is enabled; set to `"false"` or `"0"` to skip parsing and use only the raw description.
- **Per-use-case AI:** Use `AI_PROVIDER_ASSESSMENT_INPUT_PARSING` and `*_MODEL_ASSESSMENT_INPUT_PARSING` to point parsing at a different provider/model (e.g. a cheaper/faster model).

## Extending the spec

To add new aspects (e.g. "industry", "team size"):

1. Extend `AssessmentInputSpec` and `DEFAULT_ASSESSMENT_INPUT_SPEC` in `assessmentInputSpec.ts`.
2. Update `PROMPT_PARSE_ASSESSMENT_INPUT` in `prompts/index.ts` to ask for the new field and include it in the JSON.
3. In `assessmentInputAnalyzer.ts`, read the new field from the parsed JSON and normalize it.
4. In `PROMPT_GENERATE_ASSESSMENT_COMPONENTS.userTemplateWithSpec`, add the new field to the "Structured context" block so generation can use it.

## Optional: Expose spec to the client

The API currently does **not** return the parsed spec. To show "We detected: Senior, Node.js, PostgreSQL" or let users edit before generating:

- Add an optional query or body flag, e.g. `?includeInputSpec=true` or a two-step flow: `POST /api/assessments/parse-input` that returns only the spec, then the client calls generate with the same description (and optionally the spec if you later allow overrides).
- Or have `POST /api/assessments/generate` return `{ title, description, timeLimit, reviewFeedback?, inputSpec? }` when a header or flag is set.
