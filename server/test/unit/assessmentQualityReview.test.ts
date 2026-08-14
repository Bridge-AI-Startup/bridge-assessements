import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createChatCompletionWithStructuredOutput } = vi.hoisted(() => ({
  createChatCompletionWithStructuredOutput: vi.fn(),
}));

vi.mock("../../src/services/langchainAI.js", () => ({
  createChatCompletionWithStructuredOutput,
}));

import { generateAssessmentComponents } from "../../src/services/assessmentGeneration.js";
import {
  assessmentOutputSchema,
  assessmentReviewSchema,
  behavioralChecksOutputSchema,
  requirementsExtractionSchema,
  starterCodeGenerationSchema,
} from "../../src/services/schemas/assessmentGeneration.js";

const EMPTY_JSON_ERROR = new Error(
  "JSON parse failed: Unexpected end of json string at position 0. Snippet: "
);

const STEP1 = {
  summary: "Build a React UI for a music library intern take-home.",
  keySkills: ["React"],
  suggestedScope: "Frontend only",
  stack: "frontend-react" as const,
  level: "junior" as const,
  stackConfidence: "high" as const,
  levelConfidence: "high" as const,
};

function passingDescription(): string {
  const filler =
    "The candidate should keep the interface simple, use the starter files, and avoid paid APIs. ";
  return [
    "## Scenario",
    "You are building a music library for a small intern team that needs to browse and save tracks.",
    filler.repeat(3),
    "## What you will build",
    "A React single-page app with search, a track list, and a saved-library view.",
    filler.repeat(3),
    "## Requirements",
    "Search filters the list, saving a track keeps it after reload, and empty states are visible.",
    filler.repeat(3),
    "## Acceptance criteria",
    ...Array.from({ length: 10 }, (_, i) => `- [ ] Checklist item ${i + 1} is implemented and easy to verify.`),
    filler.repeat(2),
    "## Constraints",
    "No backend of your own. Use localStorage. Stay inside the starter files.",
    filler.repeat(3),
    "## Provided",
    "A Vite React starter with a blank App component and sample track JSON.",
    filler.repeat(3),
    "## Assumptions",
    "The candidate has Node installed and can run npm install and npm run dev.",
    filler.repeat(3),
    "## Deliverables",
    "Working source in the starter repo plus a short README of how to run it.",
    filler.repeat(3),
    "## Nice-to-have",
    "Keyboard shortcuts or a simple dark theme if time remains.",
    filler.repeat(3),
  ].join("\n");
}

const STEP2 = {
  title: "React Music Library",
  description: passingDescription(),
  timeLimit: 90,
};

const BEHAVIORAL = {
  checks: [
    "User can search tracks by title",
    "User can save a track to their library",
    "Saved tracks persist after reload",
    "Empty search results show a message",
    "User can remove a saved track",
  ],
};

beforeEach(() => {
  createChatCompletionWithStructuredOutput.mockReset();
  createChatCompletionWithStructuredOutput.mockImplementation(
    async (_useCase: string, _messages: unknown, schema: unknown, options?: { maxTokens?: number }) => {
      if (schema === requirementsExtractionSchema) {
        return { result: STEP1 };
      }
      if (schema === assessmentOutputSchema) {
        return { result: STEP2 };
      }
      if (schema === assessmentReviewSchema) {
        expect(options?.maxTokens).toBe(4000);
        throw EMPTY_JSON_ERROR;
      }
      if (schema === behavioralChecksOutputSchema) {
        return { result: BEHAVIORAL };
      }
      if (schema === starterCodeGenerationSchema) {
        return { result: { files: [] } };
      }
      throw new Error("unexpected structured-output schema");
    }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assessment quality review — empty JSON", () => {
  it("retries the review, then keeps the generated assessment instead of the stub", async () => {
    const result = await generateAssessmentComponents(
      "We're hiring a frontend intern proficient in React to build responsive user interfaces."
    );

    const reviewCalls = createChatCompletionWithStructuredOutput.mock.calls.filter(
      (call) => call[2] === assessmentReviewSchema
    );
    expect(reviewCalls).toHaveLength(3);
    expect(reviewCalls.every((call) => call[3]?.maxTokens === 4000)).toBe(true);

    expect(result.title).toBe("React Music Library");
    expect(result.description.trim()).toBe(STEP2.description.trim());
    expect(result.timeLimit).toBe(90);
    expect(result.description).not.toMatch(/Assessment generation could not be completed/);
    expect(result.behavioralChecks).toEqual(BEHAVIORAL.checks);
  }, 10_000);
});
