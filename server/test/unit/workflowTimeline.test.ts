import { describe, it, expect } from "vitest";
import {
  buildTranscriptEvents,
  actionTypeFor,
  videoOffsetForSessionSeconds,
} from "../../src/services/workflowCapture/timeline.js";
import { computeMetrics, extractTokenUsage } from "../../src/services/workflowCapture/metrics.js";
import {
  findSilentWindows,
  planClassificationWindows,
} from "../../src/services/workflowCapture/screenContext.js";

const T0 = new Date("2026-08-12T10:00:00Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

describe("actionTypeFor", () => {
  it("maps tools to the evaluation vocabulary", () => {
    expect(actionTypeFor({ at: at(0), type: "user_prompt" })).toBe("ai_prompt");
    expect(actionTypeFor({ at: at(0), type: "assistant_message" })).toBe("ai_response");
    expect(actionTypeFor({ at: at(0), type: "tool_use", toolName: "Read" })).toBe("reading");
    expect(actionTypeFor({ at: at(0), type: "tool_use", toolName: "Write" })).toBe("coding");
  });

  it("treats a test command as verification, not coding", () => {
    expect(
      actionTypeFor({ at: at(0), type: "tool_use", toolName: "Bash", text: "npm test" })
    ).toBe("testing");
    expect(
      actionTypeFor({ at: at(0), type: "tool_use", toolName: "Bash", text: "pytest -q" })
    ).toBe("testing");
    // running the app is verification too
    expect(
      actionTypeFor({ at: at(0), type: "tool_use", toolName: "Bash", text: "npm run dev" })
    ).toBe("testing");
    // but an arbitrary command is not
    expect(
      actionTypeFor({ at: at(0), type: "tool_use", toolName: "Bash", text: "ls -la" })
    ).toBe("coding");
  });

  it("maps screen labels onto the same vocabulary", () => {
    const screen = (label: string) => ({
      at: at(0),
      type: "screen_context",
      payload: { label },
    });
    expect(actionTypeFor(screen("browser:search"))).toBe("searching");
    expect(actionTypeFor(screen("browser:docs"))).toBe("reading");
    expect(actionTypeFor(screen("browser:own_app"))).toBe("testing");
    expect(actionTypeFor(screen("browser:ai_chat"))).toBe("ai_prompt");
  });
});

describe("buildTranscriptEvents", () => {
  it("emits session-relative seconds and preserves prompt text", () => {
    const out = buildTranscriptEvents(
      [
        { at: at(10), type: "user_prompt", text: "explain the failure first" },
        { at: at(25), type: "assistant_message", text: "it caches" },
      ],
      { startedAt: T0 }
    );
    expect(out[0].ts).toBe(10);
    expect(out[0].action_type).toBe("ai_prompt");
    expect(out[0].prompt_text).toBe("explain the failure first");
    expect(out[1].ts).toBe(25);
    expect(out[1].prompt_text).toBeNull();
  });

  it("inserts an explicit idle event for long silences", () => {
    const out = buildTranscriptEvents(
      [
        { at: at(0), type: "user_prompt", text: "start" },
        { at: at(600), type: "user_prompt", text: "back" },
      ],
      { startedAt: T0, idleThresholdSeconds: 120 }
    );
    const idle = out.find((e) => e.action_type === "idle");
    expect(idle).toBeDefined();
    // a gap a judge cannot cite is a gap that does not exist
    expect(idle!.ts_end - idle!.ts).toBeGreaterThan(500);
  });

  it("orders events by time regardless of input order", () => {
    const out = buildTranscriptEvents(
      [
        { at: at(50), type: "user_prompt", text: "second" },
        { at: at(5), type: "user_prompt", text: "first" },
      ],
      { startedAt: T0 }
    );
    expect(out.map((e) => e.prompt_text)).toEqual(["first", "second"]);
  });
});

describe("videoOffsetForSessionSeconds", () => {
  const segments = [
    { wallStartedAt: at(0), wallEndedAt: at(30), videoOffsetStart: 0 },
    { wallStartedAt: at(90), wallEndedAt: at(120), videoOffsetStart: 30 },
  ];

  it("maps a citation into the recording across a resume gap", () => {
    expect(videoOffsetForSessionSeconds(10, T0, segments)).toBe(10);
    // 95s wall = 5s into the second segment = 35s of video, NOT 95
    expect(videoOffsetForSessionSeconds(95, T0, segments)).toBe(35);
  });

  it("returns null for moments with no footage", () => {
    expect(videoOffsetForSessionSeconds(60, T0, segments)).toBeNull();
    expect(videoOffsetForSessionSeconds(500, T0, segments)).toBeNull();
    expect(videoOffsetForSessionSeconds(10, T0, [])).toBeNull();
  });
});

describe("findSilentWindows", () => {
  it("finds the gap between events", () => {
    // segment ends just after the last event, so there is no trailing silence
    const tight = [{ wallStartedAt: at(0), wallEndedAt: at(320), videoOffsetStart: 0 }];
    const windows = findSilentWindows([at(0), at(10), at(300), at(310)], tight, {
      minGapSeconds: 45,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].videoStart).toBe(10);
    expect(windows[0].videoEnd).toBe(300);
  });

  it("also covers silence before the first event and after the last", () => {
    // recording ran 0-1000 but nothing was captured until 500 — that leading
    // silence is exactly the "what were they doing" case worth classifying
    const wide = [{ wallStartedAt: at(0), wallEndedAt: at(1000), videoOffsetStart: 0 }];
    const windows = findSilentWindows([at(500), at(505)], wide, { minGapSeconds: 45 });
    expect(windows.some((w) => w.videoStart === 0)).toBe(true);
    expect(windows.some((w) => w.videoEnd === 1000)).toBe(true);
  });

  it("returns nothing when there is no recording to look at", () => {
    expect(findSilentWindows([at(0), at(300)], [], { minGapSeconds: 45 })).toEqual([]);
    expect(findSilentWindows([at(0), at(300)], null, { minGapSeconds: 45 })).toEqual([]);
  });

  it("never produces a window spanning a recording break", () => {
    const broken = [
      { wallStartedAt: at(0), wallEndedAt: at(100), videoOffsetStart: 0 },
      { wallStartedAt: at(500), wallEndedAt: at(600), videoOffsetStart: 100 },
    ];
    const windows = findSilentWindows([at(50), at(550)], broken, { minGapSeconds: 45 });
    // every window must lie wholly inside one segment
    for (const w of windows) {
      const firstSeg = w.startMs <= at(100).getTime() && w.endMs <= at(100).getTime();
      const secondSeg = w.startMs >= at(500).getTime();
      expect(firstSeg || secondSeg).toBe(true);
    }
  });
});

describe("planClassificationWindows (tiered sweep)", () => {
  const segments = [{ wallStartedAt: at(0), wallEndedAt: at(1000), videoOffsetStart: 0 }];

  it("covers active periods as well as gaps, at the same sampling rate", () => {
    // dense activity 0-190s, silence 190-600s, dense again 600-790s.
    // Segment ends at 800 so there is no trailing silence to complicate it.
    const tight = [{ wallStartedAt: at(0), wallEndedAt: at(800), videoOffsetStart: 0 }];
    const times = [
      ...Array.from({ length: 20 }, (_, i) => at(i * 10)),
      ...Array.from({ length: 20 }, (_, i) => at(600 + i * 10)),
    ];
    const windows = planClassificationWindows(times, tight, { minGapSeconds: 45 });
    const gaps = windows.filter((w) => w.mode === "gap");
    const active = windows.filter((w) => w.mode === "active");

    expect(gaps).toHaveLength(1);
    expect(gaps[0].videoStart).toBe(190);
    // the whole session is covered, not only the silence
    expect(active.length).toBeGreaterThan(0);
    // Sampling is uniform: undersampling hook-active stretches is what made
    // brief switches (flicking to the running app) disappear. The gap/active
    // distinction survives only in what is kept as grading evidence.
    expect(active[0].fps).toBe(gaps[0].fps);
    expect(gaps[0].fps).toBeGreaterThanOrEqual(0.5);
  });

  it("skips only true slivers, not ordinary short stretches", () => {
    // a 2-second run between two long gaps is not worth its own request
    const tight = [{ wallStartedAt: at(0), wallEndedAt: at(700), videoOffsetStart: 0 }];
    const windows = planClassificationWindows([at(300), at(302)], tight, {
      minGapSeconds: 45,
    });
    expect(windows.filter((w) => w.mode === "active")).toHaveLength(0);
    // but the surrounding silence is still covered
    expect(windows.filter((w) => w.mode === "gap").length).toBeGreaterThan(0);
  });

  it("always classifies a recorded segment, even a very short one", () => {
    // A 29-second recording with three events packed into six seconds produced
    // NO windows under the old 60s minimum — every short test run came back
    // with an empty band. Recorded footage must always be described.
    const short = [{ wallStartedAt: at(0), wallEndedAt: at(29), videoOffsetStart: 0 }];
    const windows = planClassificationWindows([at(10), at(13), at(16)], short, {
      minGapSeconds: 45,
    });
    expect(windows.length).toBeGreaterThan(0);
    const covered = windows.reduce((n, w) => n + (w.videoEnd - w.videoStart), 0);
    expect(covered).toBeGreaterThan(20); // essentially the whole clip
  });

  it("never lets a window straddle a recording break", () => {
    const broken = [
      { wallStartedAt: at(0), wallEndedAt: at(100), videoOffsetStart: 0 },
      { wallStartedAt: at(500), wallEndedAt: at(900), videoOffsetStart: 100 },
    ];
    const windows = planClassificationWindows([at(10), at(600)], broken, {
      minGapSeconds: 45,
    });
    for (const w of windows) {
      const inFirst = w.startMs <= at(100).getTime();
      const endInFirst = w.endMs <= at(100).getTime();
      expect(inFirst).toBe(endInFirst); // both ends in the same segment
    }
  });

  it("splits an over-long stretch into multiple requests", () => {
    const long = [{ wallStartedAt: at(0), wallEndedAt: at(5000), videoOffsetStart: 0 }];
    // one event at the start, then four thousand seconds of silence
    const windows = planClassificationWindows([at(0), at(4900)], long, {
      minGapSeconds: 45,
    });
    expect(windows.length).toBeGreaterThan(1);
    for (const w of windows) {
      expect(w.videoEnd - w.videoStart).toBeLessThanOrEqual(600);
    }
  });

  it("findSilentWindows returns gaps only, never active windows", () => {
    const times = [at(0), at(10), at(300), at(310)];
    const windows = findSilentWindows(times, segments, { minGapSeconds: 45 });
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((w) => w.mode === "gap")).toBe(true);
  });
});

describe("computeMetrics", () => {
  const events = [
    { at: at(0), type: "user_prompt", text: "Read the failing tests and explain the root cause" },
    { at: at(5), type: "tool_use", toolName: "Read", text: "src/summary.js" },
    { at: at(10), type: "tool_use", toolName: "Read", text: "src/summary.test.js" },
    { at: at(20), type: "tool_use", toolName: "Bash", text: "npm test" },
    { at: at(30), type: "assistant_message", text: "the summary object is cached", payload: { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900 } } },
    { at: at(60), type: "user_prompt", text: "right, make it recompute each call" },
    { at: at(70), type: "tool_use", toolName: "Write", text: "src/summary.js (6 lines)" },
    { at: at(90), type: "tool_use", toolName: "Bash", text: "npm test" },
    { at: at(100), type: "assistant_message", text: "9/9 pass", payload: { usage: { input_tokens: 200, output_tokens: 80 } } },
  ];
  const files = [
    { path: "src/summary.js", sizeBytes: 180, origin: "agent" as const },
    { path: "src/manual.js", sizeBytes: 40, origin: "snapshot" as const },
  ];

  it("counts actions and derives the read:edit ratio", () => {
    const m = computeMetrics(events, files, { startedAt: T0 });
    expect(m.prompts).toBe(2);
    expect(m.reads).toBe(2);
    expect(m.writes).toBe(1);
    expect(m.readEditRatio).toBe(2);
  });

  it("credits a write that was followed by a test run", () => {
    const m = computeMetrics(events, files, { startedAt: T0 });
    expect(m.verifiedWriteRatio).toBe(1);
  });

  it("does not credit a write with no test after it", () => {
    // Compare by time, not object identity — `at(90) === at(90)` is false.
    const unverified = events.filter(
      (e) => !(e.type === "tool_use" && e.text === "npm test" && e.at.getTime() === at(90).getTime())
    );
    const m = computeMetrics(unverified as any, files, { startedAt: T0 });
    expect(m.verifiedWriteRatio).toBe(0);
  });

  it("sums token usage across turns and counts measured turns", () => {
    const m = computeMetrics(events, files, { startedAt: T0 });
    expect(m.tokens.input).toBe(300);
    expect(m.tokens.output).toBe(130);
    expect(m.tokens.cacheRead).toBe(900);
    expect(m.tokens.total).toBe(430);
    expect(m.tokens.measuredTurns).toBe(2);
  });

  it("separates agent-written from hand-written files", () => {
    const m = computeMetrics(events, files, { startedAt: T0 });
    expect(m.authorship.agentFiles).toBe(1);
    expect(m.authorship.humanFiles).toBe(1);
    expect(m.authorship.agentShare).toBe(0.5);
  });

  it("flags prompts that only say yes", () => {
    const lazy = [
      { at: at(0), type: "user_prompt", text: "build the whole app" },
      { at: at(10), type: "user_prompt", text: "yes" },
      { at: at(20), type: "user_prompt", text: "continue" },
      { at: at(30), type: "user_prompt", text: "ok" },
    ];
    const m = computeMetrics(lazy, [], { startedAt: T0 });
    expect(m.lowEffortPromptRatio).toBe(0.75);
  });

  it("reports unmeasured tokens as zero turns rather than zero usage", () => {
    const usage = extractTokenUsage([{ at: at(0), type: "assistant_message", text: "hi" }]);
    expect(usage.measuredTurns).toBe(0);
    expect(usage.total).toBe(0);
  });
});
