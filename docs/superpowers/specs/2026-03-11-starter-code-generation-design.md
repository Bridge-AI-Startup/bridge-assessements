# Starter Code Generation — Design Spec

**Date:** 2026-03-11
**Branch:** david-langchain
**Status:** Approved

---

## Overview

When an assessment is AI-generated, the system will also generate appropriate starter code files for the candidate. These files are stored on the assessment as `starterCodeFiles` and presented in a VS Code-style IDE panel in both the editor and candidate views.

---

## Goals

- Automatically generate starter code as part of assessment creation — no extra steps for the assessment creator
- Generate the right depth of scaffold for the stack (full runnable project for frontend/full-stack; minimal stubs for backend/algorithmic)
- Present starter code in a VS Code-style IDE panel (file tree + code pane) for both candidates and editors

## Non-Goals

- Template-based generation (fully AI-generated)
- On-demand regeneration button (out of scope for this iteration)
- Syntax validation or compilation checks on generated files

---

## Architecture

### 1. Server — Starter Code Generation

**New schema:** `starterCodeGenerationSchema` in `server/src/services/schemas/assessmentGeneration.ts`

```ts
const starterCodeGenerationSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() }))
});
type StarterCodeFile = { path: string; content: string };
```

Use `z.infer<typeof starterCodeGenerationSchema>["files"]` as the server-side `StarterCodeFile[]` type — no separate type file needed.

**New prompt:** `PROMPT_GENERATE_STARTER_CODE` in `server/src/prompts/index.ts`

- System prompt instructs the LLM to decide scaffold depth based on stack context:
  - **Frontend / full-stack** (React, Vue, Next.js, etc.): full runnable project — `package.json`, config, entry point, boilerplate, and stub file(s) the candidate fills in
  - **Backend / API** (Node/Express, Python/Flask, etc.): minimal but runnable — `package.json` or equivalent, stub entry file, README
  - **Algorithmic / generic**: README with problem statement + one stub file
- README always contains the problem statement derived from the assessment description
- Files scaffold the task but do not solve it

**New function:** `generateStarterCode(assessment, stack, level)` in `server/src/services/assessmentGeneration.ts`

- Makes one `createChatCompletionWithStructuredOutput` call using `PROMPT_GENERATE_STARTER_CODE` and `starterCodeGenerationSchema`
- One retry on parse failure (consistent with existing retry pattern)
- Returns `StarterCodeFile[]`
- Failure is non-fatal: returns `[]` on error

**Integration point:** Called at the end of `runAssessmentChain()`, after quality review settles and the final assessment is known.

```ts
// After quality review in runAssessmentChain()
const starterCodeFiles = await generateStarterCode(assessment, state.stack!, state.level!);
return { step1, assessment, starterCodeFiles };
```

**Return type updates:**
- `runAssessmentChain()` gains `starterCodeFiles: StarterCodeFile[]`
- `generateAssessmentComponents()` gains `starterCodeFiles: StarterCodeFile[]`
- `generateAssessmentComponentsWithSteps()` gains `starterCodeFiles: StarterCodeFile[]`
- `server/src/services/openai.ts` re-exports `generateAssessmentComponents` — its return type annotation must also be updated

**Fallback paths:** Both `generateAssessmentComponents` and `generateAssessmentComponentsWithSteps` have top-level catch blocks that return plain fallback objects. These must include `starterCodeFiles: []` to match the updated return type — otherwise TypeScript will error on the fallback return statements.

**Latency note:** In the worst case (quality review retry + starter code generation + its own parse retry), total generation time increases by one to two LLM round-trips. This is acceptable — the generate endpoint is already a multi-step async call and the client shows a loading state. No timeout changes are required.

### 2. Server — Controller & API Changes

The `generateAssessmentData` controller currently destructures only `{ title, description, timeLimit }` from `generateAssessmentComponents()` and returns these to the client. It must be updated to also pass through `starterCodeFiles`.

**`server/src/controllers/assessment.ts` — `generateAssessmentData` handler:**

Two changes:
1. Update the `GenerateResponse` type (defined in the controller or its imported types) to include `starterCodeFiles?: StarterCodeFile[]`
2. Destructure and pass through `starterCodeFiles` in the response:

```ts
// Before
const { title, description, timeLimit } = await generateAssessmentComponents(jobDescription, options);
res.json({ title, description, timeLimit });

// After
const { title, description, timeLimit, starterCodeFiles } = await generateAssessmentComponents(jobDescription, options);
res.json({ title, description, timeLimit, starterCodeFiles });
```

**`client/src/api/assessment.ts` — `generateAssessmentData` function signature and response type:**

Update both the `APIResult<{ ... }>` return type annotation on the `generateAssessmentData` function signature and any internal response type alias to include `starterCodeFiles`:
```ts
starterCodeFiles?: StarterCodeFile[];
```

The client reads the generate response and pre-populates the `AssessmentEditor` state (including `starterCodeFiles`) before the assessment is saved. The existing create/update save flow then persists `starterCodeFiles` to MongoDB unchanged.

### 3. Client — `StarterCodeIDE` Component

A single shared component replacing both the existing `StarterCodeFilesBlock` local function (in `CandidateAssessment.jsx`) and the card-list UI in `AssessmentEditor.jsx`.

**Props:**
```ts
interface StarterCodeIDEProps {
  files: StarterCodeFile[];
  readOnly: boolean;
  onChange?: (files: StarterCodeFile[]) => void; // editor only
}
```

**Empty state:** When `files` is empty, `StarterCodeIDE` renders nothing (returns `null`). The parent components already conditionally render based on `files.length > 0` — this behaviour is preserved.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ STARTER CODE                          [Download ZIP] │
├──────────────────┬──────────────────────────────────┤
│ 📁 src           │ src/App.jsx              [Copy]   │
│   📄 App.jsx  ←  │                                   │
│   📄 main.jsx    │  <code here>                      │
│ 📄 package.json  │                                   │
│ 📄 README.md     │                                   │
│                  │                                   │
│ [+ Add file]     │                                   │  ← editor only
└──────────────────┴──────────────────────────────────┘
```

**Left panel (file tree, ~220px):**
- Parses flat `path` strings into a nested folder tree (e.g. `src/App.jsx` → `src/` folder containing `App.jsx`)
- Folders are collapsible; expand/collapse state managed locally
- File icons vary by extension (`.jsx`/`.tsx`, `.json`, `.md`, `.css`, `.html`, etc.)
- Active file highlighted in dark blue (`#1E3A8A`)
- Editor mode only: trash icon per file on hover; "+ Add file" button at bottom of tree

**Right panel (code pane, flex-1):**
- Header: active file path (monospace) + copy-to-clipboard button
- **Read-only (candidate):** existing `SyntaxHighlighter` with `oneLight` theme — no new dependency
- **Editable (editor):** Monaco Editor (`@monaco-editor/react`), language auto-detected from file extension

**Monaco lazy-loading:** Use `React.lazy` + `Suspense`. The Monaco component is wrapped in `React.lazy(() => import('./MonacoEditor'))` and wrapped in `<Suspense fallback={<div className="...">Loading editor…</div>}>` in the code pane. This keeps the candidate view (which uses SyntaxHighlighter only) free of the Monaco bundle.

**File renaming in editor mode:** The active file's path is editable via a text input in the right-panel header. Rename is committed on `blur` or `Enter` key. If the new path includes a new directory segment (e.g. renaming `App.jsx` → `src/App.jsx`), the file tree is re-parsed from the updated `files` array. Duplicate paths are prevented: if the entered path already exists in `files`, the rename is rejected and the input reverts to the original value.

**Download ZIP:** button in the top-right header, same `JSZip` logic as existing `StarterCodeFilesBlock`.

**Editor-mode toolbar (header row, `readOnly={false}` only):** Contains "Use template: React + Vite frontend" (moved from `AssessmentEditor`) and a "Clear all" button. The existing standalone "Clear starter code" button in `AssessmentEditor` is removed and replaced by this "Clear all" button inside `StarterCodeIDE`. Per-file deletion is handled by the trash icon on each file in the tree; "Clear all" removes all files at once by calling `onChange([])`.

### 4. Client — Integration Points

**`CandidateAssessment.jsx`:**
- Delete the local `StarterCodeFilesBlock` function definition (lines 46–110)
- Replace `<StarterCodeFilesBlock files={...} />` with `<StarterCodeIDE files={...} readOnly={true} />`
- Add import for `StarterCodeIDE`

**`AssessmentEditor.jsx`:**
- Replace the card-list UI (`starterCodeFiles.map(...)` block with textareas and path inputs) with `<StarterCodeIDE files={starterCodeFiles} readOnly={false} onChange={setStarterCodeFiles} />`
- Remove the inline "Use template" and "Clear starter code" buttons from their current location (they move into `StarterCodeIDE`)
- The existing save flow (`saveAssessment({ starterCodeFiles })`) is unchanged

---

## Error Handling

- **Starter code generation failure is non-fatal.** If `generateStarterCode()` throws, it returns `[]`. `generateAssessmentComponents()` still returns the assessment with `starterCodeFiles: []`.
- When `starterCodeFiles` is empty, `StarterCodeIDE` renders nothing — the editor's empty state is unchanged.
- No user-facing error message for starter code generation failure (silent fallback).

---

## Dependencies

| Package | Usage | Already installed? |
|---|---|---|
| `jszip` | Download ZIP | Yes (used in existing `StarterCodeFilesBlock`) |
| `react-syntax-highlighter` | Read-only code display | Yes |
| `@monaco-editor/react` | Editable code pane in editor | No — add to `client/package.json` |

---

## Files Changed

### Server
- `server/src/services/schemas/assessmentGeneration.ts` — add `starterCodeGenerationSchema`
- `server/src/prompts/index.ts` — add `PROMPT_GENERATE_STARTER_CODE`
- `server/src/services/assessmentGeneration.ts` — add `generateStarterCode()`, update `runAssessmentChain()`, `generateAssessmentComponents()`, and `generateAssessmentComponentsWithSteps()` return types
- `server/src/services/openai.ts` — update return type annotation for `generateAssessmentComponents` re-export
- `server/src/controllers/assessment.ts` — pass `starterCodeFiles` through in `generateAssessmentData` response

### Client
- `client/src/components/StarterCodeIDE.tsx` (new) — shared IDE panel component
- `client/src/pages/CandidateAssessment.jsx` — delete `StarterCodeFilesBlock`, replace with `StarterCodeIDE`
- `client/src/pages/AssessmentEditor.jsx` — replace card-list UI and template button with `StarterCodeIDE`
- `client/src/api/assessment.ts` — add `starterCodeFiles` to generate response type
- `client/package.json` — add `@monaco-editor/react`
