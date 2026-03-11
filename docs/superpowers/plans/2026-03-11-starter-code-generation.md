# Starter Code Generation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate starter code files as part of assessment creation and display them in a VS Code-style IDE panel for both editors and candidates.

**Architecture:** A new `generateStarterCode()` function is called at the end of the existing `runAssessmentChain()` after quality review settles. It makes one LLM call and returns `StarterCodeFile[]`, which flows through the controller to the client. A new `StarterCodeIDE` React component (file tree + syntax-highlighted or Monaco-editable pane) replaces the existing flat card-list UI in the editor and the `StarterCodeFilesBlock` in the candidate view.

**Tech Stack:** TypeScript, Node.js/Express, LangChain (LCEL), Zod, React, `@monaco-editor/react`, `react-syntax-highlighter`, `jszip`

---

## File Structure

**New files:**
- `client/src/components/StarterCodeIDE/buildFileTree.ts` — pure function, parses flat `{path}[]` into tree; testable in isolation
- `client/src/components/StarterCodeIDE/index.tsx` — VS Code-style IDE panel component

**Modified files:**
- `server/src/services/schemas/assessmentGeneration.ts` — add `starterCodeGenerationSchema`
- `server/src/prompts/index.ts` — add `PROMPT_GENERATE_STARTER_CODE`
- `server/src/services/assessmentGeneration.ts` — add `generateStarterCode()`, update `runAssessmentChain()` and both public exports
- `server/src/services/openai.ts` — update `generateAssessmentComponents` return type annotation
- `server/src/controllers/assessment.ts` — update `GenerateResponse` type, destructure and pass `starterCodeFiles`
- `client/src/api/assessment.ts` — update `generateAssessmentData` return type
- `client/src/pages/CandidateAssessment.jsx` — delete `StarterCodeFilesBlock`, replace with `StarterCodeIDE`
- `client/src/pages/AssessmentEditor.jsx` — replace card-list UI and template/clear buttons with `StarterCodeIDE`
- `client/package.json` — add `@monaco-editor/react`

---

## Chunk 1: Server — Schema, Prompt, and `generateStarterCode()`

### Task 1: Add `starterCodeGenerationSchema`

**Files:**
- Modify: `server/src/services/schemas/assessmentGeneration.ts`

- [ ] **Step 1: Add the schema** — append to the bottom of the file:

```ts
/** Starter code generation output: a list of files. */
export const starterCodeGenerationSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().describe("Relative file path, e.g. src/App.jsx"),
      content: z.string().describe("Full file content as a string"),
    })
  ),
});

export type StarterCodeGenerationOutput = z.infer<typeof starterCodeGenerationSchema>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/schemas/assessmentGeneration.ts
git commit -m "feat: add starterCodeGenerationSchema"
```

---

### Task 2: Add `PROMPT_GENERATE_STARTER_CODE`

**Files:**
- Modify: `server/src/prompts/index.ts`

- [ ] **Step 1: Add the prompt** — insert after `PROMPT_ASSESSMENT_QUALITY_REVIEW` (around line 246), before the interview prompts section:

```ts
// ============================================================================
// STARTER CODE GENERATION
// ============================================================================

export const PROMPT_GENERATE_STARTER_CODE = {
  provider: "anthropic" as AIProvider,
  model: undefined as string | undefined,

  system: `You are an expert software engineer who creates starter code scaffolds for take-home coding assessments. Given an assessment description and tech stack, generate appropriate starter files for the candidate.

SCAFFOLD DEPTH — choose based on stack context:
- Frontend / full-stack (React, Vue, Next.js, Angular, etc.): Full runnable project. Include package.json, build config (vite.config.js or equivalent), entry point, boilerplate App file, and 1-2 stub files the candidate fills in. Must run with "npm install && npm run dev".
- Backend / API (Node/Express, Python/Flask/FastAPI, Go, etc.): Minimal but runnable. Include package.json or requirements.txt, a stub entry file, and README.md. Must run with minimal commands.
- Algorithmic / generic / unclear: Just README.md (with problem statement + setup) and a single stub file (e.g. solution.js or main.py) with the function signature stubbed out.
- Use judgment: if the assessment description makes the right scaffold obvious, follow it even if the stack label is ambiguous.

CONTENT RULES:
- Always include README.md. It must contain: the problem statement (derived from the assessment description), setup instructions (npm install / npm run dev or equivalent), and a brief "Getting Started" section.
- Stub files must define the structure (function signatures, component shells, route stubs) but leave the implementation for the candidate. Do not implement the solution.
- Do not include node_modules/, .env, secrets, or lock files.
- Keep file count reasonable: 5–12 files for full scaffold, 2–4 for minimal, 1–2 for algorithmic.
- Paths must be relative (no leading slash).

OUTPUT: Respond with a JSON object with key "files" containing an array of {path, content} objects.`,

  userTemplate: (
    assessment: { title: string; description: string; timeLimit: number },
    stack: string,
    level: string
  ): string =>
    `Generate starter code for this assessment.

Title: ${assessment.title}
Time limit: ${assessment.timeLimit} minutes
Tech stack: ${stack}
Level: ${level}

Assessment description:
${assessment.description}

Generate the appropriate starter code files as JSON: { "files": [{ "path": "...", "content": "..." }, ...] }`,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/prompts/index.ts
git commit -m "feat: add PROMPT_GENERATE_STARTER_CODE"
```

---

### Task 3: Add `generateStarterCode()` function

**Files:**
- Modify: `server/src/services/assessmentGeneration.ts`

The function follows the same retry pattern as `runStep1` / `runStep2`. Add it after the `runQualityReviewLLM` function (around line where that function ends, before `buildAssessmentChain`).

- [ ] **Step 1: Add the import** — add `PROMPT_GENERATE_STARTER_CODE` to the existing import from `"../prompts/index.js"`:

```ts
import {
  PROMPT_EXTRACT_ASSESSMENT_REQUIREMENTS,
  PROMPT_GENERATE_ASSESSMENT_COMPONENTS,
  PROMPT_ASSESSMENT_QUALITY_REVIEW,
  PROMPT_GENERATE_STARTER_CODE,   // add this
  LEVEL_INSTRUCTIONS,
} from "../prompts/index.js";
```

- [ ] **Step 2: Add the schema import** — add `starterCodeGenerationSchema` to the existing import from `"./schemas/assessmentGeneration.js"`:

```ts
import {
  requirementsExtractionSchema,
  assessmentOutputSchema,
  assessmentReviewSchema,
  starterCodeGenerationSchema,   // add this
  type RequirementsExtraction,
  type AssessmentOutput,
} from "./schemas/assessmentGeneration.js";
```

- [ ] **Step 3: Add the `generateStarterCode` function** — insert before `buildAssessmentChain`:

```ts
/** Generate starter code files for the assessment. Returns [] on failure (non-fatal). */
async function generateStarterCode(
  assessment: { title: string; description: string; timeLimit: number },
  stack: AssessmentStack,
  level: RoleLevel
): Promise<Array<{ path: string; content: string }>> {
  const messages: ChatMessage[] = [
    { role: "system", content: PROMPT_GENERATE_STARTER_CODE.system },
    {
      role: "user",
      content: PROMPT_GENERATE_STARTER_CODE.userTemplate(assessment, stack, level),
    },
  ];

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { result } = await createChatCompletionWithStructuredOutput(
        "starter_code_generation",
        messages,
        starterCodeGenerationSchema,
        {
          temperature: 0.5,
          maxTokens: 4000,
          provider: PROMPT_GENERATE_STARTER_CODE.provider as "openai" | "anthropic" | "gemini",
          model: PROMPT_GENERATE_STARTER_CODE.model,
        }
      );
      console.log(`✅ [generateStarterCode] Generated ${result.files.length} files`);
      return result.files;
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ [generateStarterCode] Attempt ${attempt} failed:`, err);
      if (attempt < 2) await delay(RETRY_DELAY_MS);
    }
  }
  console.error("❌ [generateStarterCode] Failed after retries:", lastError);
  return [];
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/assessmentGeneration.ts
git commit -m "feat: add generateStarterCode function"
```

---

## Chunk 2: Server — Chain Integration + Controller

### Task 4: Wire `generateStarterCode` into `runAssessmentChain` and update all return types

**Files:**
- Modify: `server/src/services/assessmentGeneration.ts`
- Modify: `server/src/services/openai.ts`

The `AssessmentChainState` interface and `runAssessmentChain` return type need updating. There are also two catch-block fallbacks in the public exports that must include `starterCodeFiles: []`.

- [ ] **Step 1: Update `AssessmentChainState`** — find the interface (around line where it's defined) and add a `starterCodeFiles` field:

```ts
interface AssessmentChainState {
  jobDescription: string;
  domain: string;
  seed: string;
  options?: GenerateAssessmentOptions;
  step1?: RequirementsExtraction;
  stack?: AssessmentStack;
  level?: RoleLevel;
  raw?: AssessmentOutput;
  assessment?: { title: string; description: string; timeLimit: number };
  starterCodeFiles?: Array<{ path: string; content: string }>;  // add this
}
```

- [ ] **Step 2: Update `runAssessmentChain` return type** — the function signature currently returns `Promise<{ step1, assessment }>`. Update to include `starterCodeFiles`:

```ts
async function runAssessmentChain(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{
  step1: RequirementsExtraction;
  assessment: { title: string; description: string; timeLimit: number; reviewFeedback?: string };
  starterCodeFiles: Array<{ path: string; content: string }>;
}>
```

- [ ] **Step 3: Call `generateStarterCode` at the end of `runAssessmentChain`** — there are **9 return sites** in `runAssessmentChain`. Replace each one with a version that includes `starterCodeFiles`. For the happy path, generate starter code right before returning. For all early-return fallback sites, also generate starter code for the settled assessment.

Here is every return site and its replacement (line numbers from current file):

**Line 490** — rule retry fails rule check again:
```ts
// Before:
return { step1, assessment: { ...retryAssessment, reviewFeedback: retryRule.reviewFeedback } };
// After:
const scFiles490 = await generateStarterCode(retryAssessment, state.stack!, state.level!);
return { step1, assessment: { ...retryAssessment, reviewFeedback: retryRule.reviewFeedback }, starterCodeFiles: scFiles490 };
```

**Line 493** — rule retry passes LLM:
```ts
// Before:
if (retryLLM.passed) return { step1, assessment: retryAssessment };
// After:
if (retryLLM.passed) {
  const scFiles493 = await generateStarterCode(retryAssessment, state.stack!, state.level!);
  return { step1, assessment: retryAssessment, starterCodeFiles: scFiles493 };
}
```

**Line 494** — rule retry fails LLM:
```ts
// Before:
return { step1, assessment: { ...retryAssessment, reviewFeedback: retryLLM.reviewFeedback } };
// After:
const scFiles494 = await generateStarterCode(retryAssessment, state.stack!, state.level!);
return { step1, assessment: { ...retryAssessment, reviewFeedback: retryLLM.reviewFeedback }, starterCodeFiles: scFiles494 };
```

**Line 496** — inner catch of rule retry:
```ts
// Before:
return { step1, assessment: { ...assessment, reviewFeedback: ruleReview.reviewFeedback } };
// After:
const scFiles496 = await generateStarterCode(assessment, state.stack!, state.level!);
return { step1, assessment: { ...assessment, reviewFeedback: ruleReview.reviewFeedback }, starterCodeFiles: scFiles496 };
```

**Line 517** — LLM retry fails rule check:
```ts
// Before:
return { step1, assessment: { ...retryAssessment, reviewFeedback: retryRule.reviewFeedback } };
// After:
const scFiles517 = await generateStarterCode(retryAssessment, state.stack!, state.level!);
return { step1, assessment: { ...retryAssessment, reviewFeedback: retryRule.reviewFeedback }, starterCodeFiles: scFiles517 };
```

**Line 520** — LLM retry passes LLM:
```ts
// Before:
if (retryLLM.passed) return { step1, assessment: retryAssessment };
// After:
if (retryLLM.passed) {
  const scFiles520 = await generateStarterCode(retryAssessment, state.stack!, state.level!);
  return { step1, assessment: retryAssessment, starterCodeFiles: scFiles520 };
}
```

**Line 521** — LLM retry fails LLM again:
```ts
// Before:
return { step1, assessment: { ...retryAssessment, reviewFeedback: retryLLM.reviewFeedback } };
// After:
const scFiles521 = await generateStarterCode(retryAssessment, state.stack!, state.level!);
return { step1, assessment: { ...retryAssessment, reviewFeedback: retryLLM.reviewFeedback }, starterCodeFiles: scFiles521 };
```

**Line 523** — inner catch of LLM retry:
```ts
// Before:
return { step1, assessment: { ...assessment, reviewFeedback: llmReview.reviewFeedback } };
// After:
const scFiles523 = await generateStarterCode(assessment, state.stack!, state.level!);
return { step1, assessment: { ...assessment, reviewFeedback: llmReview.reviewFeedback }, starterCodeFiles: scFiles523 };
```

**Line 527** — happy path (final return):
```ts
// Before:
return { step1, assessment };
// After:
const starterCodeFiles = await generateStarterCode(assessment, state.stack!, state.level!);
return { step1, assessment, starterCodeFiles };
```

- [ ] **Step 4: Update `generateAssessmentComponents` return type and fallback** — find the function, update its return type, and add `starterCodeFiles: []` to the catch-block fallback:

```ts
export async function generateAssessmentComponents(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{ title: string; description: string; timeLimit: number; reviewFeedback?: string; starterCodeFiles: Array<{ path: string; content: string }> }> {
  console.log("🤖 [assessmentGeneration] LCEL chain: extract requirements → generate assessment → review");
  try {
    const { assessment, starterCodeFiles } = await runAssessmentChain(jobDescription, options);
    return { ...assessment, starterCodeFiles };
  } catch (error) {
    console.error("❌ [assessmentGeneration] Error:", error);
    console.log("🔄 [assessmentGeneration] Falling back to simple defaults...");
    const firstSentence = jobDescription.split(/[.!?]/)[0].trim();
    const title = firstSentence.length > 0 && firstSentence.length <= 100
      ? firstSentence
      : jobDescription.substring(0, 50).trim() + "...";
    const description = `Assessment generation could not be completed. Please try again or create the assessment manually. (Error: ${error instanceof Error ? error.message : "unknown"})`;
    return { title, description, timeLimit: 60, starterCodeFiles: [] };  // add starterCodeFiles: []
  }
}
```

- [ ] **Step 5: Update `generateAssessmentComponentsWithSteps` return type and fallback** — update the function signature's return type and add `starterCodeFiles: []` to the existing catch-block return on line 587. The catch block already constructs `step1` and `assessment` locally — just add `starterCodeFiles: []`:

```ts
// Update the return type (lines 564-567):
): Promise<{
  step1: RequirementsExtraction;
  assessment: { title: string; description: string; timeLimit: number; reviewFeedback?: string };
  starterCodeFiles: Array<{ path: string; content: string }>;
}>

// The try block (line 570) already returns from runAssessmentChain which now includes starterCodeFiles — no change needed there.

// Update line 587 in the catch block from:
return { step1, assessment };
// To:
return { step1, assessment, starterCodeFiles: [] };
```

- [ ] **Step 6: Update `openai.ts` return type annotation** — in `server/src/services/openai.ts`, update the `generateAssessmentComponents` wrapper:

```ts
export async function generateAssessmentComponents(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{
  title: string;
  description: string;
  timeLimit: number;
  reviewFeedback?: string;
  starterCodeFiles: Array<{ path: string; content: string }>;
}> {
  return generateAssessmentComponentsFromChain(jobDescription, options);
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/assessmentGeneration.ts server/src/services/openai.ts
git commit -m "feat: wire generateStarterCode into assessment chain, update return types"
```

---

### Task 5: Update the controller to pass `starterCodeFiles` through

**Files:**
- Modify: `server/src/controllers/assessment.ts`

- [ ] **Step 1: Update `GenerateResponse` type** — find the type definition (around line 21):

```ts
export type GenerateResponse = {
  title: string;
  description: string;
  timeLimit: number;
  starterCodeFiles: Array<{ path: string; content: string }>;  // add this (required, matches service return type)
};
```

- [ ] **Step 2: Update `generateAssessmentData` handler** — find the destructuring (around line 441) and response construction (around line 460):

```ts
// Change destructuring from:
const {
  title,
  description: generatedDescription,
  timeLimit,
} = await generateAssessmentComponents(description, options);

// To:
const {
  title,
  description: generatedDescription,
  timeLimit,
  starterCodeFiles,
} = await generateAssessmentComponents(description, options);
```

And update the response object:
```ts
const response: GenerateResponse = {
  title,
  description: generatedDescription || description,
  timeLimit,
  starterCodeFiles,  // add this
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Smoke-test the endpoint** — start the server (`npm run dev`) and call the generate endpoint with curl (replace `YOUR_TOKEN` with a valid Firebase ID token):

```bash
curl -s -X POST http://localhost:5050/assessments/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "We are hiring a React frontend engineer with 3 years experience."}' \
  | jq '{title, timeLimit, fileCount: (.starterCodeFiles | length)}'
```

Expected: `{ "title": "...", "timeLimit": ..., "fileCount": <number > 0> }` (or `0` on LLM failure, which is acceptable).

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/assessment.ts
git commit -m "feat: pass starterCodeFiles through generate endpoint"
```

---

## Chunk 3: Client — `buildFileTree` Utility + `StarterCodeIDE` Component (Read-Only)

### Task 6: Create `buildFileTree` pure utility

**Files:**
- Create: `client/src/components/StarterCodeIDE/buildFileTree.ts`

- [ ] **Step 1: Create the directory and file**

```ts
// client/src/components/StarterCodeIDE/buildFileTree.ts

export type FileTreeFile = {
  type: "file";
  name: string;
  path: string; // full original path
};

export type FileTreeDir = {
  type: "dir";
  name: string;
  children: FileTreeNode[];
};

export type FileTreeNode = FileTreeFile | FileTreeDir;

/**
 * Parses a flat array of {path} objects into a nested tree.
 * E.g. ["src/App.jsx", "src/main.jsx", "package.json"] →
 *   [{ type: "dir", name: "src", children: [...] }, { type: "file", name: "package.json", path: "package.json" }]
 */
export function buildFileTree(files: { path: string }[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        currentLevel.push({ type: "file", name, path: file.path });
      } else {
        let dir = currentLevel.find(
          (n): n is FileTreeDir => n.type === "dir" && n.name === name
        );
        if (!dir) {
          dir = { type: "dir", name, children: [] };
          currentLevel.push(dir);
        }
        currentLevel = dir.children;
      }
    }
  }

  return root;
}
```

- [ ] **Step 2: Manually verify the function logic** — create a quick inline test by temporarily adding a `console.log` test to a scratch file, or simply reason through it:

Given input: `[{ path: "src/App.jsx" }, { path: "src/main.jsx" }, { path: "package.json" }]`
Expected output tree: `[{ type: "dir", name: "src", children: [{ type: "file", name: "App.jsx", path: "src/App.jsx" }, { type: "file", name: "main.jsx", path: "src/main.jsx" }] }, { type: "file", name: "package.json", path: "package.json" }]`

Edge case: `[{ path: "README.md" }]` → `[{ type: "file", name: "README.md", path: "README.md" }]` (no directory)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/StarterCodeIDE/buildFileTree.ts
git commit -m "feat: add buildFileTree utility for StarterCodeIDE"
```

---

### Task 7: Create `StarterCodeIDE` component — structure and read-only mode

**Files:**
- Create: `client/src/components/StarterCodeIDE/index.tsx`
- Modify: `client/package.json` — add `@monaco-editor/react`

Install Monaco first:

- [ ] **Step 1: Install `@monaco-editor/react`**

```bash
cd client && npm install @monaco-editor/react
```

- [ ] **Step 2: Write the full component** — create `client/src/components/StarterCodeIDE/index.tsx`:

```tsx
import React, { useState, lazy, Suspense } from "react";
import { ChevronRight, ChevronDown, File, Folder, Download, Copy, Check, Plus, Trash2 } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import JSZip from "jszip";
import { buildFileTree, type FileTreeNode } from "./buildFileTree";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.Editor }))
);

export type StarterCodeFile = { path: string; content: string };

interface StarterCodeIDEProps {
  files: StarterCodeFile[];
  readOnly: boolean;
  onChange?: (files: StarterCodeFile[]) => void;
}

function getLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
    json: "json", md: "markdown", css: "css", html: "html",
    yml: "yaml", yaml: "yaml", sh: "shell",
  };
  return map[ext] ?? "plaintext";
}

// File tree node rendered recursively
function TreeNode({
  node,
  activePath,
  onSelect,
  readOnly,
  onDelete,
  expanded,
  onToggle,
}: {
  node: FileTreeNode;
  activePath: string;
  onSelect: (path: string) => void;
  readOnly: boolean;
  onDelete?: (path: string) => void;
  expanded: Record<string, boolean>;
  onToggle: (name: string) => void;
}) {
  if (node.type === "file") {
    const isActive = node.path === activePath;
    return (
      <div
        className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs rounded-sm select-none ${
          isActive ? "bg-[#1E3A8A] text-white" : "text-slate-700 hover:bg-slate-100"
        }`}
        onClick={() => onSelect(node.path)}
      >
        <File className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="flex-1 font-mono truncate">{node.name}</span>
        {!readOnly && onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(node.path); }}
            className={`shrink-0 opacity-0 group-hover:opacity-100 ${isActive ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-red-500"}`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  // Directory
  const isOpen = expanded[node.name] !== false; // default open
  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs text-slate-700 hover:bg-slate-100 rounded-sm select-none"
        onClick={() => onToggle(node.name)}
      >
        {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />
        <span className="font-mono text-xs">{node.name}</span>
      </div>
      {isOpen && (
        <div className="pl-3">
          {node.children.map((child, i) => (
            <TreeNode
              key={i}
              node={child}
              activePath={activePath}
              onSelect={onSelect}
              readOnly={readOnly}
              onDelete={onDelete}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StarterCodeIDE({ files, readOnly, onChange }: StarterCodeIDEProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState("");

  if (!files.length) return null;

  const activeFile = files[Math.min(activeIndex, files.length - 1)];
  const tree = buildFileTree(files);

  const handleSelect = (path: string) => {
    const idx = files.findIndex((f) => f.path === path);
    if (idx !== -1) setActiveIndex(idx);
  };

  const handleToggle = (dirName: string) => {
    setExpanded((prev) => ({ ...prev, [dirName]: prev[dirName] === false ? true : false }));
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    files.forEach(({ path, content }) => zip.file(path, content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "starter-code.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleContentChange = (value: string | undefined) => {
    if (!onChange) return;
    const updated = files.map((f, i) => i === activeIndex ? { ...f, content: value ?? "" } : f);
    onChange(updated);
  };

  const handleDeleteFile = (path: string) => {
    if (!onChange) return;
    const updated = files.filter((f) => f.path !== path);
    onChange(updated);
    setActiveIndex(Math.min(activeIndex, updated.length - 1));
  };

  const handleAddFile = () => {
    if (!onChange) return;
    const newFile = { path: "new-file.txt", content: "" };
    const updated = [...files, newFile];
    onChange(updated);
    setActiveIndex(updated.length - 1);
  };

  const handleLoadTemplate = async () => {
    if (!onChange) return;
    try {
      const res = await fetch("/starter-templates/react-vite.json");
      if (!res.ok) throw new Error("Failed to load template");
      const templateFiles = await res.json();
      onChange(templateFiles);
      setActiveIndex(0);
    } catch (err) {
      console.error(err);
      alert("Failed to load template");
    }
  };

  const handleClearAll = () => {
    if (!onChange) return;
    if (!confirm("Clear all starter code files?")) return;
    onChange([]);
  };

  const commitPathRename = () => {
    if (!onChange || editingPath === null) return;
    const trimmed = draftPath.trim();
    if (!trimmed || (trimmed !== editingPath && files.some((f) => f.path === trimmed))) {
      setEditingPath(null);
      return; // reject duplicate or empty
    }
    const updated = files.map((f) => f.path === editingPath ? { ...f, path: trimmed } : f);
    onChange(updated);
    setEditingPath(null);
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Starter Code</span>
          {!readOnly && (
            <div className="flex gap-1.5 ml-2">
              <button
                type="button"
                onClick={handleLoadTemplate}
                className="text-xs px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
              >
                React + Vite template
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs px-2 py-0.5 rounded border border-slate-200 text-red-500 hover:bg-red-50"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleDownloadZip}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
        >
          <Download className="w-3.5 h-3.5" />
          Download ZIP
        </button>
      </div>

      <div className="flex" style={{ minHeight: 320 }}>
        {/* File tree */}
        <div className="w-52 shrink-0 border-r border-slate-200 py-2 overflow-y-auto bg-slate-50/50">
          {tree.map((node, i) => (
            <TreeNode
              key={i}
              node={node}
              activePath={activeFile.path}
              onSelect={handleSelect}
              readOnly={readOnly}
              onDelete={readOnly ? undefined : handleDeleteFile}
              expanded={expanded}
              onToggle={handleToggle}
            />
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={handleAddFile}
              className="flex items-center gap-1.5 px-2 py-1 mt-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-sm w-full"
            >
              <Plus className="w-3.5 h-3.5" />
              Add file
            </button>
          )}
        </div>

        {/* Code pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Code pane header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-white">
            {!readOnly && editingPath === activeFile.path ? (
              <input
                autoFocus
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
                onBlur={commitPathRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitPathRename();
                  if (e.key === "Escape") setEditingPath(null);
                }}
                className="text-xs font-mono border border-slate-300 rounded px-1 py-0.5 w-64 focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]/30"
              />
            ) : (
              <span
                className={`text-xs font-mono text-slate-600 ${!readOnly ? "cursor-pointer hover:text-slate-900" : ""}`}
                onClick={() => {
                  if (!readOnly) {
                    setEditingPath(activeFile.path);
                    setDraftPath(activeFile.path);
                  }
                }}
                title={!readOnly ? "Click to rename" : undefined}
              >
                {activeFile.path}
              </span>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Code content */}
          {readOnly ? (
            <div className="flex-1 overflow-auto">
              <SyntaxHighlighter
                language={getLanguage(activeFile.path)}
                style={oneLight}
                showLineNumbers
                customStyle={{ margin: 0, fontSize: "0.8rem", minHeight: "100%", background: "white" }}
                codeTagProps={{ style: { fontFamily: "ui-monospace, monospace" } }}
              >
                {activeFile.content}
              </SyntaxHighlighter>
            </div>
          ) : (
            <div className="flex-1">
              <Suspense fallback={<div className="p-4 text-xs text-slate-400">Loading editor…</div>}>
                <MonacoEditor
                  height="100%"
                  language={getLanguage(activeFile.path)}
                  value={activeFile.content}
                  onChange={handleContentChange}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "off",
                    tabSize: 2,
                    automaticLayout: true,
                  }}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the client builds without errors**

```bash
cd client && npm run build 2>&1 | tail -20
```

Expected: build succeeds (or type errors only from JSX files that are not yet updated — acceptable at this step since we haven't wired it up yet).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/StarterCodeIDE/ client/package.json client/package-lock.json
git commit -m "feat: add StarterCodeIDE component with file tree and Monaco editor"
```

---

## Chunk 4: Client — Update API Client + Wire `StarterCodeIDE` into Pages

### Task 8: Update `generateAssessmentData` response type in client API

**Files:**
- Modify: `client/src/api/assessment.ts`

- [ ] **Step 1: Update the `generateAssessmentData` function return type** — find the function signature (line 320–329) and update `APIResult<{ ... }>`. Use the inline type (no import needed — `StarterCodeFile` is already defined at line 5 of this file):

```ts
export async function generateAssessmentData(
  jobDescription: string,
  token?: string
): Promise<
  APIResult<{
    title: string;
    description: string;
    timeLimit: number;
    starterCodeFiles?: StarterCodeFile[];  // StarterCodeFile is already defined at line 5 of this file
  }>
>
```

No other changes needed — `result` is already typed as `any` and `return { success: true, data: result }` will carry the field through at runtime.

- [ ] **Step 2: Verify TypeScript builds**

```bash
cd client && npm run build 2>&1 | tail -10
```

Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/assessment.ts
git commit -m "feat: add starterCodeFiles to generateAssessmentData return type"
```

---

### Task 9: Replace `StarterCodeFilesBlock` in `CandidateAssessment.jsx`

**Files:**
- Modify: `client/src/pages/CandidateAssessment.jsx`

- [ ] **Step 1: Add the import** — add `StarterCodeIDE` import at the top of the file, after existing imports:

```jsx
import StarterCodeIDE from "@/components/StarterCodeIDE";
```

- [ ] **Step 2: Delete the `StarterCodeFilesBlock` function** — remove lines 46–113 (the entire `StarterCodeFilesBlock` function definition, including `handleDownloadZip`, the return JSX, and the closing `}`).

- [ ] **Step 3: Replace the two usages** — find both occurrences (currently at ~lines 542–545 and ~lines 753–756 after the deletion):

```jsx
// Find (appears twice):
{assessment.starterCodeFiles?.length > 0 && (
  <StarterCodeFilesBlock files={assessment.starterCodeFiles} />
)}

// Replace each with:
{assessment.starterCodeFiles?.length > 0 && (
  <StarterCodeIDE files={assessment.starterCodeFiles} readOnly={true} />
)}
```

- [ ] **Step 4: Remove the `useState` import for `activeIndex`** — check if `useState` is still needed elsewhere in the file. If `StarterCodeFilesBlock` was the only local component using local state that has now been removed, the import is still needed for the main component's state. No change needed.

- [ ] **Step 5: Verify the page renders in the browser** — open a candidate assessment URL. Confirm the starter code panel appears with the file tree and syntax-highlighted code.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/CandidateAssessment.jsx
git commit -m "feat: replace StarterCodeFilesBlock with StarterCodeIDE in candidate view"
```

---

### Task 10: Replace card-list UI in `AssessmentEditor.jsx`

**Files:**
- Modify: `client/src/pages/AssessmentEditor.jsx`

- [ ] **Step 1: Add the import** — add at the top of the file:

```jsx
import StarterCodeIDE from "@/components/StarterCodeIDE";
```

- [ ] **Step 2: Replace the entire "Starter code files" section** — find the block starting at ~line 1240 (`{/* Starter code (inline files) */}`) down to ~line 1340. Replace it with:

```jsx
{/* Starter code (inline files) */}
<div className="mt-6 pt-4 border-t border-gray-200">
  <div className="flex items-center gap-2 mb-3">
    <FileCode className="w-4 h-4 text-gray-600" />
    <span className="text-sm font-medium text-gray-700">
      Starter code files
    </span>
  </div>
  <p className="text-xs text-gray-500 mb-3">
    Add inline starter code files for candidates to view and download as a ZIP.
  </p>
  <StarterCodeIDE
    files={starterCodeFiles}
    readOnly={false}
    onChange={async (files) => {
      setStarterCodeFiles(files);
      await saveAssessment({ starterCodeFiles: files });
    }}
  />
  {starterCodeFiles.length === 0 && (
    <p className="text-xs text-gray-400 mt-2">No starter code files yet. Files will be auto-generated when you create an assessment with AI.</p>
  )}
</div>
```

- [ ] **Step 3: Remove now-unused handler functions** — the following handlers are now handled inside `StarterCodeIDE` or no longer needed. Remove them from `AssessmentEditor`:
  - `handleUseStarterTemplate` — moved into `StarterCodeIDE`
  - `handleClearStarterCode` — replaced by "Clear all" inside `StarterCodeIDE`
  - `handleAddStarterCodeFile` — moved into `StarterCodeIDE`
  - `handleRemoveStarterCodeFile` — moved into `StarterCodeIDE`
  - `handleUpdateStarterCodeFile` — moved into `StarterCodeIDE`
  - `handleSaveStarterCodeFiles` — the `onChange` now saves inline; remove

  Also remove: `isLoadingTemplate` state and setter.

- [ ] **Step 4: Wire up `starterCodeFiles` population from the generate response** — find where the assessment generation result is applied to state (around lines 380–390 where `result.data.starterCodeFiles` is already being set). This should already work since `setStarterCodeFiles` is called on load. Confirm the existing code already handles this:

```jsx
// Should already exist — confirm it's there:
if (result.data.starterCodeFiles !== undefined) {
  setStarterCodeFiles(
    Array.isArray(result.data.starterCodeFiles)
      ? result.data.starterCodeFiles
      : []
  );
}
```

If missing, add it after the existing `setAssessmentData(result.data)` call.

- [ ] **Step 5: Verify the editor page renders** — open an existing assessment in the editor. Confirm:
  - The `StarterCodeIDE` appears with file tree and Monaco editor
  - The "React + Vite template" button loads files
  - "Clear all" clears files and saves
  - Adding/deleting/renaming files works
  - Changes auto-save (the `onChange` calls `saveAssessment`)

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AssessmentEditor.jsx
git commit -m "feat: replace starter code card-list with StarterCodeIDE in editor"
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Create a new assessment via the UI** — go to the Create Assessment flow, paste a job description, click generate. After generation, go to the assessment editor and confirm `starterCodeFiles` is populated.

- [ ] **Step 2: Verify the candidate view** — open the candidate link for the assessment. Confirm the `StarterCodeIDE` renders in read-only mode with the file tree and syntax highlighting.

- [ ] **Step 3: Download ZIP** — click "Download ZIP" in both views. Confirm the ZIP contains all the correct files.

- [ ] **Step 4: Final commit**

```bash
git add -A
git status  # review — make sure nothing unexpected is staged
git commit -m "feat: starter code generation — end-to-end wired up"
```
