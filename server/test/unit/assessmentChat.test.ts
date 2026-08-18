import { describe, expect, it } from "vitest";

import {
  CHAT_EDITABLE_SECTIONS,
  normalizeChatResult,
  AssessmentChatError,
} from "../../src/services/assessmentChat.js";

describe("normalizeChatResult", () => {
  it("derives changedSections from what actually survived, not the model's list", () => {
    // The model routinely reports a section it did not populate. The editor
    // highlights off changedSections, so trusting that list flashes a section
    // nothing happened to.
    const result = normalizeChatResult({
      updates: { title: "Inventory Sync Service" },
      changedSections: ["title", "projectDescription", "testCases"],
      changesSummary: ["Renamed the assessment"],
      responseMessage: "Renamed it.",
    });

    expect(result.changedSections).toEqual(["title"]);
    expect(result.updates).toEqual({ title: "Inventory Sync Service" });
  });

  it("treats an answer-only turn as success with no changes", () => {
    const result = normalizeChatResult({
      updates: {},
      changedSections: [],
      changesSummary: [],
      responseMessage: "90 minutes is reasonable for this scope.",
    });

    expect(result.changedSections).toEqual([]);
    expect(result.changesSummary).toEqual([]);
    expect(result.responseMessage).toBe(
      "90 minutes is reasonable for this scope."
    );
  });

  it("drops updates outside the sections the employer pinned", () => {
    const result = normalizeChatResult(
      {
        updates: {
          description: "## New brief",
          timeLimit: 240,
        },
        changedSections: ["projectDescription", "timeLimit"],
        changesSummary: ["Rewrote the brief", "Raised the limit"],
        responseMessage: "Updated both.",
      },
      ["projectDescription"]
    );

    expect(result.updates).toEqual({ description: "## New brief" });
    expect(result.changedSections).toEqual(["projectDescription"]);
    expect(result.responseMessage).toContain("Time Limit");
  });

  it("cleans replacement list fields and drops empty entries", () => {
    const result = normalizeChatResult({
      updates: {
        behavioralChecks: ["  Creating a task adds it to the list  ", "", null, 7],
      },
      changedSections: [],
      changesSummary: [],
      responseMessage: "",
    });

    expect(result.updates.behavioralChecks).toEqual([
      "Creating a task adds it to the list",
    ]);
    expect(result.changedSections).toEqual(["behavioralChecks"]);
  });

  it("never wipes a grading list from an empty replacement array", () => {
    // These lists drive grading and the chat has no undo, so an accidental
    // `[]` from the model must not clear them.
    const result = normalizeChatResult({
      updates: { behavioralChecks: [], evaluationCriteria: ["", "   "] },
      changedSections: ["behavioralChecks", "evaluationCriteria"],
      changesSummary: ["Cleared checks"],
      responseMessage: "Cleared.",
    });

    expect(result.updates.behavioralChecks).toBeUndefined();
    expect(result.updates.evaluationCriteria).toBeUndefined();
    expect(result.changedSections).toEqual([]);
  });

  it("rejects a non-positive or non-numeric timeLimit", () => {
    const result = normalizeChatResult({
      updates: { timeLimit: "about two hours" },
      changedSections: ["timeLimit"],
      changesSummary: [],
      responseMessage: "Set it.",
    });

    expect(result.updates.timeLimit).toBeUndefined();
    expect(result.changedSections).toEqual([]);
  });

  it("synthesizes a reply when the model omits responseMessage", () => {
    const result = normalizeChatResult({
      updates: { description: "## Brief" },
      changedSections: ["projectDescription"],
      changesSummary: ["Tightened scope to one endpoint"],
    });

    expect(result.responseMessage).toContain("Tightened scope to one endpoint");
  });

  it("throws a readable error for a non-object payload", () => {
    expect(() => normalizeChatResult("not json")).toThrow(AssessmentChatError);
  });

  it("keeps the section id contract stable", () => {
    // These strings cross the wire in both directions and are mirrored in
    // client/src/components/assessment/sections.js.
    expect([...CHAT_EDITABLE_SECTIONS]).toEqual([
      "projectDescription",
      "title",
      "timeLimit",
      "behavioralChecks",
      "evaluationCriteria",
    ]);
  });
});
