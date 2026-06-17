/**
 * Coding-screencast fixture for the video-evaluation test.
 *
 * Generates a realistic 3-5 minute "candidate coding" screencast: an editor on
 * the left building up a small Python module step by step, and a terminal at the
 * bottom that eventually runs pytest (fails once, gets fixed, then all pass).
 *
 * The session is designed so the transcript + evaluation have KNOWN expected
 * outcomes:
 *   - incremental coding is visible          -> "works incrementally" should score HIGH
 *   - tests are written and run in a terminal -> "tests their own code" should score HIGH
 *   - NO AI assistant / chat panel anywhere   -> "used an AI assistant" should score LOW
 *
 * `buildCodingStates()` is pure (no I/O) so it can be unit-tested. Rendering and
 * ffmpeg encoding live in `generateCodingVideo()`.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

import sharp from "sharp";

export interface CodingState {
  /** Editor tab / filename shown. */
  file: string;
  /** Lines currently visible in the editor. */
  editorLines: string[];
  /** Lines currently visible in the terminal panel (may be empty). */
  terminalLines: string[];
  /** Short human caption describing what the candidate is doing. */
  caption: string;
  /** When set, render a right-hand AI assistant chat panel with these lines. */
  aiChat?: string[];
  /** The AI tool name shown in the chat panel header (e.g. "Cursor"). */
  aiApp?: string;
}

/** Distinct candidate behavior profiles. The evaluator scores each from its own video. */
export type CandidateVariant = "strong" | "diligent" | "ai_assisted" | "rushed";

export const CANDIDATE_VARIANTS: Array<{
  variant: CandidateVariant;
  name: string;
  label: string;
  /** Plain-language expectation (for humans; actual scores come from the system). */
  expectation: string;
}> = [
  {
    variant: "diligent",
    name: "Dana Okafor",
    label: "Diligent test-driven",
    expectation: "Incremental + extensive testing, no AI — expect high across the board.",
  },
  {
    variant: "strong",
    name: "Sam Rivera",
    label: "Solid incremental",
    expectation: "Incremental coding + one test cycle, no AI — expect strong scores.",
  },
  {
    variant: "ai_assisted",
    name: "Alex Chen",
    label: "AI-assisted",
    expectation: "Leans on an AI chat assistant, pastes generated code — expect high AI-reliance, lower incremental.",
  },
  {
    variant: "rushed",
    name: "Jordan Blake",
    label: "Rushed paste",
    expectation: "Pastes a finished solution, never tests, no AI — expect low incremental + testing.",
  },
];

/** Behaviors the screencast is built to demonstrate (ground truth for scoring). */
export interface CodingVideoSpec {
  /** Tokens that should appear in a faithful OCR transcript (recall metric). */
  expectedTokens: string[];
  /** Ground-truth behaviors present/absent in the video. */
  behaviors: {
    incrementalCoding: boolean;
    runsTests: boolean;
    usesAiAssistant: boolean;
  };
}

export const CODING_VIDEO_SPEC: CodingVideoSpec = {
  expectedTokens: ["is_prime", "primes_up_to", "pytest", "passed", "def", "return"],
  behaviors: {
    incrementalCoding: true,
    runsTests: true,
    usesAiAssistant: false,
  },
};

/**
 * Build the ordered list of editor/terminal states for the screencast.
 * Pure function: deterministic, no side effects.
 * The default ("strong") profile is unchanged so existing tests stay stable.
 */
export function buildCodingStates(
  variant: CandidateVariant = "strong"
): CodingState[] {
  switch (variant) {
    case "diligent":
      return buildDiligentStates();
    case "ai_assisted":
      return buildAiAssistedStates();
    case "rushed":
      return buildRushedStates();
    case "strong":
    default:
      return buildStrongStates();
  }
}

function buildStrongStates(): CodingState[] {
  const states: CodingState[] = [];

  // ---- Phase 1: write is_prime() incrementally in primes.py ----
  const isPrimeLines = [
    "def is_prime(n):",
    "    if n < 2:",
    "        return False",
    "    i = 2",
    "    while i * i <= n:",
    "        if n % i == 0:",
    "            return False",
    "        i += 1",
    "    return True",
  ];
  const editor1: string[] = [];
  for (const line of isPrimeLines) {
    editor1.push(line);
    states.push({
      file: "primes.py",
      editorLines: [...editor1],
      terminalLines: [],
      caption: "Writing is_prime() line by line",
    });
  }

  // ---- Phase 2: write primes_up_to() that uses is_prime() ----
  const primesUpToLines = [
    "",
    "def primes_up_to(limit):",
    "    result = []",
    "    for n in range(2, limit + 1):",
    "        if is_prime(n):",
    "            result.append(n)",
    "    return result",
  ];
  const editor2 = [...editor1];
  for (const line of primesUpToLines) {
    editor2.push(line);
    states.push({
      file: "primes.py",
      editorLines: [...editor2].slice(-14),
      terminalLines: [],
      caption: "Adding primes_up_to() built on is_prime()",
    });
  }

  // ---- Phase 3: write tests in test_primes.py ----
  const testLines = [
    "from primes import is_prime, primes_up_to",
    "",
    "def test_is_prime():",
    "    assert is_prime(2)",
    "    assert is_prime(13)",
    "    assert not is_prime(1)",
    "    assert not is_prime(15)",
    "",
    "def test_primes_up_to():",
    "    assert primes_up_to(10) == [2, 3, 5, 7]",
  ];
  const editor3: string[] = [];
  for (const line of testLines) {
    editor3.push(line);
    states.push({
      file: "test_primes.py",
      editorLines: [...editor3].slice(-14),
      terminalLines: [],
      caption: "Writing pytest tests for the module",
    });
  }

  // ---- Phase 4: run pytest, see a failure, fix it, re-run green ----
  states.push({
    file: "test_primes.py",
    editorLines: [...editor3].slice(-14),
    terminalLines: ["$ pytest -q"],
    caption: "Running the test suite",
  });
  states.push({
    file: "test_primes.py",
    editorLines: [...editor3].slice(-14),
    terminalLines: [
      "$ pytest -q",
      "F.",
      "test_primes.py::test_is_prime FAILED",
      "assert not is_prime(1)  ->  returned True",
      "1 failed, 1 passed in 0.04s",
    ],
    caption: "One test fails (edge case n < 2)",
  });
  // Candidate inspects primes.py and fixes the boundary bug.
  const fixedEditor = [
    "def is_prime(n):",
    "    if n < 2:",
    "        return False   # fixed: 0 and 1 are not prime",
    "    i = 2",
    "    while i * i <= n:",
    "        if n % i == 0:",
    "            return False",
    "        i += 1",
    "    return True",
  ];
  states.push({
    file: "primes.py",
    editorLines: fixedEditor,
    terminalLines: [
      "$ pytest -q",
      "1 failed, 1 passed in 0.04s",
    ],
    caption: "Fixing the boundary condition in is_prime()",
  });
  states.push({
    file: "test_primes.py",
    editorLines: [...editor3].slice(-14),
    terminalLines: [
      "$ pytest -q",
      "..",
      "2 passed in 0.03s",
    ],
    caption: "Re-running tests: all passed",
  });

  // ---- Phase 5: small cleanup / docstring ----
  const documented = [
    '"""Prime number utilities."""',
    "",
    "def is_prime(n):",
    '    """Return True if n is a prime number."""',
    "    if n < 2:",
    "        return False",
    "    i = 2",
    "    while i * i <= n:",
    "        if n % i == 0:",
    "            return False",
    "        i += 1",
    "    return True",
  ];
  const docSteps = [4, 8, documented.length];
  for (const upto of docSteps) {
    states.push({
      file: "primes.py",
      editorLines: documented.slice(0, upto).slice(-14),
      terminalLines: ["..", "2 passed in 0.03s"],
      caption: "Adding a module docstring and cleanup",
    });
  }

  return states;
}

/** Full reference solution (used by paste-heavy profiles). */
const FULL_SOLUTION = [
  "def is_prime(n):",
  "    if n < 2:",
  "        return False",
  "    i = 2",
  "    while i * i <= n:",
  "        if n % i == 0:",
  "            return False",
  "        i += 1",
  "    return True",
  "",
  "def primes_up_to(limit):",
  "    result = []",
  "    for n in range(2, limit + 1):",
  "        if is_prime(n):",
  "            result.append(n)",
  "    return result",
];

const TEST_FILE = [
  "from primes import is_prime, primes_up_to",
  "",
  "def test_is_prime():",
  "    assert is_prime(2)",
  "    assert is_prime(13)",
  "    assert not is_prime(1)",
  "    assert not is_prime(15)",
  "",
  "def test_primes_up_to():",
  "    assert primes_up_to(10) == [2, 3, 5, 7]",
];

/** Diligent: the solid incremental session plus extra test cycles + coverage. */
function buildDiligentStates(): CodingState[] {
  const base = buildStrongStates();
  const edgeTests = [
    ...TEST_FILE,
    "",
    "def test_edge_cases():",
    "    assert not is_prime(0)",
    "    assert not is_prime(-7)",
    "    assert primes_up_to(1) == []",
    "    assert primes_up_to(2) == [2]",
  ];
  const extra: CodingState[] = [
    {
      file: "test_primes.py",
      editorLines: edgeTests.slice(-14),
      terminalLines: ["..", "2 passed in 0.03s"],
      caption: "Adding edge-case tests (0, negatives, limit=1)",
    },
    {
      file: "test_primes.py",
      editorLines: edgeTests.slice(-14),
      terminalLines: ["$ pytest -q", "...", "3 passed in 0.04s"],
      caption: "Re-running the full suite",
    },
    {
      file: "test_primes.py",
      editorLines: edgeTests.slice(-14),
      terminalLines: ["$ pytest -q -k is_prime", "....", "4 passed in 0.02s"],
      caption: "Running focused is_prime tests",
    },
    {
      file: "test_primes.py",
      editorLines: edgeTests.slice(-14),
      terminalLines: [
        "$ pytest --cov=primes -q",
        "...",
        "3 passed in 0.05s",
        "primes.py   100%",
      ],
      caption: "Checking test coverage (100%)",
    },
  ];
  return [...base, ...extra];
}

/** AI-assisted: leans on a Cursor chat panel, then pastes the generated code. */
function buildAiAssistedStates(): CodingState[] {
  const states: CodingState[] = [];
  const app = "Cursor";

  // Type the prompt line by line (chat grows).
  const promptLines = [
    "Human: Write Python functions",
    "is_prime(n) and primes_up_to(limit).",
    "Make is_prime efficient.",
  ];
  const chat: string[] = [];
  for (const l of promptLines) {
    chat.push(l);
    states.push({
      file: "primes.py",
      editorLines: [],
      terminalLines: [],
      caption: "Prompting the AI assistant",
      aiChat: [...chat],
      aiApp: app,
    });
  }

  // Assistant streams a response with code.
  const responseLines = [
    "Assistant: Sure! Here you go:",
    "def is_prime(n):",
    "    if n < 2: return False",
    "    i = 2",
    "    while i * i <= n:",
    "        if n % i == 0: return False",
    "        i += 1",
    "    return True",
    "def primes_up_to(limit):",
    "    return [n for n in range(2, limit+1)",
    "            if is_prime(n)]",
  ];
  for (let k = 1; k <= responseLines.length; k += 2) {
    states.push({
      file: "primes.py",
      editorLines: [],
      terminalLines: [],
      caption: "AI generates the solution",
      aiChat: [...chat, ...responseLines.slice(0, k + 1)],
      aiApp: app,
    });
  }

  const fullChat = [...chat, ...responseLines];

  // Paste the AI code into the editor in one big jump (non-incremental).
  states.push({
    file: "primes.py",
    editorLines: FULL_SOLUTION.slice(0, 9),
    terminalLines: [],
    caption: "Pasting the AI-generated is_prime",
    aiChat: fullChat,
    aiApp: app,
  });
  states.push({
    file: "primes.py",
    editorLines: FULL_SOLUTION.slice(-14),
    terminalLines: [],
    caption: "Pasting the rest of the AI code",
    aiChat: fullChat,
    aiApp: app,
  });

  // One follow-up + a single quick run.
  states.push({
    file: "primes.py",
    editorLines: FULL_SOLUTION.slice(-14),
    terminalLines: [],
    caption: "Follow-up question to the assistant",
    aiChat: [...fullChat, "Human: Is this efficient enough?", "Assistant: Yes, it's O(sqrt n)."],
    aiApp: app,
  });
  states.push({
    file: "primes.py",
    editorLines: FULL_SOLUTION.slice(-14),
    terminalLines: ["$ python -c \"import primes\"", "(no output)"],
    caption: "Quick import check (no real tests)",
    aiChat: [...fullChat, "Human: Is this efficient enough?", "Assistant: Yes, it's O(sqrt n)."],
    aiApp: app,
  });

  return states;
}

/** Rushed: pastes a finished solution in big jumps, never writes or runs tests. */
function buildRushedStates(): CodingState[] {
  const states: CodingState[] = [];
  states.push({
    file: "primes.py",
    editorLines: [],
    terminalLines: [],
    caption: "Empty file",
  });
  // Two big paste jumps — no incremental typing.
  states.push({
    file: "primes.py",
    editorLines: FULL_SOLUTION.slice(0, 9),
    terminalLines: [],
    caption: "Pasting a finished is_prime()",
  });
  states.push({
    file: "primes.py",
    editorLines: FULL_SOLUTION.slice(-14),
    terminalLines: [],
    caption: "Pasting the rest of the finished solution",
  });
  // Scroll around, tweak a comment, but never test.
  const withComment = [...FULL_SOLUTION];
  withComment[0] = "def is_prime(n):  # from a snippet";
  states.push({
    file: "primes.py",
    editorLines: withComment.slice(0, 9),
    terminalLines: [],
    caption: "Adding a comment",
  });
  states.push({
    file: "primes.py",
    editorLines: withComment.slice(-14),
    terminalLines: [],
    caption: "Scrolling through the pasted code",
  });
  states.push({
    file: "primes.py",
    editorLines: withComment.slice(-14),
    terminalLines: [],
    caption: "Reviewing — submits without running anything",
  });
  return states;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render a single state to an editor/terminal screenshot SVG. */
export function renderStateSvg(
  state: CodingState,
  index: number,
  total: number,
  w: number,
  h: number
): string {
  const sidebarW = 220;
  const codeX = sidebarW + 24;
  const codeTop = 92;
  const lineH = 26;
  const termH = 168;
  const termTop = h - termH;
  const hasAi = Array.isArray(state.aiChat) && state.aiChat.length > 0;
  const aiPanelW = 380;
  const contentRight = hasAi ? w - aiPanelW : w;

  const codeText = state.editorLines
    .map(
      (l, idx) =>
        `<text x="${codeX}" y="${codeTop + idx * lineH}" font-family="monospace" font-size="16" fill="#d4d4d4" xml:space="preserve">${escapeXml(
          l || " "
        )}</text>`
    )
    .join("");

  const lineNumbers = state.editorLines
    .map(
      (_, idx) =>
        `<text x="${sidebarW + 4}" y="${codeTop + idx * lineH}" font-family="monospace" font-size="13" fill="#5a5a5a">${idx + 1}</text>`
    )
    .join("");

  const termText = state.terminalLines
    .map(
      (l, idx) =>
        `<text x="${sidebarW + 16}" y="${termTop + 34 + idx * 22}" font-family="monospace" font-size="14" fill="${
          /FAIL|failed/.test(l) ? "#f97583" : /passed|^\.\.|PASS/.test(l) ? "#39d353" : "#cccccc"
        }" xml:space="preserve">${escapeXml(l)}</text>`
    )
    .join("");

  const tabA = state.file === "primes.py";

  let aiPanel = "";
  if (hasAi) {
    const aiX = contentRight;
    const chatText = state.aiChat!
      .map((l, idx) => {
        const isHuman = /^Human:/.test(l);
        const isAssistant = /^Assistant:/.test(l);
        const fill = isHuman ? "#9cdcfe" : isAssistant ? "#c3e88d" : "#d4d4d4";
        return `<text x="${aiX + 16}" y="${72 + idx * 22}" font-family="monospace" font-size="12.5" fill="${fill}" xml:space="preserve">${escapeXml(
          l.length > 44 ? l.slice(0, 44) : l
        )}</text>`;
      })
      .join("");
    aiPanel = `
  <rect x="${aiX}" y="0" width="${aiPanelW}" height="${h}" fill="#1b1b22"/>
  <rect x="${aiX}" y="0" width="${aiPanelW}" height="44" fill="#23232e"/>
  <text x="${aiX + 16}" y="28" font-family="monospace" font-size="13" fill="#c792ea">${escapeXml(
    state.aiApp || "AI Chat"
  )} — AI Chat</text>
  ${chatText}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#1e1e1e"/>
  <rect x="0" y="0" width="${sidebarW}" height="${h}" fill="#252526"/>
  <text x="16" y="34" font-family="monospace" font-size="13" fill="#9cdcfe">EXPLORER — primes-kata</text>
  <text x="16" y="64" font-family="monospace" font-size="13" fill="${tabA ? "#ffffff" : "#bdbdbd"}">primes.py</text>
  <text x="16" y="88" font-family="monospace" font-size="13" fill="${tabA ? "#bdbdbd" : "#ffffff"}">test_primes.py</text>
  <rect x="${sidebarW}" y="0" width="${contentRight - sidebarW}" height="40" fill="#2d2d2d"/>
  <text x="${codeX}" y="26" font-family="monospace" font-size="14" fill="#ffffff">${escapeXml(state.file)}</text>
  <text x="${contentRight - 250}" y="26" font-family="monospace" font-size="11" fill="#808080">step ${index + 1}/${total} · ${escapeXml(
    state.caption.length > 30 ? state.caption.slice(0, 30) : state.caption
  )}</text>
  ${lineNumbers}
  ${codeText}
  <rect x="${sidebarW}" y="${termTop}" width="${contentRight - sidebarW}" height="${termH}" fill="#0c0c0c"/>
  <text x="${sidebarW + 16}" y="${termTop + 16}" font-family="monospace" font-size="11" fill="#808080">TERMINAL</text>
  ${termText}
  ${aiPanel}
</svg>`;
}

export interface GeneratedCodingVideo {
  path: string;
  buffer: Buffer;
  sha256: string;
  durationSeconds: number;
  stateCount: number;
  width: number;
  height: number;
  sampleFramePng: Buffer;
  cleanup: () => Promise<void>;
}

/**
 * Render the states to PNGs and encode a real WebM via the bundled ffmpeg.
 * Each state is held for `secondsPerState` so the clip lands in the 3-5 min range.
 */
export async function generateCodingVideo(opts?: {
  targetSeconds?: number;
  width?: number;
  height?: number;
  variant?: CandidateVariant;
}): Promise<GeneratedCodingVideo> {
  const width = opts?.width ?? 1280;
  const height = opts?.height ?? 720;
  const states = buildCodingStates(opts?.variant ?? "strong");
  const targetSeconds = opts?.targetSeconds ?? 240; // ~4 minutes
  const secondsPerState = Math.max(
    4,
    Math.round((targetSeconds / states.length) * 10) / 10
  );

  const ffmpegPath = (await import("@ffmpeg-installer/ffmpeg")).default.path;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "video-eval-"));
  const framesDir = path.join(dir, "frames");
  await fs.mkdir(framesDir);

  let sampleFramePng: Buffer = Buffer.alloc(0);
  const concatLines: string[] = [];
  for (let i = 0; i < states.length; i++) {
    const svg = renderStateSvg(states[i], i, states.length, width, height);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const file = path.join(framesDir, `frame_${String(i + 1).padStart(4, "0")}.png`);
    await fs.writeFile(file, png);
    if (i === Math.floor(states.length / 2)) sampleFramePng = png;
    concatLines.push(`file '${file}'`);
    concatLines.push(`duration ${secondsPerState}`);
  }
  // concat demuxer needs the last file repeated (without duration) to flush it.
  concatLines.push(`file '${path.join(framesDir, `frame_${String(states.length).padStart(4, "0")}.png`)}'`);
  const listPath = path.join(dir, "concat.txt");
  await fs.writeFile(listPath, concatLines.join("\n"), "utf-8");

  const out = path.join(dir, "coding-session.webm");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "libvpx",
      "-b:v",
      "600k",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "5",
      out,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`))
    );
  });

  const buffer = await fs.readFile(out);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const durationSeconds = Math.round(states.length * secondsPerState);

  return {
    path: out,
    buffer,
    sha256,
    durationSeconds,
    stateCount: states.length,
    width,
    height,
    sampleFramePng,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}
