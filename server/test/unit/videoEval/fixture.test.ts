import { describe, expect, it } from "vitest";

import {
  CODING_VIDEO_SPEC,
  buildCodingStates,
  renderStateSvg,
} from "../../video-eval/codingVideoFixture.js";

describe("buildCodingStates", () => {
  const states = buildCodingStates();

  it("is deterministic", () => {
    expect(JSON.stringify(buildCodingStates())).toBe(JSON.stringify(states));
  });

  it("produces enough distinct states for a multi-minute screencast", () => {
    // At ~6s/state this comfortably exceeds 3 minutes.
    expect(states.length).toBeGreaterThanOrEqual(30);
  });

  it("shows incremental coding (editor grows over time)", () => {
    const editorStates = states.filter((s) => s.file === "primes.py");
    const firstLen = editorStates[0].editorLines.join("\n").length;
    const grown = editorStates.some(
      (s) => s.editorLines.join("\n").length > firstLen
    );
    expect(grown).toBe(true);
  });

  it("includes a terminal that runs pytest with a failure then a pass", () => {
    const term = states.flatMap((s) => s.terminalLines).join("\n");
    expect(term).toContain("pytest");
    expect(term.toLowerCase()).toContain("failed");
    expect(term.toLowerCase()).toContain("passed");
  });

  it("never shows an AI assistant / chat panel (negative control)", () => {
    const all = states
      .flatMap((s) => [...s.editorLines, ...s.terminalLines, s.caption])
      .join("\n")
      .toLowerCase();
    for (const tool of ["cursor", "copilot", "chatgpt", "claude", "ai chat", "assistant"]) {
      expect(all).not.toContain(tool);
    }
  });

  it("contains every expected OCR token somewhere on screen", () => {
    const all = states
      .flatMap((s) => [...s.editorLines, ...s.terminalLines])
      .join("\n")
      .toLowerCase();
    for (const tok of CODING_VIDEO_SPEC.expectedTokens) {
      expect(all).toContain(tok.toLowerCase());
    }
  });

  it("ground-truth behaviors match the authored content", () => {
    expect(CODING_VIDEO_SPEC.behaviors.incrementalCoding).toBe(true);
    expect(CODING_VIDEO_SPEC.behaviors.runsTests).toBe(true);
    expect(CODING_VIDEO_SPEC.behaviors.usesAiAssistant).toBe(false);
  });
});

describe("renderStateSvg", () => {
  const states = buildCodingStates();

  it("renders valid-looking SVG with the code text and filename", () => {
    const svg = renderStateSvg(states[5], 5, states.length, 1280, 720);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("is_prime");
    expect(svg).toContain("primes.py");
    expect(svg).toContain('width="1280"');
  });

  it("escapes XML-sensitive characters in code", () => {
    const svg = renderStateSvg(
      { file: "x.py", editorLines: ["if i * i <= n & 1:"], terminalLines: [], caption: "c" },
      0,
      1,
      800,
      600
    );
    expect(svg).toContain("&lt;=");
    expect(svg).toContain("&amp;");
    expect(svg).not.toContain("<= n & 1"); // raw unescaped form must not appear
  });
});
