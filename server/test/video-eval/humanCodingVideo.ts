/**
 * Human-coding screencast simulator for STRESS-testing the transcript pipeline.
 *
 * This renders a true frame-by-frame session of a candidate solving a COMPLEX,
 * multi-file "bridge" take-home assessment (a concurrent, rate-limited webhook
 * dispatcher with retries + a small HTTP API). It constantly changes the screen
 * the way a real engineer does over a long session:
 *
 *   - a multi-file IDE: clicking files in the tree swaps editor content; code is
 *     typed character-by-character with human speed variance, newlines, scroll,
 *   - IDE "advanced" chrome that stresses OCR: autocomplete popups (a floating
 *     suggestion list over the code), inline ghost-text completions, red error
 *     squiggles, and a right-edge minimap,
 *   - a real BROWSER the candidate alt-tabs to (URL bar + tabs): language docs,
 *     a StackOverflow answer, an engineering blog, and the assessment task page,
 *     scrolled like a human reading,
 *   - an AI chat sidebar with COMPLEX architectural prompts whose answers STREAM
 *     in word-by-word (large region churn),
 *   - a terminal that runs pytest / ruff / mypy / uvicorn / git with scrolling
 *     output.
 *
 * All of this churn is exactly what survives the extractor's pixel-diff dedup,
 * so 30+ minute clips keep far more frames -> far more vision batches -> a real
 * rate-limit + OCR stress test. Everything is deterministic (seeded RNG). Pure
 * simulation/rendering only — no network, no DB.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

import sharp from "sharp";

// ---------------------------------------------------------------------------
// Geometry (1280x720 — matches the extractor's EXTRACT box)
// ---------------------------------------------------------------------------
const W = 1280;
const H = 720;
const TOPBAR_H = 34;
const TREE_W = 168;
const CHAT_W = 372;
const CHAT_X = W - CHAT_W; // 908
const EDITOR_X = TREE_W; // 168
const EDITOR_RIGHT = CHAT_X - 8; // 900
const MINIMAP_W = 12;
const EDITOR_CODE_RIGHT = EDITOR_RIGHT - MINIMAP_W - 4;
const TERM_TOP = 548;
const EDITOR_TOP = TOPBAR_H;
const EDITOR_BOTTOM = TERM_TOP - 8; // 540

const LINE_H = 22;
const CHAR_W = 9;
const GUTTER_W = 44;
const CODE_X = EDITOR_X + GUTTER_W;
const VISIBLE_EDITOR_LINES = Math.floor((EDITOR_BOTTOM - EDITOR_TOP - 10) / LINE_H);

const TERM_LINE_H = 18;
const VISIBLE_TERM_LINES = Math.floor((H - TERM_TOP - 30) / TERM_LINE_H);

const CHAT_LINE_H = 18;
const CHAT_WRAP = Math.floor((CHAT_W - 28) / 7.6);
const VISIBLE_CHAT_LINES = Math.floor((H - TOPBAR_H - 60) / CHAT_LINE_H);

// Browser geometry (full-window app the candidate alt-tabs into)
const BROWSER_CHROME_H = 78;
const BROWSER_CONTENT_TOP = BROWSER_CHROME_H + 8;
const BROWSER_LINE_H = 20;
const BROWSER_WRAP = Math.floor((W - 120) / 8.2);
const VISIBLE_BROWSER_LINES = Math.floor((H - BROWSER_CONTENT_TOP - 20) / BROWSER_LINE_H);

export type CodingVariant = "steady" | "bursty" | "ai_heavy" | "debug";

export const STRESS_VARIANTS: {
  variant: CodingVariant;
  label: string;
  description: string;
}[] = [
  {
    variant: "steady",
    label: "Steady writer",
    description:
      "Solves the webhook-dispatcher take-home at a consistent pace: reads the task in the browser, builds each module with autocomplete, runs pytest/ruff, occasional AI question. Even, moderate change rate over 30+ min.",
  },
  {
    variant: "bursty",
    label: "Bursty typist",
    description:
      "Fast typing bursts separated by think pauses and long doc-reading sessions in the browser. High within-clip variance; little AI reliance.",
  },
  {
    variant: "ai_heavy",
    label: "AI-assisted",
    description:
      "Leans on AI chat + the browser heavily: complex architectural prompts, long streamed answers, pastes/accepts suggested code via autocomplete. Chat + browser churn constantly.",
  },
  {
    variant: "debug",
    label: "Debug / test loop",
    description:
      "edit → pytest → read the failing traceback → search the error in the browser → fix → re-run, repeatedly, with red squiggles on the broken lines. Terminal + scrolling driven.",
  },
];

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) for deterministic renders
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------
interface BrowserState {
  url: string;
  typedUrl: string; // partial URL while "typing" into the address bar
  tabs: string[];
  activeTab: number;
  title: string;
  lines: string[];
  scrollTop: number;
  loading: boolean;
}

interface Autocomplete {
  items: string[];
  selected: number;
  caretLine: number;
  caretCol: number;
}

interface SimState {
  app: "ide" | "browser";
  docs: Record<string, string[]>;
  fileName: string;
  caretLine: number;
  caretCol: number;
  scrollTop: number;
  files: { name: string; active: boolean; dir?: boolean; indent?: number }[];
  terminal: string[];
  chat: { role: "user" | "assistant"; text: string }[];
  focus: "editor" | "terminal" | "chat";
  autocomplete: Autocomplete | null;
  ghost: string | null; // inline gray completion after the caret
  squiggles: number[]; // doc line indices with a red error underline
  inlineAI: string[] | null; // multi-line Copilot-style AI ghost suggestion
  cmdk: { prompt: string; phase: "type" | "gen" | "diff"; added: string[] } | null;
  diffAdded: number[]; // doc line indices highlighted as AI-added (transient)
  diffClearAt: number; // tick at which to clear diffAdded
  gutterMarks: Record<number, "add" | "mod">; // diff gutter bars (per current file)
  browser: BrowserState;
  tick: number;
  fps: number;
}

const REPO_FILES = [
  { name: "dispatcher/", dir: true, indent: 0 },
  { name: "dispatcher.py", indent: 1 },
  { name: "ratelimiter.py", indent: 1 },
  { name: "backoff.py", indent: 1 },
  { name: "models.py", indent: 1 },
  { name: "api.py", indent: 1 },
  { name: "tests/", dir: true, indent: 0 },
  { name: "test_dispatcher.py", indent: 1 },
  { name: "README.md", indent: 0 },
  { name: "config.yaml", indent: 0 },
];

function newState(fps: number): SimState {
  const files = REPO_FILES.map((f) => ({
    name: f.name,
    active: f.name === "README.md",
    dir: f.dir,
    indent: f.indent,
  }));
  return {
    app: "ide",
    docs: {
      "README.md": README_MD.split("\n"),
      "config.yaml": CONFIG_YAML.split("\n"),
      "dispatcher.py": [""],
      "ratelimiter.py": [""],
      "backoff.py": [""],
      "models.py": [""],
      "api.py": [""],
      "test_dispatcher.py": [""],
    },
    fileName: "README.md",
    caretLine: 0,
    caretCol: 0,
    scrollTop: 0,
    files,
    terminal: [],
    chat: [],
    focus: "editor",
    autocomplete: null,
    ghost: null,
    squiggles: [],
    inlineAI: null,
    cmdk: null,
    diffAdded: [],
    diffClearAt: 0,
    gutterMarks: {},
    browser: {
      url: "",
      typedUrl: "",
      tabs: ["Assessment", "docs.python.org", "stackoverflow"],
      activeTab: 0,
      title: "",
      lines: [],
      scrollTop: 0,
      loading: false,
    },
    tick: 0,
    fps,
  };
}

function curDoc(s: SimState): string[] {
  return s.docs[s.fileName];
}

function applyEditorScroll(s: SimState): void {
  const doc = curDoc(s);
  if (s.caretLine >= s.scrollTop + VISIBLE_EDITOR_LINES - 2) {
    s.scrollTop = s.caretLine - VISIBLE_EDITOR_LINES + 3;
  }
  if (s.caretLine < s.scrollTop) s.scrollTop = s.caretLine;
  if (s.scrollTop < 0) s.scrollTop = 0;
  const maxScroll = Math.max(0, doc.length - VISIBLE_EDITOR_LINES);
  if (s.scrollTop > maxScroll) s.scrollTop = maxScroll;
}

// ---------------------------------------------------------------------------
// Actions — each .step() mutates state for one tick; returns true when done
// ---------------------------------------------------------------------------
interface Action {
  step(s: SimState, dt: number, rng: () => number): boolean;
}

/** Run an arbitrary mutation once (file switches, squiggle toggles, etc.). */
class DoAction implements Action {
  constructor(private fn: (s: SimState) => void) {}
  step(s: SimState): boolean {
    this.fn(s);
    return true;
  }
}

class OpenFileAction implements Action {
  constructor(private name: string) {}
  step(s: SimState): boolean {
    s.app = "ide";
    s.focus = "editor";
    s.fileName = this.name;
    s.files.forEach((f) => (f.active = f.name === this.name));
    const doc = curDoc(s);
    s.caretLine = doc.length - 1;
    s.caretCol = doc[s.caretLine].length;
    s.scrollTop = 0;
    s.autocomplete = null;
    s.ghost = null;
    s.inlineAI = null;
    s.cmdk = null;
    s.diffAdded = [];
    s.gutterMarks = {};
    applyEditorScroll(s);
    return true;
  }
}

class TypeAction implements Action {
  private i = 0;
  private text: string;
  constructor(text: string, private cps: number) {
    this.text = text.replace(/\n{3,}/g, "\n\n");
  }
  step(s: SimState, dt: number, rng: () => number): boolean {
    s.app = "ide";
    s.focus = "editor";
    if (rng() < 0.06) return this.i >= this.text.length; // micro-stutter
    const doc = curDoc(s);
    let n = Math.max(1, Math.round(this.cps * dt * (0.55 + 0.9 * rng())));
    while (n-- > 0 && this.i < this.text.length) {
      const ch = this.text[this.i++];
      if (ch === "\n") {
        doc.splice(s.caretLine + 1, 0, "");
        s.caretLine++;
        s.caretCol = 0;
      } else {
        const line = doc[s.caretLine];
        doc[s.caretLine] = line.slice(0, s.caretCol) + ch + line.slice(s.caretCol);
        s.caretCol++;
      }
    }
    applyEditorScroll(s);
    return this.i >= this.text.length;
  }
}

/**
 * Type a line, but trigger an autocomplete popup + inline ghost text partway
 * through (over the code), cycle the selection, then "accept" the suggestion.
 * The floating popup + ghost text overlap the code -> directly stresses OCR.
 */
class CompletionTypeAction implements Action {
  private phase: "type" | "popup" | "accept" = "type";
  private i = 0;
  private popupTicks = 0;
  private text: string;
  constructor(
    text: string,
    private cps: number,
    private items: string[],
    private accept: string
  ) {
    this.text = text;
  }
  step(s: SimState, dt: number, rng: () => number): boolean {
    s.app = "ide";
    s.focus = "editor";
    const doc = curDoc(s);
    if (this.phase === "type") {
      let n = Math.max(1, Math.round(this.cps * dt * (0.6 + 0.8 * rng())));
      while (n-- > 0 && this.i < this.text.length) {
        const ch = this.text[this.i++];
        if (ch === "\n") {
          doc.splice(s.caretLine + 1, 0, "");
          s.caretLine++;
          s.caretCol = 0;
        } else {
          const line = doc[s.caretLine];
          doc[s.caretLine] = line.slice(0, s.caretCol) + ch + line.slice(s.caretCol);
          s.caretCol++;
        }
      }
      applyEditorScroll(s);
      if (this.i >= this.text.length) {
        this.phase = "popup";
        s.autocomplete = {
          items: this.items,
          selected: 0,
          caretLine: s.caretLine,
          caretCol: s.caretCol,
        };
        s.ghost = this.accept;
      }
      return false;
    }
    if (this.phase === "popup") {
      this.popupTicks++;
      if (s.autocomplete && rng() < 0.4) {
        s.autocomplete.selected =
          (s.autocomplete.selected + 1) % s.autocomplete.items.length;
        s.ghost = s.autocomplete.items[s.autocomplete.selected];
      }
      if (this.popupTicks >= 4) this.phase = "accept";
      return false;
    }
    // accept: insert the chosen completion, clear popup + ghost
    const chosen = s.ghost ?? this.accept;
    const line = doc[s.caretLine];
    doc[s.caretLine] = line.slice(0, s.caretCol) + chosen + line.slice(s.caretCol);
    s.caretCol += chosen.length;
    s.autocomplete = null;
    s.ghost = null;
    applyEditorScroll(s);
    return true;
  }
}

class PauseAction implements Action {
  private remaining: number;
  constructor(seconds: number) {
    this.remaining = seconds;
  }
  step(s: SimState, dt: number): boolean {
    this.remaining -= dt;
    return this.remaining <= 0;
  }
}

class ScrollReadAction implements Action {
  private moved = 0;
  private acc = 0;
  constructor(private lines: number, private dir: 1 | -1, private linesPerSec = 12) {}
  step(s: SimState, dt: number): boolean {
    s.app = "ide";
    s.focus = "editor";
    const doc = curDoc(s);
    this.acc += this.linesPerSec * dt;
    const maxScroll = Math.max(0, doc.length - VISIBLE_EDITOR_LINES);
    while (this.acc >= 1 && this.moved < this.lines) {
      this.acc -= 1;
      const before = s.scrollTop;
      s.scrollTop = Math.min(maxScroll, Math.max(0, s.scrollTop + this.dir));
      s.caretLine = Math.min(doc.length - 1, Math.max(0, s.caretLine + this.dir));
      this.moved++;
      if (s.scrollTop === before) return true;
    }
    return this.moved >= this.lines;
  }
}

class TerminalAction implements Action {
  private full: string[];
  private lineIdx = 0;
  private charIdx = 0;
  private started = false;
  private delay = 0;
  private curIdx = 0;
  constructor(cmd: string, outLines: string[]) {
    this.full = [`$ ${cmd}`, ...outLines];
  }
  step(s: SimState, dt: number, rng: () => number): boolean {
    s.app = "ide";
    s.focus = "terminal";
    if (!this.started) {
      s.terminal.push("");
      this.curIdx = s.terminal.length - 1;
      this.started = true;
    }
    if (this.lineIdx === 0) {
      const target = this.full[0];
      let n = Math.max(1, Math.round(15 * dt * (0.6 + 0.8 * rng())));
      while (n-- > 0 && this.charIdx < target.length) this.charIdx++;
      s.terminal[this.curIdx] = target.slice(0, this.charIdx);
      if (this.charIdx >= target.length) {
        this.lineIdx++;
        this.delay = 0.25;
      }
    } else {
      this.delay -= dt;
      if (this.delay <= 0 && this.lineIdx < this.full.length) {
        s.terminal.push(this.full[this.lineIdx]);
        this.lineIdx++;
        this.delay = 0.1 + 0.5 * rng();
      }
    }
    return this.lineIdx >= this.full.length && this.delay <= 0;
  }
}

class AiAskAction implements Action {
  private len = 0;
  private started = false;
  private idx = 0;
  constructor(private text: string) {}
  step(s: SimState, dt: number, rng: () => number): boolean {
    s.app = "ide";
    s.focus = "chat";
    if (!this.started) {
      s.chat.push({ role: "user", text: "" });
      this.idx = s.chat.length - 1;
      this.started = true;
    }
    const n = Math.max(1, Math.round(18 * dt * (0.55 + 0.9 * rng())));
    this.len = Math.min(this.text.length, this.len + n);
    s.chat[this.idx].text = this.text.slice(0, this.len);
    return this.len >= this.text.length;
  }
}

class AiRespondAction implements Action {
  private words: string[];
  private wi = 0;
  private started = false;
  private idx = 0;
  private acc = "";
  constructor(text: string) {
    this.words = text.split(/(\s+)/);
  }
  step(s: SimState, dt: number, rng: () => number): boolean {
    s.app = "ide";
    s.focus = "chat";
    if (!this.started) {
      s.chat.push({ role: "assistant", text: "" });
      this.idx = s.chat.length - 1;
      this.started = true;
    }
    let n = Math.max(1, Math.round(13 * dt * (0.7 + 0.8 * rng())));
    while (n-- > 0 && this.wi < this.words.length) this.acc += this.words[this.wi++];
    s.chat[this.idx].text = this.acc;
    return this.wi >= this.words.length;
  }
}

/**
 * Copilot/Cursor-style inline AI completion: a multi-line gray ghost block
 * appears after the caret line, the candidate reads it for a beat, then accepts
 * with Tab — the lines drop into the file with a green "AI-added" highlight and
 * diff gutter bars. This is AI *in the editor*, not chat.
 */
class InlineCompleteAction implements Action {
  private phase: "stream" | "read" | "accept" = "stream";
  private shown = 0;
  private ticks = 0;
  constructor(private lines: string[], private readTicks = 5) {}
  step(s: SimState, dt: number, rng: () => number): boolean {
    s.app = "ide";
    s.focus = "editor";
    if (this.phase === "stream") {
      // ghost suggestion streams in line-by-line (model is "thinking")
      this.shown = Math.min(this.lines.length, this.shown + (rng() < 0.6 ? 1 : 0) + 1);
      s.inlineAI = this.lines.slice(0, this.shown);
      if (this.shown >= this.lines.length) this.phase = "read";
      return false;
    }
    if (this.phase === "read") {
      this.ticks++;
      s.inlineAI = this.lines;
      if (this.ticks >= this.readTicks) this.phase = "accept";
      return false;
    }
    const doc = curDoc(s);
    const start = s.caretLine + 1;
    doc.splice(start, 0, ...this.lines);
    s.diffAdded = [];
    for (let i = 0; i < this.lines.length; i++) {
      s.diffAdded.push(start + i);
      s.gutterMarks[start + i] = "add";
    }
    s.diffClearAt = s.tick + Math.round(2.5 * s.fps);
    s.caretLine = start + this.lines.length - 1;
    s.caretCol = doc[s.caretLine].length;
    s.inlineAI = null;
    applyEditorScroll(s);
    return true;
  }
}

/**
 * Cursor "⌘K" inline edit: a floating prompt box opens in the editor, the
 * candidate types a natural-language instruction, the model shows "Generating…"
 * then proposes a diff (green added lines), which is accepted into the file.
 */
class CmdKEditAction implements Action {
  private phase: "type" | "gen" | "diff" | "accept" = "type";
  private i = 0;
  private genT = 0;
  private holdTicks = 0;
  constructor(
    private prompt: string,
    private added: string[],
    private genSeconds = 1.3,
    private diffHoldTicks = 7
  ) {}
  step(s: SimState, dt: number, rng: () => number): boolean {
    s.app = "ide";
    s.focus = "editor";
    if (!s.cmdk) s.cmdk = { prompt: "", phase: "type", added: [] };
    if (this.phase === "type") {
      const n = Math.max(1, Math.round(16 * dt * (0.6 + 0.8 * rng())));
      this.i = Math.min(this.prompt.length, this.i + n);
      s.cmdk.prompt = this.prompt.slice(0, this.i);
      if (this.i >= this.prompt.length) {
        this.phase = "gen";
        this.genT = this.genSeconds;
        s.cmdk.phase = "gen";
      }
      return false;
    }
    if (this.phase === "gen") {
      this.genT -= dt;
      if (this.genT <= 0) {
        this.phase = "diff";
        s.cmdk.phase = "diff";
        s.cmdk.added = this.added;
        this.holdTicks = this.diffHoldTicks;
      }
      return false;
    }
    if (this.phase === "diff") {
      this.holdTicks--;
      if (this.holdTicks <= 0) this.phase = "accept";
      return false;
    }
    // accept: merge the proposed lines into the file
    const doc = curDoc(s);
    const start = s.caretLine + 1;
    doc.splice(start, 0, ...this.added);
    s.diffAdded = [];
    for (let i = 0; i < this.added.length; i++) {
      s.diffAdded.push(start + i);
      s.gutterMarks[start + i] = "add";
    }
    s.diffClearAt = s.tick + Math.round(2.5 * s.fps);
    s.caretLine = start + this.added.length - 1;
    s.caretCol = doc[s.caretLine].length;
    s.cmdk = null;
    applyEditorScroll(s);
    return true;
  }
}

/**
 * Alt-tab into the browser: type the URL, "load", then scroll through the page
 * (down then partway back up). Leaves the app back in the IDE when done.
 */
class BrowseAction implements Action {
  private phase: "open" | "load" | "down" | "up" | "close" = "open";
  private urlIdx = 0;
  private loadT = 0;
  private acc = 0;
  private scrolled = 0;
  constructor(
    private url: string,
    private title: string,
    private content: string[],
    private tab: number,
    private downLines = 30,
    private upLines = 8
  ) {}
  step(s: SimState, dt: number, rng: () => number): boolean {
    s.app = "browser";
    const b = s.browser;
    b.activeTab = this.tab;
    if (this.phase === "open") {
      if (this.urlIdx === 0) {
        b.typedUrl = "";
        b.loading = true;
        b.lines = [];
        b.title = "";
      }
      const n = Math.max(1, Math.round(22 * dt * (0.6 + 0.8 * rng())));
      this.urlIdx = Math.min(this.url.length, this.urlIdx + n);
      b.typedUrl = this.url.slice(0, this.urlIdx);
      if (this.urlIdx >= this.url.length) {
        this.phase = "load";
        this.loadT = 0.6 + 0.6 * rng();
      }
      return false;
    }
    if (this.phase === "load") {
      this.loadT -= dt;
      if (this.loadT <= 0) {
        b.url = this.url;
        b.title = this.title;
        b.lines = this.content;
        b.loading = false;
        b.scrollTop = 0;
        this.phase = "down";
      }
      return false;
    }
    const maxScroll = Math.max(0, b.lines.length - VISIBLE_BROWSER_LINES);
    if (this.phase === "down") {
      this.acc += 9 * dt; // reading scroll speed
      while (this.acc >= 1 && this.scrolled < this.downLines) {
        this.acc -= 1;
        const before = b.scrollTop;
        b.scrollTop = Math.min(maxScroll, b.scrollTop + 1);
        this.scrolled++;
        if (b.scrollTop === before) break;
      }
      if (this.scrolled >= this.downLines || b.scrollTop >= maxScroll) {
        this.phase = "up";
        this.scrolled = 0;
        this.acc = 0;
      }
      return false;
    }
    if (this.phase === "up") {
      this.acc += 10 * dt;
      while (this.acc >= 1 && this.scrolled < this.upLines) {
        this.acc -= 1;
        b.scrollTop = Math.max(0, b.scrollTop - 1);
        this.scrolled++;
      }
      if (this.scrolled >= this.upLines || b.scrollTop === 0) this.phase = "close";
      return false;
    }
    // close: back to the IDE
    s.app = "ide";
    s.focus = "editor";
    return true;
  }
}

// ---------------------------------------------------------------------------
// Content corpus — a complex multi-file "bridge" take-home
// ---------------------------------------------------------------------------
const README_MD = `# Bridge Take-Home — Resilient Webhook Dispatcher

## Problem
Build a service that reliably delivers webhook events to customer
endpoints. Deliveries must be **rate-limited per destination**, retried
with **exponential backoff + jitter**, and bounded in concurrency so a
slow endpoint cannot exhaust the worker pool.

## Requirements
1. Token-bucket rate limiter, thread-safe, configurable rate/burst.
2. Async dispatch loop with a bounded concurrency semaphore.
3. Retry policy: max attempts, exponential backoff, full jitter.
4. At-least-once delivery; persist attempt state so a restart resumes.
5. HTTP API: POST /webhooks to enqueue, GET /webhooks/{id} for status.

## Evaluation
We care how you work, not just the final code: incremental commits,
tests you actually run, and clear reasoning. Use any tools you like.

## Run
    pip install -r requirements.txt
    pytest -q
    uvicorn dispatcher.api:app --reload
`;

const CONFIG_YAML = `dispatcher:
  max_concurrency: 16
  per_destination_rate: 5.0   # tokens/sec
  per_destination_burst: 10
  retry:
    max_attempts: 6
    base_delay_ms: 200
    max_delay_ms: 30000
    jitter: full
  http:
    connect_timeout_s: 3.0
    read_timeout_s: 10.0
`;

const CODE_RATELIMITER = `import threading
import time
from dataclasses import dataclass


@dataclass
class TokenBucket:
    """Thread-safe token bucket. rate = tokens/sec, capacity = burst."""

    rate: float
    capacity: int
    _tokens: float = 0.0
    _updated: float = 0.0
    _lock: threading.Lock = None  # type: ignore

    def __post_init__(self) -> None:
        self._tokens = float(self.capacity)
        self._updated = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._updated
        self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
        self._updated = now

    def try_acquire(self, n: int = 1) -> bool:
        with self._lock:
            self._refill()
            if self._tokens >= n:
                self._tokens -= n
                return True
            return False
`;

const CODE_BACKOFF = `import random


def backoff_delay(attempt: int, base_ms: int, max_ms: int, jitter: str = "full") -> float:
    """Exponential backoff with optional full jitter; returns seconds."""
    if attempt < 1:
        raise ValueError("attempt must be >= 1")
    exp = min(max_ms, base_ms * (2 ** (attempt - 1)))
    if jitter == "full":
        return random.uniform(0, exp) / 1000.0
    if jitter == "equal":
        return (exp / 2 + random.uniform(0, exp / 2)) / 1000.0
    return exp / 1000.0
`;

const CODE_MODELS = `from __future__ import annotations

import enum
import time
import uuid
from dataclasses import dataclass, field


class Status(str, enum.Enum):
    QUEUED = "queued"
    DELIVERING = "delivering"
    DELIVERED = "delivered"
    FAILED = "failed"


@dataclass
class Webhook:
    url: str
    payload: dict
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: Status = Status.QUEUED
    attempts: int = 0
    created_at: float = field(default_factory=time.time)


@dataclass
class DeliveryAttempt:
    webhook_id: str
    attempt: int
    status_code: int | None
    error: str | None
    at: float = field(default_factory=time.time)
`;

const CODE_DISPATCHER = `import asyncio
import logging
from collections import defaultdict

import httpx

from .backoff import backoff_delay
from .models import DeliveryAttempt, Status, Webhook
from .ratelimiter import TokenBucket

logger = logging.getLogger("dispatcher")


class Dispatcher:
    def __init__(self, cfg: dict) -> None:
        self.cfg = cfg
        self._sem = asyncio.Semaphore(cfg["max_concurrency"])
        self._buckets: dict[str, TokenBucket] = defaultdict(self._new_bucket)
        self._attempts: list[DeliveryAttempt] = []

    def _new_bucket(self) -> TokenBucket:
        return TokenBucket(
            rate=self.cfg["per_destination_rate"],
            capacity=self.cfg["per_destination_burst"],
        )

    async def deliver(self, wh: Webhook, client: httpx.AsyncClient) -> Status:
        retry = self.cfg["retry"]
        for attempt in range(1, retry["max_attempts"] + 1):
            while not self._buckets[wh.url].try_acquire():
                await asyncio.sleep(0.05)
            async with self._sem:
                wh.status = Status.DELIVERING
                try:
                    resp = await client.post(wh.url, json=wh.payload)
                    self._attempts.append(
                        DeliveryAttempt(wh.id, attempt, resp.status_code, None)
                    )
                    if resp.status_code < 500:
                        wh.status = Status.DELIVERED
                        return wh.status
                except httpx.HTTPError as exc:
                    self._attempts.append(
                        DeliveryAttempt(wh.id, attempt, None, str(exc))
                    )
            await asyncio.sleep(
                backoff_delay(attempt, retry["base_delay_ms"], retry["max_delay_ms"])
            )
        wh.status = Status.FAILED
        return wh.status
`;

const CODE_API = `from __future__ import annotations

import asyncio

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .dispatcher import Dispatcher
from .models import Webhook

app = FastAPI(title="Webhook Dispatcher")
_store: dict[str, Webhook] = {}
_dispatcher = Dispatcher(cfg=__import__("yaml").safe_load(open("config.yaml"))["dispatcher"])


class EnqueueBody(BaseModel):
    url: str
    payload: dict


@app.post("/webhooks")
async def enqueue(body: EnqueueBody) -> dict:
    wh = Webhook(url=body.url, payload=body.payload)
    _store[wh.id] = wh
    async with httpx.AsyncClient(timeout=10.0) as client:
        asyncio.create_task(_dispatcher.deliver(wh, client))
    return {"id": wh.id, "status": wh.status}


@app.get("/webhooks/{wid}")
async def status(wid: str) -> dict:
    wh = _store.get(wid)
    if wh is None:
        raise HTTPException(status_code=404, detail="unknown webhook")
    return {"id": wh.id, "status": wh.status, "attempts": wh.attempts}
`;

const CODE_TESTS = `import asyncio
import time

import pytest

from dispatcher.backoff import backoff_delay
from dispatcher.models import Status, Webhook
from dispatcher.ratelimiter import TokenBucket


def test_token_bucket_limits_rate():
    tb = TokenBucket(rate=5.0, capacity=2)
    assert tb.try_acquire()
    assert tb.try_acquire()
    assert not tb.try_acquire()  # burst exhausted


def test_token_bucket_refills():
    tb = TokenBucket(rate=100.0, capacity=1)
    assert tb.try_acquire()
    time.sleep(0.05)
    assert tb.try_acquire()


def test_backoff_grows_and_caps():
    d1 = backoff_delay(1, 200, 30000, jitter="none")
    d5 = backoff_delay(5, 200, 30000, jitter="none")
    assert d5 > d1
    assert backoff_delay(20, 200, 30000, jitter="none") <= 30.0


def test_webhook_defaults():
    wh = Webhook(url="https://x.test/hook", payload={"a": 1})
    assert wh.status == Status.QUEUED
    assert wh.attempts == 0
`;

// Per-file build plan: (filename, code) typed in order.
const BUILD_PLAN: { file: string; code: string; section: string }[] = [
  { file: "models.py", code: CODE_MODELS, section: "domain models" },
  { file: "ratelimiter.py", code: CODE_RATELIMITER, section: "token-bucket limiter" },
  { file: "backoff.py", code: CODE_BACKOFF, section: "backoff + jitter" },
  { file: "dispatcher.py", code: CODE_DISPATCHER, section: "async dispatch loop" },
  { file: "api.py", code: CODE_API, section: "HTTP API" },
  { file: "test_dispatcher.py", code: CODE_TESTS, section: "tests" },
];

// Completion candidates that pop over the code (method/identifier suggestions).
const COMPLETIONS: { trigger: string; items: string[]; accept: string }[] = [
  { trigger: "self.", items: ["_sem", "_buckets", "_attempts", "_new_bucket", "cfg"], accept: "_buckets" },
  { trigger: "asyncio.", items: ["Semaphore", "sleep", "create_task", "gather", "Queue"], accept: "Semaphore" },
  { trigger: "httpx.", items: ["AsyncClient", "HTTPError", "Timeout", "Response", "post"], accept: "AsyncClient" },
  { trigger: "Status.", items: ["QUEUED", "DELIVERING", "DELIVERED", "FAILED"], accept: "DELIVERED" },
  { trigger: "self._buckets[wh.url].", items: ["try_acquire", "_refill", "rate", "capacity"], accept: "try_acquire" },
];

const AI_DIALOGUE: { ask: string; reply: string }[] = [
  {
    ask: "What's a thread-safe way to implement a token-bucket rate limiter in Python without locking on every call path?",
    reply:
      "Keep the lock but make the critical section tiny: store tokens as a float plus a last-updated monotonic timestamp, and on each try_acquire take the lock, lazily refill based on elapsed*rate (capped at capacity), then either subtract and return True or return False. The lock only guards a few arithmetic ops so contention is negligible; use time.monotonic() so wall-clock jumps don't corrupt the refill. If you truly need lock-free, an atomic compare-and-swap loop on a packed (tokens,timestamp) value works but it's rarely worth the complexity here.",
  },
  {
    ask: "How should I add exponential backoff with jitter to the retry loop so a flapping endpoint doesn't cause a thundering herd?",
    reply:
      "Use capped exponential backoff with full jitter: delay = random.uniform(0, min(max_delay, base * 2**(attempt-1))). Full jitter spreads retries uniformly so many failed deliveries don't realign on the same schedule. Cap the exponential before applying jitter, sleep that many seconds, and bound max_attempts. AWS's 'Exponential Backoff and Jitter' article shows full jitter minimizes contention better than equal jitter in most cases.",
  },
  {
    ask: "How do I bound concurrent in-flight deliveries with asyncio while still rate-limiting per destination?",
    reply:
      "Two independent gates: a global asyncio.Semaphore(max_concurrency) wraps the actual HTTP send to cap total in-flight work, and a per-destination token bucket gates admission before you take the semaphore. Acquire the bucket first (await sleep a little if empty), then 'async with self._sem' around the request. That way one slow host can't monopolize the pool and each destination stays under its rate.",
  },
  {
    ask: "How do I make delivery at-least-once and idempotent so a restart resumes without double-sending?",
    reply:
      "Persist each webhook's status and attempt count before and after the send (queued -> delivering -> delivered/failed), and have the receiver dedupe on a stable event id you include in the payload/header. On startup, re-enqueue anything left in 'delivering' or 'queued'. You accept rare duplicates (at-least-once) but the idempotency key on the consumer side makes them harmless.",
  },
  {
    ask: "Suggest property-based tests for the token bucket and backoff functions.",
    reply:
      "For the bucket: for any rate>0 and capacity>=1, after draining you can never acquire more than capacity without time passing, and tokens never exceed capacity. For backoff: delay is monotonically non-decreasing in attempt before the cap, never exceeds max_delay, and with jitter='none' equals base*2**(attempt-1) capped. Hypothesis can generate attempts/base/max and assert these invariants.",
  },
];

// Copilot-style multi-line inline completions (gray ghost -> Tab accept).
const AI_INLINE: string[][] = [
  [
    "        # acquire a token before sending (per-destination rate limit)",
    "        while not self._buckets[wh.url].try_acquire():",
    "            await asyncio.sleep(0.05)",
  ],
  [
    "    if jitter == \"full\":",
    "        return random.uniform(0, exp) / 1000.0",
    "    if jitter == \"equal\":",
    "        return (exp / 2 + random.uniform(0, exp / 2)) / 1000.0",
  ],
  [
    "        self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)",
    "        self._updated = now",
  ],
  [
    "    async with httpx.AsyncClient(timeout=10.0) as client:",
    "        return await self.deliver(wh, client)",
  ],
  [
    "    @pytest.mark.parametrize(\"attempt\", [1, 2, 5, 10])",
    "    def test_backoff_monotonic(attempt):",
    "        assert backoff_delay(attempt, 200, 30000, jitter=\"none\") <= 30.0",
  ],
];

// Cursor "⌘K" inline edits: NL instruction -> proposed diff (added lines).
const CMDK_EDITS: { prompt: string; added: string[] }[] = [
  {
    prompt: "add full jitter to the backoff delay",
    added: [
      "    exp = min(max_ms, base_ms * (2 ** (attempt - 1)))",
      "    return random.uniform(0, exp) / 1000.0",
    ],
  },
  {
    prompt: "wrap the POST in the concurrency semaphore",
    added: [
      "            async with self._sem:",
      "                resp = await client.post(wh.url, json=wh.payload)",
      "                wh.attempts = attempt",
    ],
  },
  {
    prompt: "guard against an unknown webhook id with a 404",
    added: [
      "    if wh is None:",
      "        raise HTTPException(status_code=404, detail=\"unknown webhook\")",
    ],
  },
  {
    prompt: "log structured delivery result with attempt count",
    added: [
      "        logger.info(\"delivered %s after %d attempt(s)\", wh.id, attempt)",
    ],
  },
  {
    prompt: "re-enqueue webhooks left in DELIVERING on startup",
    added: [
      "    for wh in _store.values():",
      "        if wh.status == Status.DELIVERING:",
      "            wh.status = Status.QUEUED",
    ],
  },
];

const PYTEST_FAIL = [
  "============================= test session starts =============================",
  "collected 4 items",
  "",
  "tests/test_dispatcher.py ..F.                                            [100%]",
  "",
  "=================================== FAILURES ===================================",
  "_________________________ test_backoff_grows_and_caps _________________________",
  "    def test_backoff_grows_and_caps():",
  ">       assert backoff_delay(20, 200, 30000, jitter='none') <= 30.0",
  "E       assert 104857.6 <= 30.0",
  "E        +  where 104857.6 = backoff_delay(20, 200, 30000, jitter='none')",
  "tests/test_dispatcher.py:27: AssertionError",
  "=========================== 1 failed, 3 passed in 0.09s =======================",
];

const PYTEST_PASS = [
  "============================= test session starts =============================",
  "collected 4 items",
  "",
  "tests/test_dispatcher.py ....                                            [100%]",
  "",
  "============================== 4 passed in 0.06s ==============================",
];

const RUFF_OK = ["All checks passed!"];
const MYPY_OK = ["Success: no issues found in 6 source files"];
const UVICORN_OUT = [
  "INFO:     Started server process [4123]",
  "INFO:     Waiting for application startup.",
  "INFO:     Application startup complete.",
  "INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)",
];

// Browser pages the candidate reads.
const PAGE_TASK = {
  url: "https://app.bridge-jobs.com/CandidateAssessment?token=7f3c…",
  title: "Bridge — Resilient Webhook Dispatcher (Take-Home)",
  content: (README_MD + "\n\nTime limit: 90 minutes. You may use any IDE, AI assistant, or web search. We review your screen recording to understand HOW you work.").split("\n"),
};
const PAGE_PY_DOCS = {
  url: "https://docs.python.org/3/library/asyncio-sync.html",
  title: "asyncio — Synchronization Primitives — Python 3.12",
  content: [
    "class asyncio.Semaphore(value=1)",
    "",
    "A Semaphore manages an internal counter which is decremented by each",
    "acquire() call and incremented by each release() call. The counter can",
    "never go below zero; when acquire() finds it is zero, it blocks, waiting",
    "until some task calls release().",
    "",
    "The preferred way to use a Semaphore is an async with statement:",
    "",
    "    sem = asyncio.Semaphore(10)",
    "    async with sem:",
    "        # work with the shared resource",
    "        ...",
    "",
    "Bounded semaphores raise ValueError if release() is called too many",
    "times. Use Semaphore to limit the number of concurrent operations, for",
    "example to bound concurrent outbound HTTP requests so you do not exhaust",
    "file descriptors or overwhelm a downstream service.",
    "",
    "Deprecated since 3.10: the loop parameter.",
    "",
    "See also: asyncio.Queue, asyncio.gather(), and the high-level API for",
    "running tasks concurrently with bounded parallelism.",
  ],
};
const PAGE_SO = {
  url: "https://stackoverflow.com/questions/667508/thread-safe-token-bucket",
  title: "python - Thread-safe token bucket rate limiter - Stack Overflow",
  content: [
    "Q: Thread-safe token bucket rate limiter                      [asked 6y ago]",
    "",
    "I need to limit calls to an API to N per second across threads. What is a",
    "correct, low-overhead token bucket implementation?",
    "",
    "Answer (accepted, 214 upvotes):",
    "",
    "Don't run a background refill thread — refill lazily. Store the token",
    "count and a monotonic timestamp. On acquire, take a short lock, compute",
    "elapsed = now - last, add elapsed * rate (clamped to capacity), update",
    "the timestamp, then test/subtract:",
    "",
    "    with self._lock:",
    "        now = time.monotonic()",
    "        self._tokens = min(cap, self._tokens + (now-self._last)*rate)",
    "        self._last = now",
    "        if self._tokens >= 1:",
    "            self._tokens -= 1",
    "            return True",
    "        return False",
    "",
    "monotonic() is essential — time.time() can jump backwards on NTP sync and",
    "hand out a burst of tokens. Comments: +1 for lazy refill; avoid per-call",
    "threads. See also leaky-bucket for smoothing vs bursting trade-offs.",
  ],
};
const PAGE_BLOG = {
  url: "https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/",
  title: "Timeouts, retries, and backoff with jitter - Amazon Builders' Library",
  content: [
    "Timeouts, retries, and backoff with jitter",
    "",
    "When a request fails, retrying is tempting — but naive retries synchronize",
    "across clients and create load spikes (a 'thundering herd') exactly when a",
    "service is already struggling.",
    "",
    "Exponential backoff increases the wait between attempts: base * 2^attempt,",
    "capped at a maximum. But pure exponential backoff still aligns retries.",
    "",
    "Jitter randomizes the delay to spread retries out:",
    "",
    "    sleep = random_between(0, min(cap, base * 2 ** attempt))   # full jitter",
    "",
    "Our simulations show full jitter minimizes both the total work and the",
    "completion time under contention, compared to no jitter or 'equal' jitter.",
    "",
    "Also: cap total attempts, make retries idempotent, and prefer retrying at",
    "the lowest layer that can safely do so. Combine with a token bucket so a",
    "client's own retries are themselves rate-limited.",
  ],
};
const PAGE_TRACEBACK_SEARCH = {
  url: "https://www.google.com/search?q=pytest+assert+104857.6+backoff+exceeds+max",
  title: "pytest backoff exceeds max_delay - Google Search",
  content: [
    "About 1,240,000 results (0.36 seconds)",
    "",
    "Stack Overflow — Why does my exponential backoff exceed the cap?",
    "  You're applying the cap AFTER multiplying, or multiplying by 2**attempt",
    "  without min(). Clamp first: exp = min(max_delay, base * 2**(attempt-1)).",
    "",
    "GitHub issue — backoff util returns ms not seconds",
    "  Remember to divide by 1000 if base is in milliseconds; mixing units is a",
    "  common off-by-1000 bug that makes the cap look broken.",
    "",
    "Reddit r/learnpython — capped exponential backoff",
    "  min() goes around the whole base*2**n term, not just base. Add a unit",
    "  test asserting backoff_delay(big_attempt) <= max_delay seconds.",
    "",
    "docs.python.org — random.uniform(a, b)",
    "  Return a random floating point number N such that a <= N <= b.",
  ],
};

// ---------------------------------------------------------------------------
// Per-variant infinite action generators (fill 30+ minutes of varied work)
// ---------------------------------------------------------------------------
function chunksOf(code: string): string[] {
  return code.split(/\n(?=\n|def |class |@|async |import |from )/g);
}

function maybeCompletion(rng: () => number): typeof COMPLETIONS[number] | null {
  return rng() < 0.5 ? COMPLETIONS[(rng() * COMPLETIONS.length) | 0] : null;
}

function* reviewScroll(): Generator<Action> {
  yield new ScrollReadAction(9999, -1);
  yield new PauseAction(0.4);
  yield new ScrollReadAction(9999, 1);
}

function* typeFile(
  file: string,
  code: string,
  cps: number,
  rng: () => number,
  withCompletions: boolean,
  aiIntensity = 0.25 // probability of an AI inline-complete / ⌘K edit per chunk
): Generator<Action> {
  yield new OpenFileAction(file);
  const chunks = chunksOf(code);
  for (const ch of chunks) {
    // AI *in the editor*: accept a Copilot-style inline completion, or run a
    // ⌘K inline edit, instead of (or before) hand-typing the chunk.
    if (rng() < aiIntensity) {
      yield new InlineCompleteAction(AI_INLINE[(rng() * AI_INLINE.length) | 0]);
    }
    if (rng() < aiIntensity * 0.8) {
      const e = CMDK_EDITS[(rng() * CMDK_EDITS.length) | 0];
      yield new CmdKEditAction(e.prompt, e.added);
    }
    const comp = withCompletions ? maybeCompletion(rng) : null;
    if (comp) {
      yield new CompletionTypeAction(ch + "\n", cps, comp.items, comp.accept);
    } else {
      yield new TypeAction(ch + "\n", cps);
    }
    if (rng() < 0.4) yield new ScrollReadAction(5 + ((rng() * 10) | 0), rng() < 0.5 ? -1 : 1);
    if (rng() < 0.2) yield new PauseAction(0.5 + rng());
  }
}

function* actionGen(variant: CodingVariant, rng: () => number): Generator<Action> {
  // Always start by reading the assessment task in the browser.
  yield new BrowseAction(PAGE_TASK.url, PAGE_TASK.title, PAGE_TASK.content, 0, 26, 6);
  yield new OpenFileAction("README.md");
  yield new ScrollReadAction(12, 1);

  let cycle = 0;
  const browserPages = [PAGE_PY_DOCS, PAGE_SO, PAGE_BLOG];

  while (true) {
    const plan = BUILD_PLAN[cycle % BUILD_PLAN.length];

    if (variant === "steady") {
      // research a bit, build the module with autocomplete, test, occasional AI
      if (cycle % 2 === 0) {
        const pg = browserPages[cycle % browserPages.length];
        yield new BrowseAction(pg.url, pg.title, pg.content, 1, 18, 6);
      }
      yield* typeFile(plan.file, plan.code, 9, rng, true, 0.28);
      yield* reviewScroll();
      yield new TerminalAction("python -m pytest -q", PYTEST_PASS);
      if (cycle % 3 === 1) yield new TerminalAction("ruff check .", RUFF_OK);
      if (cycle % 2 === 1) {
        const d = AI_DIALOGUE[cycle % AI_DIALOGUE.length];
        yield new AiAskAction(d.ask);
        yield new AiRespondAction(d.reply);
      }
    } else if (variant === "bursty") {
      // long doc reading, then fast bursts with think pauses
      const pg = browserPages[cycle % browserPages.length];
      yield new BrowseAction(pg.url, pg.title, pg.content, 1, 34, 4);
      yield* typeFile(plan.file, plan.code, 20, rng, true, 0.18);
      yield new PauseAction(1.4 + 1.9 * rng());
      yield* reviewScroll();
      yield new TerminalAction("python -m pytest -q", cycle % 2 ? PYTEST_FAIL : PYTEST_PASS);
      yield new PauseAction(1.5 + 2 * rng());
    } else if (variant === "ai_heavy") {
      // chat + browser dominated; accept suggested code via completions
      const d = AI_DIALOGUE[cycle % AI_DIALOGUE.length];
      yield new AiAskAction(d.ask);
      yield new AiRespondAction(d.reply + " " + d.reply);
      const pg = browserPages[cycle % browserPages.length];
      yield new BrowseAction(pg.url, pg.title, pg.content, 1, 22, 6);
      // AI-in-the-editor: a ⌘K edit, then accept a streamed inline completion.
      const e = CMDK_EDITS[cycle % CMDK_EDITS.length];
      yield new OpenFileAction(plan.file);
      yield new CmdKEditAction(e.prompt, e.added);
      yield new InlineCompleteAction(AI_INLINE[cycle % AI_INLINE.length], 7);
      yield* typeFile(plan.file, plan.code, 16, rng, true, 0.6);
      const d2 = AI_DIALOGUE[(cycle + 2) % AI_DIALOGUE.length];
      yield new AiAskAction(d2.ask);
      yield new AiRespondAction(d2.reply + " " + d2.reply);
      yield* reviewScroll();
      if (cycle % 2 === 0) yield new TerminalAction("python -m pytest -q", PYTEST_PASS);
    } else {
      // debug: build, fail, search the error, fix, re-run
      yield* typeFile(plan.file, plan.code, 14, rng, true, 0.3);
      yield new TerminalAction("python -m pytest -q", PYTEST_FAIL);
      yield new DoAction((s) => {
        // squiggle the offending backoff line if present
        const doc = s.docs[s.fileName];
        const idx = doc.findIndex((l) => l.includes("backoff_delay") || l.includes("2 **"));
        s.squiggles = idx >= 0 ? [idx] : [Math.max(0, doc.length - 2)];
      });
      yield new PauseAction(0.6 + rng());
      yield new BrowseAction(
        PAGE_TRACEBACK_SEARCH.url,
        PAGE_TRACEBACK_SEARCH.title,
        PAGE_TRACEBACK_SEARCH.content,
        2,
        16,
        6
      );
      yield new ScrollReadAction(12, -1);
      yield new CmdKEditAction("cap the exponential before applying jitter so it never exceeds max_ms", [
        "    exp = min(max_ms, base_ms * (2 ** (attempt - 1)))",
        "    return random.uniform(0, exp) / 1000.0",
      ]);
      yield new DoAction((s) => (s.squiggles = []));
      yield new TerminalAction("python -m pytest -q", PYTEST_PASS);
      yield* reviewScroll();
      yield new TerminalAction("git diff --stat", [
        " dispatcher/backoff.py    |  6 +++--",
        " dispatcher/dispatcher.py | 28 ++++++++++++++",
        " tests/test_dispatcher.py | 18 ++++++++",
        " 3 files changed, 50 insertions(+), 2 deletions(-)",
      ]);
      if (cycle % 3 === 1) {
        const d = AI_DIALOGUE[cycle % AI_DIALOGUE.length];
        yield new AiAskAction(d.ask);
        yield new AiRespondAction(d.reply);
      }
    }
    cycle++;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= width) {
      out.push(raw);
      continue;
    }
    let line = "";
    for (const word of raw.split(" ")) {
      if ((line + word).length > width) {
        if (line) out.push(line.trimEnd());
        line = word + " ";
      } else {
        line += word + " ";
      }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}

function renderBrowser(s: SimState): string {
  const b = s.browser;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // chrome
  parts.push(`<rect x="0" y="0" width="${W}" height="${BROWSER_CHROME_H}" fill="#dee1e6"/>`);
  // tabs
  b.tabs.forEach((t, i) => {
    const tx = 12 + i * 190;
    const active = i === b.activeTab;
    parts.push(
      `<rect x="${tx}" y="6" width="182" height="28" rx="6" fill="${active ? "#ffffff" : "#c9cdd4"}"/>`
    );
    parts.push(
      `<text x="${tx + 12}" y="25" font-family="sans-serif" font-size="12" fill="#202124">${esc(t.slice(0, 22))}</text>`
    );
  });
  // url bar
  parts.push(`<rect x="12" y="42" width="${W - 24}" height="28" rx="14" fill="#f1f3f4"/>`);
  parts.push(
    `<circle cx="30" cy="56" r="6" fill="none" stroke="#5f6368" stroke-width="1.5"/>`
  );
  const urlText = b.loading ? b.typedUrl : b.url;
  parts.push(
    `<text x="46" y="60" font-family="sans-serif" font-size="13" fill="#202124">${esc(urlText)}</text>`
  );
  if (b.loading) {
    parts.push(`<rect x="0" y="${BROWSER_CHROME_H}" width="${(s.tick % 30) / 30 * W}" height="3" fill="#1a73e8"/>`);
  }
  // page title
  parts.push(
    `<text x="60" y="${BROWSER_CONTENT_TOP + 6}" font-family="sans-serif" font-size="20" fill="#202124" font-weight="bold">${esc(b.title)}</text>`
  );
  // content (wrapped, scrolled)
  const all: string[] = [];
  for (const raw of b.lines) for (const wl of wrap(raw, BROWSER_WRAP)) all.push(wl);
  for (let v = 0; v < VISIBLE_BROWSER_LINES; v++) {
    const ln = b.scrollTop + v;
    if (ln >= all.length) break;
    const y = BROWSER_CONTENT_TOP + 36 + v * BROWSER_LINE_H;
    const txt = all[ln];
    const mono = /^[ ]{2,}|with self|self\.|sleep =|async |def |return|assert/.test(txt);
    parts.push(
      `<text x="60" y="${y}" font-family="${mono ? "monospace" : "sans-serif"}" font-size="13" fill="#3c4043" xml:space="preserve">${esc(txt)}</text>`
    );
  }
  // scrollbar
  if (all.length > VISIBLE_BROWSER_LINES) {
    const trackH = H - BROWSER_CONTENT_TOP - 20;
    const thumbH = Math.max(24, (VISIBLE_BROWSER_LINES / all.length) * trackH);
    const thumbY =
      BROWSER_CONTENT_TOP + (b.scrollTop / Math.max(1, all.length - VISIBLE_BROWSER_LINES)) * (trackH - thumbH);
    parts.push(`<rect x="${W - 12}" y="${thumbY}" width="6" height="${thumbH}" rx="3" fill="#bdc1c6"/>`);
  }
  return parts.join("");
}

function render(s: SimState): string {
  const blink = Math.floor(s.tick / Math.max(1, s.fps / 2)) % 2 === 0;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`);
  parts.push(
    `<defs><clipPath id="editorClip"><rect x="${EDITOR_X}" y="${EDITOR_TOP}" width="${EDITOR_CODE_RIGHT - EDITOR_X}" height="${EDITOR_BOTTOM - EDITOR_TOP}"/></clipPath></defs>`
  );

  if (s.app === "browser") {
    parts.push(renderBrowser(s));
    parts.push(`</svg>`);
    return parts.join("");
  }

  parts.push(`<rect width="${W}" height="${H}" fill="#1e1e1e"/>`);

  // Top bar + tab + clock
  parts.push(`<rect x="0" y="0" width="${W}" height="${TOPBAR_H}" fill="#2d2d2d"/>`);
  parts.push(
    `<rect x="${EDITOR_X}" y="0" width="${s.fileName.length * 8 + 28}" height="${TOPBAR_H}" fill="#1e1e1e"/>`
  );
  parts.push(
    `<text x="${EDITOR_X + 12}" y="22" font-family="monospace" font-size="13" fill="#ffffff">${esc(s.fileName)}</text>`
  );
  const mins = Math.floor(s.tick / s.fps / 60);
  const secs = Math.floor(s.tick / s.fps) % 60;
  parts.push(
    `<text x="${CHAT_X - 120}" y="22" font-family="monospace" font-size="12" fill="#9a9a9a">elapsed ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}</text>`
  );

  // File tree
  parts.push(`<rect x="0" y="${TOPBAR_H}" width="${TREE_W}" height="${H - TOPBAR_H}" fill="#252526"/>`);
  parts.push(`<text x="14" y="${TOPBAR_H + 22}" font-family="monospace" font-size="11" fill="#9a9a9a">EXPLORER</text>`);
  s.files.forEach((f, i) => {
    const indent = 14 + (f.indent ?? 0) * 12;
    parts.push(
      `<text x="${indent}" y="${TOPBAR_H + 48 + i * 21}" font-family="monospace" font-size="12" fill="${f.active ? "#ffffff" : f.dir ? "#c5a880" : "#aeaeae"}">${esc(f.name)}</text>`
    );
  });

  // Editor panel
  parts.push(
    `<rect x="${EDITOR_X}" y="${EDITOR_TOP}" width="${EDITOR_RIGHT - EDITOR_X}" height="${EDITOR_BOTTOM - EDITOR_TOP}" fill="#1e1e1e"/>`
  );
  if (s.focus === "editor") {
    const hlY = EDITOR_TOP + 6 + (s.caretLine - s.scrollTop) * LINE_H;
    if (hlY >= EDITOR_TOP && hlY < EDITOR_BOTTOM) {
      parts.push(
        `<rect x="${EDITOR_X}" y="${hlY - 16}" width="${EDITOR_CODE_RIGHT - EDITOR_X}" height="${LINE_H}" fill="#2a2d2e"/>`
      );
    }
  }
  const doc = curDoc(s);
  const firstLine = s.scrollTop;
  parts.push(`<g clip-path="url(#editorClip)">`);
  for (let v = 0; v < VISIBLE_EDITOR_LINES; v++) {
    const ln = firstLine + v;
    if (ln >= doc.length) break;
    const y = EDITOR_TOP + 22 + v * LINE_H;
    const rowTop = EDITOR_TOP + 6 + v * LINE_H - 16;
    // AI-added diff highlight (transient green)
    if (s.diffAdded.includes(ln)) {
      parts.push(
        `<rect x="${EDITOR_X}" y="${rowTop}" width="${EDITOR_CODE_RIGHT - EDITOR_X}" height="${LINE_H}" fill="#10351f"/>`
      );
    }
    // diff gutter bar for changed lines
    const gm = s.gutterMarks[ln];
    if (gm) {
      parts.push(
        `<rect x="${EDITOR_X + 2}" y="${rowTop}" width="3" height="${LINE_H}" fill="${gm === "add" ? "#3fb950" : "#3794ff"}"/>`
      );
    }
    parts.push(
      `<text x="${EDITOR_X + 8}" y="${y}" font-family="monospace" font-size="12" fill="#5a5a5a">${ln + 1}</text>`
    );
    parts.push(
      `<text x="${CODE_X}" y="${y}" font-family="monospace" font-size="14" fill="#d4d4d4" xml:space="preserve">${esc(doc[ln] || " ")}</text>`
    );
    // red error squiggle
    if (s.squiggles.includes(ln)) {
      const w = Math.max(40, (doc[ln] || "").length * CHAR_W);
      parts.push(
        `<line x1="${CODE_X}" y1="${y + 4}" x2="${Math.min(EDITOR_CODE_RIGHT, CODE_X + w)}" y2="${y + 4}" stroke="#f14c4c" stroke-width="1.5" stroke-dasharray="2,2"/>`
      );
    }
  }
  // inline ghost text after the caret (gray)
  if (s.ghost && s.focus === "editor") {
    const cv = s.caretLine - s.scrollTop;
    if (cv >= 0 && cv < VISIBLE_EDITOR_LINES) {
      const gx = CODE_X + s.caretCol * CHAR_W;
      const gy = EDITOR_TOP + 22 + cv * LINE_H;
      parts.push(
        `<text x="${gx}" y="${gy}" font-family="monospace" font-size="14" fill="#6a6a6a" xml:space="preserve">${esc(s.ghost)}</text>`
      );
    }
  }
  // multi-line Copilot-style AI inline suggestion (gray block after the caret)
  if (s.inlineAI && s.focus === "editor" && !s.cmdk) {
    const startRow = s.caretLine - s.scrollTop + 1;
    for (let i = 0; i < s.inlineAI.length; i++) {
      const row = startRow + i;
      if (row < 0 || row >= VISIBLE_EDITOR_LINES) continue;
      const gy = EDITOR_TOP + 22 + row * LINE_H;
      parts.push(
        `<rect x="${EDITOR_X}" y="${gy - 16}" width="${EDITOR_CODE_RIGHT - EDITOR_X}" height="${LINE_H}" fill="#0b243f" opacity="0.55"/>`
      );
      parts.push(
        `<text x="${CODE_X}" y="${gy}" font-family="monospace" font-size="14" fill="#7fb0e0" font-style="italic" xml:space="preserve">${esc(s.inlineAI[i])}</text>`
      );
    }
    const hy = EDITOR_TOP + 22 + Math.max(0, startRow) * LINE_H;
    parts.push(
      `<rect x="${EDITOR_CODE_RIGHT - 168}" y="${hy - 15}" width="160" height="16" rx="3" fill="#1f6feb"/>`
    );
    parts.push(
      `<text x="${EDITOR_CODE_RIGHT - 160}" y="${hy - 3}" font-family="sans-serif" font-size="10" fill="#ffffff">AI suggestion · Tab</text>`
    );
  }
  parts.push(`</g>`);

  // block caret
  if (s.focus === "editor" && blink) {
    const cv = s.caretLine - s.scrollTop;
    if (cv >= 0 && cv < VISIBLE_EDITOR_LINES) {
      const cx = CODE_X + s.caretCol * CHAR_W;
      const cy = EDITOR_TOP + 9 + cv * LINE_H;
      parts.push(`<rect x="${cx}" y="${cy}" width="${CHAR_W}" height="18" fill="#aeafad"/>`);
    }
  }

  // autocomplete popup (floats over the code -> OCR stressor)
  if (s.autocomplete && s.focus === "editor") {
    const ac = s.autocomplete;
    const cv = ac.caretLine - s.scrollTop;
    if (cv >= -1 && cv < VISIBLE_EDITOR_LINES) {
      const px = Math.min(EDITOR_CODE_RIGHT - 230, CODE_X + ac.caretCol * CHAR_W);
      const py = EDITOR_TOP + 26 + cv * LINE_H;
      const rowH = 20;
      const popH = ac.items.length * rowH + 8;
      parts.push(`<rect x="${px}" y="${py}" width="232" height="${popH}" fill="#252526" stroke="#454545" stroke-width="1"/>`);
      ac.items.forEach((it, i) => {
        const ry = py + 4 + i * rowH;
        if (i === ac.selected) {
          parts.push(`<rect x="${px + 1}" y="${ry}" width="230" height="${rowH}" fill="#04395e"/>`);
        }
        parts.push(`<rect x="${px + 6}" y="${ry + 4}" width="12" height="12" rx="2" fill="#b180d7"/>`);
        parts.push(
          `<text x="${px + 24}" y="${ry + 14}" font-family="monospace" font-size="12" fill="${i === ac.selected ? "#ffffff" : "#c8c8c8"}">${esc(it)}</text>`
        );
        parts.push(
          `<text x="${px + 150}" y="${ry + 14}" font-family="monospace" font-size="10" fill="#7a7a7a">method</text>`
        );
      });
    }
  }

  // minimap (right edge of editor) — small per-line blocks
  const mmX = EDITOR_RIGHT - MINIMAP_W;
  parts.push(`<rect x="${mmX}" y="${EDITOR_TOP}" width="${MINIMAP_W}" height="${EDITOR_BOTTOM - EDITOR_TOP}" fill="#191919"/>`);
  const mmLines = Math.min(doc.length, 180);
  const mmScale = (EDITOR_BOTTOM - EDITOR_TOP) / Math.max(mmLines, VISIBLE_EDITOR_LINES);
  for (let i = 0; i < mmLines; i++) {
    const len = Math.min(MINIMAP_W - 4, Math.ceil((doc[i]?.length || 0) / 6));
    if (len <= 0) continue;
    parts.push(
      `<rect x="${mmX + 2}" y="${EDITOR_TOP + i * mmScale}" width="${len}" height="${Math.max(1, mmScale - 0.5)}" fill="#3a3a3a"/>`
    );
  }
  // minimap viewport
  parts.push(
    `<rect x="${mmX}" y="${EDITOR_TOP + s.scrollTop * mmScale}" width="${MINIMAP_W}" height="${VISIBLE_EDITOR_LINES * mmScale}" fill="#ffffff" opacity="0.08"/>`
  );

  // ⌘K inline-edit widget (AI edit prompt -> Generating… -> proposed diff)
  if (s.cmdk && s.focus === "editor") {
    const cv = Math.max(0, Math.min(VISIBLE_EDITOR_LINES - 4, s.caretLine - s.scrollTop));
    const wx = EDITOR_X + 26;
    const ww = EDITOR_CODE_RIGHT - wx - 18;
    const wy = EDITOR_TOP + 8 + cv * LINE_H;
    const headerH = 32;
    let bodyLines: string[] = [];
    if (s.cmdk.phase === "gen") bodyLines = ["Generating" + ".".repeat(1 + (s.tick % 3))];
    else if (s.cmdk.phase === "diff") bodyLines = s.cmdk.added;
    const bodyH = bodyLines.length ? bodyLines.length * 18 + 24 : 6;
    const totalH = headerH + bodyH;
    parts.push(
      `<rect x="${wx}" y="${wy}" width="${ww}" height="${totalH}" rx="6" fill="#191919" stroke="#1f6feb" stroke-width="1.5"/>`
    );
    parts.push(
      `<rect x="${wx + 8}" y="${wy + 6}" width="40" height="20" rx="4" fill="#1f6feb"/>`
    );
    parts.push(
      `<text x="${wx + 14}" y="${wy + 20}" font-family="sans-serif" font-size="11" fill="#ffffff" font-weight="bold">Cmd K</text>`
    );
    parts.push(
      `<text x="${wx + 56}" y="${wy + 20}" font-family="sans-serif" font-size="12" fill="#e6e6e6">${esc(s.cmdk.prompt)}${blink && s.cmdk.phase === "type" ? "|" : ""}</text>`
    );
    bodyLines.forEach((l, i) => {
      const by = wy + headerH + 16 + i * 18;
      if (s.cmdk!.phase === "diff") {
        parts.push(
          `<rect x="${wx + 6}" y="${by - 13}" width="${ww - 12}" height="17" fill="#10351f"/>`
        );
        parts.push(
          `<text x="${wx + 12}" y="${by}" font-family="monospace" font-size="12" fill="#3fb950" xml:space="preserve">+ ${esc(l)}</text>`
        );
      } else {
        parts.push(
          `<text x="${wx + 12}" y="${by}" font-family="sans-serif" font-size="12" fill="#c5a880">${esc(l)}</text>`
        );
      }
    });
    if (s.cmdk.phase === "diff") {
      parts.push(
        `<text x="${wx + 12}" y="${wy + totalH - 7}" font-family="sans-serif" font-size="10" fill="#8b949e">Enter Accept    Esc Reject</text>`
      );
    }
  }

  // Terminal panel
  parts.push(`<rect x="${EDITOR_X}" y="${TERM_TOP}" width="${EDITOR_RIGHT - EDITOR_X}" height="${H - TERM_TOP}" fill="#0c0c0c"/>`);
  parts.push(
    `<text x="${EDITOR_X + 12}" y="${TERM_TOP + 16}" font-family="monospace" font-size="10" fill="${s.focus === "terminal" ? "#39d353" : "#808080"}">TERMINAL</text>`
  );
  const termStart = Math.max(0, s.terminal.length - VISIBLE_TERM_LINES);
  for (let v = 0; v < VISIBLE_TERM_LINES; v++) {
    const ln = termStart + v;
    if (ln >= s.terminal.length) break;
    const text = s.terminal[ln];
    const color = /FAIL|Error|failed|assert/.test(text)
      ? "#f97583"
      : /passed|\[100%\]|^\$|passed!|Success|running/.test(text)
        ? "#39d353"
        : "#cccccc";
    parts.push(
      `<text x="${EDITOR_X + 12}" y="${TERM_TOP + 38 + v * TERM_LINE_H}" font-family="monospace" font-size="12" fill="${color}" xml:space="preserve">${esc(text)}</text>`
    );
  }

  // AI chat sidebar
  parts.push(`<rect x="${CHAT_X}" y="${TOPBAR_H}" width="${CHAT_W}" height="${H - TOPBAR_H}" fill="#202123"/>`);
  parts.push(
    `<text x="${CHAT_X + 14}" y="${TOPBAR_H + 22}" font-family="monospace" font-size="11" fill="${s.focus === "chat" ? "#19c37d" : "#8e8ea0"}">AI CHAT — Assistant</text>`
  );
  const rendered: { text: string; role: string }[] = [];
  for (const m of s.chat) {
    for (const wl of wrap(m.text, CHAT_WRAP)) rendered.push({ text: wl, role: m.role });
    rendered.push({ text: "", role: m.role });
  }
  const chatStart = Math.max(0, rendered.length - VISIBLE_CHAT_LINES);
  for (let v = 0; v < VISIBLE_CHAT_LINES; v++) {
    const idx = chatStart + v;
    if (idx >= rendered.length) break;
    const r = rendered[idx];
    const y = TOPBAR_H + 50 + v * CHAT_LINE_H;
    if (r.text) {
      parts.push(
        `<text x="${CHAT_X + 14}" y="${y}" font-family="sans-serif" font-size="12" fill="${r.role === "user" ? "#d1d5db" : "#19c37d"}" xml:space="preserve">${esc(r.text)}</text>`
      );
    }
  }

  // focus border
  const fb =
    s.focus === "editor"
      ? `<rect x="${EDITOR_X}" y="${EDITOR_TOP}" width="${EDITOR_RIGHT - EDITOR_X}" height="${EDITOR_BOTTOM - EDITOR_TOP}" fill="none" stroke="#3794ff" stroke-width="1.5"/>`
      : s.focus === "terminal"
        ? `<rect x="${EDITOR_X}" y="${TERM_TOP}" width="${EDITOR_RIGHT - EDITOR_X}" height="${H - TERM_TOP}" fill="none" stroke="#3794ff" stroke-width="1.5"/>`
        : `<rect x="${CHAT_X}" y="${TOPBAR_H}" width="${CHAT_W}" height="${H - TOPBAR_H}" fill="none" stroke="#19c37d" stroke-width="1.5"/>`;
  parts.push(fb);

  parts.push(`</svg>`);
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Pixel-diff analysis — mirrors videoFrameExtractor's thresholds exactly
// ---------------------------------------------------------------------------
const THUMB = 128;
const DIFF_THRESHOLD = 0.005;
const CHANNEL_THRESHOLD = 25;

function pixelDiff(a: Buffer, b: Buffer): number {
  const pixels = THUMB * THUMB;
  let diff = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 3;
    if (
      Math.abs(a[o] - b[o]) > CHANNEL_THRESHOLD ||
      Math.abs(a[o + 1] - b[o + 1]) > CHANNEL_THRESHOLD ||
      Math.abs(a[o + 2] - b[o + 2]) > CHANNEL_THRESHOLD
    ) {
      diff++;
    }
  }
  return diff / pixels;
}

export interface StressVideoResult {
  variant: CodingVariant;
  label: string;
  path: string;
  sampleFrames: string[];
  montagePath: string;
  durationSeconds: number;
  fps: number;
  totalFrames: number;
  width: number;
  height: number;
  sizeBytes: number;
  featureFrames: {
    browser: number;
    autocomplete: number;
    squiggle: number;
    aiInline: number;
    cmdk: number;
  };
  analysis: {
    candidateFrames: number;
    keptFrames: number;
    keepRate: number;
    estimatedBatches: number;
    bucketKeepRates: number[];
  };
}

export async function renderStressVideo(opts: {
  variant: CodingVariant;
  label: string;
  outDir: string;
  targetSeconds?: number;
  fps?: number;
  seed?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<StressVideoResult> {
  const fps = opts.fps ?? 3;
  const targetSeconds = opts.targetSeconds ?? 1860; // 31 minutes
  const totalFrames = Math.round(targetSeconds * fps);
  const dt = 1 / fps;
  const rng = mulberry32(opts.seed ?? 1234);

  const ffmpegPath = (await import("@ffmpeg-installer/ffmpeg")).default.path;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `stress-${opts.variant}-`));
  const framesDir = path.join(tmp, "frames");
  await fs.mkdir(framesDir);
  await fs.mkdir(opts.outDir, { recursive: true });

  const state = newState(fps);
  const gen = actionGen(opts.variant, rng);
  let current: Action = gen.next().value as Action;

  const CANDIDATE_INTERVAL = 0.5;
  const MAX_IDLE_SEC = 10;
  let lastKeptThumb: Buffer | null = null;
  let lastKeptTimeSec = -MAX_IDLE_SEC;
  let nextSampleTime = 0;
  let candidateFrames = 0;
  let keptFrames = 0;
  const bucketSize = 60; // seconds (longer clips -> coarser buckets)
  const buckets: { kept: number; total: number }[] = [];

  const featureFrames = { browser: 0, autocomplete: 0, squiggle: 0, aiInline: 0, cmdk: 0 };

  // Sample frames: a mix of evenly-spaced + guaranteed feature coverage.
  const sampleFiles: string[] = [];
  const evenIdx = new Set(
    [0.04, 0.16, 0.3, 0.46, 0.62, 0.78, 0.92].map((f) => Math.floor(totalFrames * f))
  );
  const capturedTags = new Set<string>();
  const MAX_SAMPLES = 9;

  async function capture(png: Buffer): Promise<void> {
    if (sampleFiles.length >= MAX_SAMPLES) return;
    const sp = path.join(opts.outDir, `${opts.variant}-sample-${sampleFiles.length + 1}.png`);
    await fs.writeFile(sp, png);
    sampleFiles.push(sp);
  }

  for (let f = 0; f < totalFrames; f++) {
    state.tick = f;
    let guard = 0;
    while (current && (current as any)._done) {
      current = gen.next().value as Action;
      if (++guard > 50) break;
    }
    const done = current.step(state, dt, rng);
    if (done) (current as any)._done = true;

    if (state.diffAdded.length && state.tick > state.diffClearAt) state.diffAdded = [];

    if (state.app === "browser") featureFrames.browser++;
    if (state.autocomplete) featureFrames.autocomplete++;
    if (state.squiggles.length) featureFrames.squiggle++;
    if (state.inlineAI) featureFrames.aiInline++;
    if (state.cmdk) featureFrames.cmdk++;

    const svg = render(state);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const framePath = path.join(framesDir, `frame_${String(f + 1).padStart(6, "0")}.png`);
    await fs.writeFile(framePath, png);

    // guaranteed feature samples for the approval montage
    const browserLoaded =
      state.app === "browser" && !state.browser.loading && state.browser.lines.length > 0;
    if (state.cmdk && state.cmdk.phase === "diff" && !capturedTags.has("cmdk")) {
      capturedTags.add("cmdk");
      await capture(png);
    } else if (state.inlineAI && state.inlineAI.length >= 2 && !capturedTags.has("aiInline")) {
      capturedTags.add("aiInline");
      await capture(png);
    } else if (browserLoaded && !capturedTags.has("browser")) {
      capturedTags.add("browser");
      await capture(png);
    } else if (state.autocomplete && !capturedTags.has("autocomplete")) {
      capturedTags.add("autocomplete");
      await capture(png);
    } else if (state.squiggles.length && !capturedTags.has("squiggle")) {
      capturedTags.add("squiggle");
      await capture(png);
    } else if (state.focus === "chat" && state.chat.length > 0 && !capturedTags.has("chat")) {
      capturedTags.add("chat");
      await capture(png);
    } else if (state.focus === "terminal" && !capturedTags.has("terminal")) {
      capturedTags.add("terminal");
      await capture(png);
    } else if (evenIdx.has(f) && !(state.app === "browser" && state.browser.loading)) {
      await capture(png);
    }

    const tSec = f / fps;
    if (tSec >= nextSampleTime) {
      nextSampleTime += CANDIDATE_INTERVAL;
      const thumb = await sharp(png).resize(THUMB, THUMB, { fit: "fill" }).removeAlpha().raw().toBuffer();
      const bi = Math.floor(tSec / bucketSize);
      while (buckets.length <= bi) buckets.push({ kept: 0, total: 0 });
      candidateFrames++;
      buckets[bi].total++;
      let keep = false;
      if (lastKeptThumb === null) keep = true;
      else if (pixelDiff(lastKeptThumb, thumb) >= DIFF_THRESHOLD) keep = true;
      else if (tSec - lastKeptTimeSec >= MAX_IDLE_SEC) keep = true;
      if (keep) {
        keptFrames++;
        buckets[bi].kept++;
        lastKeptThumb = thumb;
        lastKeptTimeSec = tSec;
      }
    }

    if (opts.onProgress && f % 200 === 0) opts.onProgress(f, totalFrames);
  }

  const outPath = path.join(opts.outDir, `${opts.variant}.webm`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      path.join(framesDir, "frame_%06d.png"),
      "-c:v",
      "libvpx",
      "-b:v",
      "700k",
      "-deadline",
      "good",
      "-cpu-used",
      "3",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      outPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-500)}`))
    );
  });

  const montagePath = path.join(opts.outDir, `${opts.variant}-montage.png`);
  await buildMontage(sampleFiles, montagePath);

  const stat = await fs.stat(outPath);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});

  return {
    variant: opts.variant,
    label: opts.label,
    path: outPath,
    sampleFrames: sampleFiles,
    montagePath,
    durationSeconds: targetSeconds,
    fps,
    totalFrames,
    width: W,
    height: H,
    sizeBytes: stat.size,
    featureFrames,
    analysis: {
      candidateFrames,
      keptFrames,
      keepRate: candidateFrames ? keptFrames / candidateFrames : 0,
      estimatedBatches: Math.ceil(keptFrames / 2),
      bucketKeepRates: buckets.map((b) => (b.total ? b.kept / b.total : 0)),
    },
  };
}

async function buildMontage(framePaths: string[], outPath: string): Promise<void> {
  if (framePaths.length === 0) return;
  const cols = 3;
  const rows = Math.ceil(framePaths.length / cols);
  const tileW = 412;
  const tileH = Math.round((tileW * H) / W);
  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < framePaths.length; i++) {
    const buf = await sharp(framePaths[i]).resize(tileW, tileH).toBuffer();
    composites.push({
      input: buf,
      left: (i % cols) * tileW,
      top: Math.floor(i / cols) * tileH,
    });
  }
  await sharp({
    create: {
      width: cols * tileW,
      height: rows * tileH,
      channels: 3,
      background: { r: 12, g: 12, b: 12 },
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);
}
