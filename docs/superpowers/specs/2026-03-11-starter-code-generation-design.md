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
z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() }))
})
```

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

**Integration point:** Called at the end of `runAssessmentChain()`, after quality review settles and the final assessment is known.

```ts
// After quality review in runAssessmentChain()
const starterCodeFiles = await generateStarterCode(assessment, state.stack!, state.level!);
return { step1, assessment, starterCodeFiles };
```

**Return type update:** `generateAssessmentComponents()` gains `starterCodeFiles: StarterCodeFile[]`.

No controller changes required — the assessment controller already reads and saves `starterCodeFiles` to MongoDB.

### 2. Client — `StarterCodeIDE` Component

A single shared component replacing both the existing `StarterCodeFilesBlock` (candidate view) and the card-list UI (editor view).

**Props:**
```ts
interface StarterCodeIDEProps {
  files: StarterCodeFile[];
  readOnly: boolean;
  onChange?: (files: StarterCodeFile[]) => void; // editor only
}
```

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
- Active file highlighted in dark blue (matching existing brand color `#1E3A8A`)
- Editor mode only: trash icon per file on hover; "+ Add file" button at bottom of tree

**Right panel (code pane, flex-1):**
- Header: active file path (monospace) + copy-to-clipboard button
- **Read-only (candidate):** existing `SyntaxHighlighter` with `oneLight` theme — no new dependency
- **Editable (editor):** Monaco Editor (`@monaco-editor/react`), language auto-detected from file extension, lazy-loaded to avoid bundle bloat
- Editor mode: active file path in header is editable (click to rename)

**Download ZIP:** button in the top-right header, same `JSZip` logic as existing `StarterCodeFilesBlock`

### 3. Client — Integration Points

**`CandidateAssessment.jsx`:** Replace `<StarterCodeFilesBlock files={...} />` with `<StarterCodeIDE files={...} readOnly={true} />`

**`AssessmentEditor.jsx`:** Replace the card-list UI (the `starterCodeFiles.map(...)` block with textareas) with `<StarterCodeIDE files={starterCodeFiles} readOnly={false} onChange={setStarterCodeFiles} />`. The existing save flow (`saveAssessment({ starterCodeFiles })`) is unchanged.

---

## Error Handling

- **Starter code generation failure is non-fatal.** If `generateStarterCode()` throws, `generateAssessmentComponents()` returns `starterCodeFiles: []`. The assessment is still created normally.
- The editor's empty state (no files) is unchanged — the creator can add files manually.
- No user-facing error message for starter code generation failure (silent fallback).

---

## Dependencies

| Package | Usage | Already installed? |
|---|---|---|
| `jszip` | Download ZIP | Yes (used in existing `StarterCodeFilesBlock`) |
| `react-syntax-highlighter` | Read-only code display | Yes |
| `@monaco-editor/react` | Editable code pane in editor | No — needs adding to `client/package.json` |

---

## Files Changed

### Server
- `server/src/services/schemas/assessmentGeneration.ts` — add `starterCodeGenerationSchema`
- `server/src/prompts/index.ts` — add `PROMPT_GENERATE_STARTER_CODE`
- `server/src/services/assessmentGeneration.ts` — add `generateStarterCode()`, update `runAssessmentChain()` and `generateAssessmentComponents()` return type

### Client
- `client/src/components/StarterCodeIDE.tsx` (new) — shared IDE panel component
- `client/src/pages/CandidateAssessment.jsx` — replace `StarterCodeFilesBlock` with `StarterCodeIDE`
- `client/src/pages/AssessmentEditor.jsx` — replace card-list UI with `StarterCodeIDE`
- `client/package.json` — add `@monaco-editor/react`
