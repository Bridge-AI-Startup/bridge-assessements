import { describe, expect, it } from "vitest";

import {
  buildCompanionFirstMessage,
  companionSetupPromptNotes,
  companionSetupSentences,
  companionTitleSentence,
} from "../../src/services/companion/firstMessage.js";

describe("companionSetupSentences", () => {
  it("walks through unzip and the Node command, and only reminds them to keep sharing", () => {
    const sentences = companionSetupSentences({
      evidenceMode: "both",
      hasStarterZip: true,
      hasStarterRepo: false,
    });
    const text = sentences.join(" ");

    expect(text).toMatch(/unzip the starter files/i);
    expect(text).toMatch(/Node command shown on the page/i);
    expect(text).toMatch(/type agree/i);
    expect(text).toMatch(/Keep sharing your entire screen/i);
    expect(text).not.toMatch(/make sure you shared/i);
    expect(text).not.toMatch(/not just a window or a tab/i);
    expect(text).not.toMatch(/capture-kit/);
    expect(text).not.toMatch(/https?:\/\//);
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

  it("still covers the command and keep-sharing when there are no starter files", () => {
    const text = companionSetupSentences({
      evidenceMode: "both",
      hasStarterZip: false,
      hasStarterRepo: false,
    }).join(" ");

    expect(text).toMatch(/from your project folder/i);
    expect(text).toMatch(/Node command/i);
    expect(text).toMatch(/Keep sharing your entire screen/i);
    expect(text).not.toMatch(/make sure you shared/i);
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

describe("companionTitleSentence", () => {
  it("names the title and points at the page", () => {
    expect(companionTitleSentence("Build a Ticket Queue")).toMatch(
      /You're working on Build a Ticket Queue\. The assignment is on the page/
    );
  });

  it("strips URLs so a title cannot leak a link", () => {
    const sentence = companionTitleSentence("API at https://secret.example/token");
    expect(sentence).toMatch(/You're working on API at/);
    expect(sentence).not.toMatch(/https?:\/\//);
  });

  it("returns null when there is no title", () => {
    expect(companionTitleSentence(null)).toBeNull();
    expect(companionTitleSentence("")).toBeNull();
    expect(companionTitleSentence("   ")).toBeNull();
  });
});

describe("buildCompanionFirstMessage", () => {
  it("greets, names the title, and walks through post-start setup on a fresh start", () => {
    const message = buildCompanionFirstMessage({
      evidenceMode: "both",
      hasStarterZip: true,
      hasStarterRepo: false,
      title: "Build a Ticket Queue",
    });

    expect(message).toMatch(/quick check-in/i);
    expect(message).toMatch(/won't give hints/i);
    expect(message).toMatch(/Build a Ticket Queue/);
    expect(message).toMatch(/assignment is on the page/i);
    expect(message).toMatch(/unzip the starter files/i);
    expect(message).toMatch(/Node command shown on the page/i);
    expect(message).toMatch(/type agree/i);
    expect(message).toMatch(/Keep sharing your entire screen/i);
    expect(message).not.toMatch(/make sure you shared/i);
    expect(message).not.toMatch(/capture-kit/);
    expect(message).not.toMatch(/https?:\/\//);
    expect(message).not.toMatch(/Ready when you are/);
  });

  it("uses a short welcome-back on resume instead of repeating setup or the title", () => {
    const message = buildCompanionFirstMessage({
      evidenceMode: "both",
      hasStarterZip: true,
      hasStarterRepo: false,
      title: "Build a Ticket Queue",
      isResume: true,
    });

    expect(message).toMatch(/Welcome back/i);
    expect(message).not.toMatch(/Node command/i);
    expect(message).not.toMatch(/unzip/i);
    expect(message).not.toMatch(/entire screen/i);
    expect(message).not.toMatch(/Build a Ticket Queue/);
  });

  it("ends with a ready cue when there is no setup to walk through", () => {
    const message = buildCompanionFirstMessage({
      evidenceMode: "none",
      hasStarterZip: false,
      hasStarterRepo: false,
    });

    expect(message).toMatch(/quick check-in/i);
    expect(message).toMatch(/Ready when you are\.$/);
    expect(message).not.toMatch(/unzip/i);
    expect(message).not.toMatch(/Node command/i);
  });
});

describe("companionSetupPromptNotes", () => {
  it("lists post-start steps and forbids reading the command aloud", () => {
    const notes = companionSetupPromptNotes({
      evidenceMode: "both",
      hasStarterZip: true,
      hasStarterRepo: false,
    });

    expect(notes).toMatch(/Post-start setup/);
    expect(notes).toMatch(/already shared their entire screen/i);
    expect(notes).toMatch(/starter-code\.zip/);
    expect(notes).toMatch(/Never read the command/);
    expect(notes).toMatch(/reshare their entire screen/);
    expect(notes).toMatch(/cannot continue without sharing/);
    expect(notes).not.toMatch(/They completed this on-screen/);
    expect(notes).not.toMatch(/GitHub repo/);
  });

  it("does not mention reshare when the screen is not recorded", () => {
    const notes = companionSetupPromptNotes({
      evidenceMode: "workflow",
      hasStarterZip: true,
      hasStarterRepo: false,
    });

    expect(notes).toMatch(/starter-code\.zip/);
    expect(notes).not.toMatch(/reshare/);
    expect(notes).not.toMatch(/cannot continue without sharing/);
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
