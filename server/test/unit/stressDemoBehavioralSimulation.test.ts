import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEMO_ASSESSMENT_ID = "6a30cb825c1e8969b7c21110";
const SUBMISSION_ID = "507f1f77bcf86cd799439011";

const DEMO_CHECKS = [
  "Token bucket enforces the per-destination rate limit",
  "Backoff is capped at max_delay and uses full jitter",
  "Dispatcher bounds concurrent in-flight deliveries with an asyncio semaphore",
  "POST /webhooks enqueues a webhook and returns id plus queued status",
  "GET /webhooks/{id} returns 404 for unknown webhook ids",
  "Failed deliveries retry with exponential backoff until max_attempts is reached",
  "All pytest tests pass when run from the project root",
  "README documents install, test, and uvicorn start commands",
];

const progressWrites: unknown[] = [];
const statusWrites: Array<{ status?: string; report?: unknown; progress?: unknown }> =
  [];

const mockStoreText = vi.fn(async () => undefined);

const mockSubmission = {
  _id: SUBMISSION_ID,
  candidateName: "Steady writer",
  candidateEmail: "steady@stress.bridgeai-demo.com",
  assessmentId: {
    _id: { toString: () => DEMO_ASSESSMENT_ID },
    title: "Resilient Webhook Dispatcher — Live Coding Sessions",
    behavioralChecks: DEMO_CHECKS,
  },
};

vi.mock("../../src/models/assessment.js", () => ({
  default: {
    findById: vi.fn(async () => mockSubmission.assessmentId),
  },
}));

vi.mock("../../src/models/submission.js", () => ({
  default: {
    findById: vi.fn(() => ({
      populate: vi.fn(async () => mockSubmission),
    })),
    findByIdAndUpdate: vi.fn(async (_id: string, update: Record<string, unknown>) => {
      if (update.$set && "behavioralGradingProgress" in (update.$set as object)) {
        progressWrites.push((update.$set as { behavioralGradingProgress: unknown })
          .behavioralGradingProgress);
      }
      if (update.$unset && "behavioralGradingProgress" in update.$unset) {
        progressWrites.push(null);
      }
      if (update.$set && "behavioralGradingStatus" in (update.$set as object)) {
        statusWrites.push({
          status: (update.$set as { behavioralGradingStatus: string })
            .behavioralGradingStatus,
          report: (update.$set as { behavioralGradingReport?: unknown })
            .behavioralGradingReport,
        });
      }
      return {};
    }),
  },
}));

vi.mock("../../src/services/gradingEvidence/storage.js", () => ({
  getGradingEvidenceStorage: () => ({
    storeText: mockStoreText,
  }),
}));

describe("stressDemoBehavioralSimulation", () => {
  beforeEach(() => {
    progressWrites.length = 0;
    statusWrites.length = 0;
    mockStoreText.mockClear();
    vi.stubEnv("STRESS_DEMO_BEHAVIORAL_SIMULATION_MS", "3000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadModule() {
    return import("../../src/services/behavioralGrading/stressDemoSimulation.js");
  }

  it("isStressDemoAssessment matches the default demo assessment id", async () => {
    const { isStressDemoAssessment, shouldUseStressDemoBehavioralSimulation } =
      await loadModule();
    expect(isStressDemoAssessment(DEMO_ASSESSMENT_ID)).toBe(true);
    expect(isStressDemoAssessment("000000000000000000000000")).toBe(false);
    expect(
      shouldUseStressDemoBehavioralSimulation(null, {
        candidateName: "Steady writer",
      })
    ).toBe(true);
    expect(
      shouldUseStressDemoBehavioralSimulation(null, {
        candidateEmail: "steady@stress.bridgeai-demo.com",
      })
    ).toBe(true);
  });

  it("executeStressDemoBehavioralGrading completes end-to-end inline", async () => {
    const { executeStressDemoBehavioralGrading } = await loadModule();
    const report = await executeStressDemoBehavioralGrading(SUBMISSION_ID);
    expect(report.cases).toHaveLength(DEMO_CHECKS.length);
    expect(
      statusWrites.some((w) => w.status === "completed" && w.report != null)
    ).toBe(true);
  });

  it("runStressDemoBehavioralSimulation streams progress then returns a canned report", async () => {
    const { runStressDemoBehavioralSimulation } = await loadModule();

    const report = await runStressDemoBehavioralSimulation(SUBMISSION_ID);

    expect(report.sandbox?.sandboxId).toMatch(/^e2b_/);
    expect(report.setup?.status).toBe("ready");
    expect(report.cases).toHaveLength(DEMO_CHECKS.length);
    expect(report.cases?.every((c) => c.verdict)).toBe(true);

    expect(progressWrites.length).toBeGreaterThan(5);
    const phases = progressWrites
      .filter(Boolean)
      .map((p: any) => p.phase)
      .filter(Boolean);
    expect(phases).toContain("sandbox");
    expect(phases).toContain("install");
    expect(phases).toContain("judge");

    const maxCompleted = Math.max(
      ...progressWrites
        .filter(Boolean)
        .map((p: any) => (p.completedChecks ?? []).length),
      0
    );
    expect(maxCompleted).toBe(DEMO_CHECKS.length);
    expect(progressWrites[progressWrites.length - 1]).toBe(null);

    expect(mockStoreText).toHaveBeenCalled();
  });

  it("triggerStressDemoBehavioralSimulationInBackground completes with status completed", async () => {
    const { triggerStressDemoBehavioralSimulationInBackground } = await loadModule();

    triggerStressDemoBehavioralSimulationInBackground(SUBMISSION_ID);

    await vi.waitFor(
      () => {
        expect(
          statusWrites.some((w) => w.status === "completed" && w.report != null)
        ).toBe(true);
      },
      { timeout: 10_000 }
    );
  });
});
