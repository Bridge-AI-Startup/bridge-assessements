/**
 * Deterministic workflow metrics.
 *
 * These are computed by counting, not by asking a model. That matters for three
 * reasons: they are free, they are perfectly reproducible (the same session
 * always scores the same), and they give the LLM judge a factual floor so it can
 * spend its judgement on the genuinely interpretive calls instead of arithmetic
 * it is bad at.
 *
 * Nothing here is a score. They are inputs to scoring, and several are
 * deliberately two-sided — a high read:edit ratio can mean careful or can mean
 * stuck, and only the surrounding evidence says which.
 */

import type { WorkflowEventLike } from "./timeline.js";

const READ_TOOL = /^(Read|Glob|Grep|NotebookRead|WebFetch|WebSearch|LS)$/i;
const WRITE_TOOL = /^(Write|Edit|MultiEdit|NotebookEdit)$/i;
const TEST_COMMAND = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|jest|vitest)\b|\b(pytest|go test|cargo test|rspec|phpunit)\b|\bnpx\s+(jest|vitest|playwright)\b/i;

/** Prompts that delegate without adding information. */
const LOW_EFFORT_PROMPT =
  /^(y|yes|ok|okay|sure|go|go ahead|continue|proceed|do it|next|fix it|please|thanks|ty)\b[\s.!]*$/i;

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  total: number;
  /** Turns we actually saw usage numbers for — the rest are unmeasured, not zero. */
  measuredTurns: number;
}

export interface WorkflowMetrics {
  prompts: number;
  assistantReplies: number;
  toolCalls: number;
  reads: number;
  writes: number;
  testRuns: number;
  /**
   * Reads per write. High can mean "inspects before changing" or "lost";
   * low can mean "decisive" or "changing code they never looked at".
   */
  readEditRatio: number | null;
  /** Share of prompts that add no information beyond assent. */
  lowEffortPromptRatio: number | null;
  /** Median seconds between a reply and the candidate's next prompt. */
  medianThinkSeconds: number | null;
  /** Writes followed by a test run within the window — verification behaviour. */
  verifiedWriteRatio: number | null;
  timeToFirstPromptSeconds: number | null;
  activeSeconds: number;
  longestGapSeconds: number;
  tokens: TokenUsage;
  authorship: {
    agentFiles: number;
    humanFiles: number;
    agentBytes: number;
    humanBytes: number;
    /** Share of touched files whose contents came from the agent's own writes. */
    agentShare: number | null;
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Pull token counts out of whatever the source attached them to.
 * Claude Code carries them on the Stop event (read from its own transcript),
 * Codex emits `token_count` records; anything else stays unmeasured.
 */
export function extractTokenUsage(events: WorkflowEventLike[]): TokenUsage {
  const usage: TokenUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    total: 0,
    measuredTurns: 0,
  };
  for (const e of events) {
    const u = (e.payload as any)?.usage;
    if (!u || typeof u !== "object") continue;
    const input = Number(u.input_tokens ?? u.input ?? 0) || 0;
    const output = Number(u.output_tokens ?? u.output ?? 0) || 0;
    const cache =
      Number(u.cache_read_input_tokens ?? u.cached_input_tokens ?? u.cacheRead ?? 0) || 0;
    if (input === 0 && output === 0 && cache === 0) continue;
    usage.input += input;
    usage.output += output;
    usage.cacheRead += cache;
    usage.measuredTurns += 1;
  }
  usage.total = usage.input + usage.output;
  return usage;
}

export interface FileStateLike {
  path: string;
  sizeBytes?: number;
  origin?: "agent" | "snapshot";
}

export function computeMetrics(
  events: WorkflowEventLike[],
  files: FileStateLike[],
  options: { startedAt: Date | string; idleThresholdSeconds?: number }
): WorkflowMetrics {
  const startMs = new Date(options.startedAt).getTime();
  const idleThreshold = options.idleThresholdSeconds ?? 120;
  const sorted = [...events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  const prompts = sorted.filter((e) => e.type === "user_prompt");
  const replies = sorted.filter((e) => e.type === "assistant_message");
  const toolCalls = sorted.filter((e) => e.type === "tool_use");
  const reads = toolCalls.filter((e) => READ_TOOL.test(String(e.toolName || "")));
  const writes = toolCalls.filter((e) => WRITE_TOOL.test(String(e.toolName || "")));
  const testRuns = sorted.filter(
    (e) =>
      (e.type === "tool_use" || e.type === "tool_result") &&
      TEST_COMMAND.test(String(e.text || ""))
  );

  // Think time: reply → next prompt. Median, because one lunch break should not
  // make a candidate look thoughtful.
  const thinkGaps: number[] = [];
  for (const reply of replies) {
    const replyMs = new Date(reply.at).getTime();
    const nextPrompt = prompts.find((p) => new Date(p.at).getTime() > replyMs);
    if (!nextPrompt) continue;
    const gap = (new Date(nextPrompt.at).getTime() - replyMs) / 1000;
    if (gap >= 0 && gap < 3600) thinkGaps.push(gap);
  }

  // A write counts as verified if a test ran within 5 minutes after it.
  const VERIFY_WINDOW_MS = 5 * 60 * 1000;
  let verifiedWrites = 0;
  for (const w of writes) {
    const wMs = new Date(w.at).getTime();
    const verified = testRuns.some((t) => {
      const tMs = new Date(t.at).getTime();
      return tMs > wMs && tMs - wMs <= VERIFY_WINDOW_MS;
    });
    if (verified) verifiedWrites++;
  }

  let longestGap = 0;
  let activeSeconds = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      (new Date(sorted[i].at).getTime() - new Date(sorted[i - 1].at).getTime()) / 1000;
    if (gap > longestGap) longestGap = gap;
    if (gap < idleThreshold) activeSeconds += gap;
  }

  const lowEffort = prompts.filter((p) =>
    LOW_EFFORT_PROMPT.test(String(p.text || "").trim())
  ).length;

  const agentFiles = files.filter((f) => f.origin === "agent");
  const humanFiles = files.filter((f) => f.origin !== "agent");
  const agentBytes = agentFiles.reduce((n, f) => n + (f.sizeBytes || 0), 0);
  const humanBytes = humanFiles.reduce((n, f) => n + (f.sizeBytes || 0), 0);

  return {
    prompts: prompts.length,
    assistantReplies: replies.length,
    toolCalls: toolCalls.length,
    reads: reads.length,
    writes: writes.length,
    testRuns: testRuns.length,
    readEditRatio: writes.length > 0 ? Number((reads.length / writes.length).toFixed(2)) : null,
    lowEffortPromptRatio:
      prompts.length > 0 ? Number((lowEffort / prompts.length).toFixed(2)) : null,
    medianThinkSeconds: median(thinkGaps),
    verifiedWriteRatio:
      writes.length > 0 ? Number((verifiedWrites / writes.length).toFixed(2)) : null,
    timeToFirstPromptSeconds: prompts.length
      ? Number(((new Date(prompts[0].at).getTime() - startMs) / 1000).toFixed(1))
      : null,
    activeSeconds: Math.round(activeSeconds),
    longestGapSeconds: Math.round(longestGap),
    tokens: extractTokenUsage(sorted),
    authorship: {
      agentFiles: agentFiles.length,
      humanFiles: humanFiles.length,
      agentBytes,
      humanBytes,
      agentShare:
        files.length > 0 ? Number((agentFiles.length / files.length).toFixed(2)) : null,
    },
  };
}
