import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the LLM layer so we can simulate truncated vs complete responses.
const { createChatCompletion } = vi.hoisted(() => ({
  createChatCompletion: vi.fn(),
}));

vi.mock("../../src/services/langchainAI.js", () => ({
  createChatCompletion,
}));

import { evaluateCriterion } from "../../src/services/evaluation/evaluator.js";
import type { TranscriptEvent } from "../../src/types/evaluation.js";

const CRITERION = "The candidate verifies their work by running tests.";

const transcript: TranscriptEvent[] = [
  {
    ts: 0,
    ts_end: 5,
    behavioral_summary: "Runs pytest in the terminal and reads the output.",
    intent: "testing",
    ai_tool: null,
  } as any,
];

// A response truncated right after the evidence array — the exact failure mode
// observed on long transcripts (score/confidence/verdict never get written).
const TRUNCATED = `{
  "criterion": "${CRITERION}",
  "evidence": [{ "ts": 0, "ts_end": 5, "observation": "Runs pytest in the terminal" }]`;

const COMPLETE = JSON.stringify({
  criterion: CRITERION,
  evidence: [{ ts: 0, ts_end: 5, observation: "Runs pytest, sees a failure, fixes it" }],
  score: 8,
  confidence: "high",
  verdict: "Candidate repeatedly runs pytest and reacts to failures.",
});

beforeEach(() => createChatCompletion.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("evaluator — truncation retry", () => {
  it("retries once when the first response is truncated, then succeeds", async () => {
    createChatCompletion
      .mockResolvedValueOnce({ content: TRUNCATED })
      .mockResolvedValueOnce({ content: COMPLETE });

    const result = await evaluateCriterion(CRITERION, transcript);

    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.evaluable).toBe(true);
    expect(result.score).toBe(8);
    expect(result.confidence).toBe("high");
    expect(result.verdict).not.toMatch(/did not return required fields/i);
  });

  it("does not retry when the first response is already complete", async () => {
    createChatCompletion.mockResolvedValueOnce({ content: COMPLETE });

    const result = await evaluateCriterion(CRITERION, transcript);

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.evaluable).toBe(true);
    expect(result.score).toBe(8);
  });

  it("falls back gracefully (no crash) when both attempts are truncated", async () => {
    createChatCompletion
      .mockResolvedValueOnce({ content: TRUNCATED })
      .mockResolvedValueOnce({ content: TRUNCATED });

    const result = await evaluateCriterion(CRITERION, transcript);

    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.evaluable).toBe(false);
    expect(result.score).toBe(1);
    expect(result.verdict).toMatch(/did not return required fields/i);
    // Best-effort evidence from the truncated attempt is still preserved.
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("uses a 4096-token budget so long transcripts are not truncated", async () => {
    createChatCompletion.mockResolvedValueOnce({ content: COMPLETE });
    await evaluateCriterion(CRITERION, transcript);
    const opts = createChatCompletion.mock.calls[0][2];
    expect(opts.maxTokens).toBe(4096);
    expect(opts.responseFormat).toEqual({ type: "json_object" });
  });
});
