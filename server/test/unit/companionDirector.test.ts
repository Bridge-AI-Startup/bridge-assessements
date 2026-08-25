import { describe, expect, it } from "vitest";
import {
  parseDirectorDecision,
  buildDirectorUserMessage,
} from "../../src/services/companion/directorModel.js";

describe("parseDirectorDecision", () => {
  it("parses a plain speak decision", () => {
    const d = parseDirectorDecision(
      '{"shouldSpeak": true, "question": "What made you re-run that test three times?", "anchorSummary": "repeated npm test runs", "reason": "surprise: repetition"}'
    );
    expect(d).toEqual({
      shouldSpeak: true,
      question: "What made you re-run that test three times?",
      anchorSummary: "repeated npm test runs",
      reason: "surprise: repetition",
    });
  });

  it("parses a stay-quiet decision without a question", () => {
    const d = parseDirectorDecision('{"shouldSpeak": false, "reason": "setup"}');
    expect(d).toEqual({
      shouldSpeak: false,
      question: undefined,
      anchorSummary: undefined,
      reason: "setup",
    });
  });

  it("strips code fences and surrounding prose", () => {
    const d = parseDirectorDecision(
      'Here is my decision:\n```json\n{"shouldSpeak": false, "reason": "quiet"}\n```'
    );
    expect(d?.shouldSpeak).toBe(false);
    expect(d?.reason).toBe("quiet");
  });

  it("rejects a speak decision with no question", () => {
    expect(
      parseDirectorDecision('{"shouldSpeak": true, "reason": "oops"}')
    ).toBeNull();
    expect(
      parseDirectorDecision('{"shouldSpeak": true, "question": "  "}')
    ).toBeNull();
  });

  it("rejects non-JSON and wrong shapes", () => {
    expect(parseDirectorDecision("I think we should ask about tests.")).toBeNull();
    expect(parseDirectorDecision('{"question": "hm?"}')).toBeNull();
    expect(parseDirectorDecision("")).toBeNull();
  });
});

describe("buildDirectorUserMessage", () => {
  it("serializes context, voice tail, and briefing state as JSON", () => {
    const msg = buildDirectorUserMessage({
      contextBundle: { timeline: { available: true } },
      voiceTail: [
        { role: "candidate", text: "starting the backend first", timestampMs: 1000 },
      ],
      pendingBriefing: {
        briefingId: "abc",
        question: "Why backend first?",
        deliveredAt: null,
      },
      briefingHistory: [
        {
          briefingId: "old",
          question: "How will you test it?",
          deliveredAt: new Date(0),
          outcome: "delivered",
        },
      ],
      elapsedMinutes: 12,
      minutesSinceLastDelivered: 6,
    });
    const parsed = JSON.parse(msg);
    expect(parsed.elapsedMinutes).toBe(12);
    expect(parsed.pendingBriefing.question).toBe("Why backend first?");
    expect(parsed.pendingBriefing.delivered).toBe(false);
    expect(parsed.briefingHistory[0].outcome).toBe("delivered");
    expect(parsed.briefingHistory[0].delivered).toBe(true);
    expect(parsed.voiceTranscript[0].text).toBe("starting the backend first");
    expect(parsed.context.timeline.available).toBe(true);
  });

  it("truncates long voice lines and caps the tail at 40", () => {
    const long = "x".repeat(1000);
    const tail = Array.from({ length: 50 }, (_, i) => ({
      role: "candidate",
      text: long,
      timestampMs: i,
    }));
    const parsed = JSON.parse(
      buildDirectorUserMessage({
        contextBundle: {},
        voiceTail: tail,
        pendingBriefing: null,
        briefingHistory: [],
        elapsedMinutes: null,
        minutesSinceLastDelivered: null,
      })
    );
    expect(parsed.voiceTranscript).toHaveLength(40);
    expect(parsed.voiceTranscript[0].text.length).toBeLessThanOrEqual(401);
  });
});
