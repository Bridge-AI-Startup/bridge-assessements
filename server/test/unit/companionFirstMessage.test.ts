import { describe, expect, it } from "vitest";

import {
  buildCompanionFirstMessage,
  companionSetupPromptNotes,
  companionSetupSentences,
} from "../../src/services/companion/firstMessage.js";

describe("companionSetupSentences", () => {
  it("reminds both full-screen share and the Node command when both captures are on", () => {
    const sentences = companionSetupSentences({
      evidenceMode: "both",
      hasStarterZip: true,
      hasStarterRepo: false,
    });

    expect(sentences.join(" ")).toMatch(/entire screen/i);
    expect(sentences.join(" ")).toMatch(/not just a window or a tab/i);
    expect(sentences.join(" ")).toMatch(/unzip the starter files/i);
    expect(sentences.join(" ")).toMatch(/Node command shown on the page/i);
    expect(sentences.join(" ")).toMatch(/type agree/i);
    expect(sentences.join(" ")).not.toMatch(/capture-kit/);
    expect(sentences.join(" ")).not.toMatch(/https?:\/\//);
  });

  it("uses the GitHub starter when there is no zip", () => {
    const text = companionSetupSentences({
      evidenceMode: "both",
      hasStarterZip: false,
      hasStarterRepo: true,
    }).join(" ");

    expect(text).toMatch(/starter repository linked on the page/i);
    expect(text).not.toMatch(/unzip/i);
    expect(text).toMatch(/Node command/i);
  });

  it("still covers screen + command when there are no starter files", () => {
    const text = companionSetupSentences({
      evidenceMode: "both",
      hasStarterZip: false,
      hasStarterRepo: false,
    }).join(" ");

    expect(text).toMatch(/entire screen/i);
    expect(text).toMatch(/from your project folder/i);
    expect(text).toMatch(/Node command/i);
  });

  it("only mentions the screen and starter files for legacy screen mode", () => {
    const text = companionSetupSentences({
      evidenceMode: "screen",
      hasStarterZip: true,
      hasStarterRepo: false,
    }).join(" ");

    expect(text).toMatch(/entire screen/i);
    expect(text).toMatch(/unzip/i);
    expect(text).not.toMatch(/Node command/i);
  });

  it("only mentions the Node command and starter files for workflow-only", () => {
    const text = companionSetupSentences({
      evidenceMode: "workflow",
      hasStarterZip: true,
      hasStarterRepo: false,
    }).join(" ");

    expect(text).toMatch(/^To start, unzip/i);
    expect(text).toMatch(/Node command/i);
    expect(text).not.toMatch(/entire screen/i);
  });

  it("returns no setup sentences when nothing is captured and there are no starters", () => {
    expect(
      companionSetupSentences({
        evidenceMode: "none",
        hasStarterZip: false,
        hasStarterRepo: false,
      })
    ).toEqual([]);
  });
});

describe("buildCompanionFirstMessage", () => {
  it("keeps the greeting and ends with a ready cue", () => {
    const message = buildCompanionFirstMessage({
      evidenceMode: "both",
      hasStarterZip: true,
      hasStarterRepo: false,
    });

    expect(message).toMatch(/quick check-in/i);
    expect(message).toMatch(/won't give hints/i);
    expect(message).toMatch(/Ready when you are\.$/);
  });

  it("uses a short welcome-back on resume instead of repeating setup", () => {
    const message = buildCompanionFirstMessage({
      evidenceMode: "both",
      hasStarterZip: true,
      hasStarterRepo: false,
      isResume: true,
    });

    expect(message).toMatch(/Welcome back/i);
    expect(message).not.toMatch(/Node command/i);
    expect(message).not.toMatch(/entire screen/i);
  });
});

describe("companionSetupPromptNotes", () => {
  it("lists only the steps that apply and forbids reading the command aloud", () => {
    const notes = companionSetupPromptNotes({
      evidenceMode: "both",
      hasStarterZip: true,
      hasStarterRepo: false,
    });

    expect(notes).toMatch(/Share the entire screen/);
    expect(notes).toMatch(/starter-code\.zip/);
    expect(notes).toMatch(/Never read the command/);
    expect(notes).not.toMatch(/GitHub repo/);
  });

  it("is empty when there is nothing to recap", () => {
    expect(
      companionSetupPromptNotes({
        evidenceMode: "none",
        hasStarterZip: false,
        hasStarterRepo: false,
      })
    ).toBe("");
  });
});
