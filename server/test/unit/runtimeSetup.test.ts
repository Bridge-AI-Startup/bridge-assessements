import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "http-errors";
import mongoose from "mongoose";
import SubmissionModel from "../../src/models/submission.js";
import {
  emptyRuntimeConfig,
  runtimeConfigSchema,
  snapshotShaFromSubmission,
} from "../../src/services/runtimeSetup/schema.js";
import {
  mergeRuntimeConfig,
  publicRuntimeConfig,
  redactSecrets,
} from "../../src/services/runtimeSetup/secrets.js";
import {
  assertFinalizedForReplay,
  assertReplayDoesNotPreemptGrading,
  isLiveSetupSandbox,
  markRuntimeSetupInProgress,
  REPLAY_BLOCKED_BY_GRADING_MESSAGE,
  replayWouldPreemptGrading,
  runningSandboxFilter,
  shouldApplyRuntimeRunResult,
} from "../../src/services/runtimeSetup/sessions.js";
import { isBusyRunPhase } from "../../src/services/runtimeSetup/config.js";
import {
  createRunDeadline,
  parseListenPorts,
} from "../../src/services/runtimeSetup/run.js";
import {
  candidateGradingEnv,
  candidateRunbookFromSubmission,
  runtimeConfigToRunbook,
} from "../../src/services/behavioralGrading/runtimeConfigRunbook.js";
import {
  claimBehavioralGradingRun,
  hasAnyBehavioralGradingInFlight,
  releaseBehavioralGradingRun,
} from "../../src/services/behavioralGrading/index.js";

describe("runtimeConfigSchema", () => {
  it("applies defaults and rejects path traversal in rootDir", () => {
    const parsed = runtimeConfigSchema.parse({
      rootDir: "../etc",
      startCommand: "npm start",
    });
    expect(parsed.rootDir).toBe(".");
    expect(parsed.runtime).toBe("auto");
    expect(parsed.executionProfile).toBe("unclear");
  });

  it("normalizes healthPath and empty buildCommand", () => {
    const parsed = runtimeConfigSchema.parse({
      healthPath: "health",
      buildCommand: "",
      startCommand: "uvicorn app:app",
    });
    expect(parsed.healthPath).toBe("/health");
    expect(parsed.buildCommand).toBeNull();
  });

  it("rejects invalid env var keys and domains", () => {
    expect(() =>
      runtimeConfigSchema.parse({
        envVars: [{ key: "1BAD", value: "x" }],
      })
    ).toThrow();
    expect(() =>
      runtimeConfigSchema.parse({
        declaredEgressDomains: ["not a domain"],
      })
    ).toThrow();
  });
});

describe("secret handling", () => {
  it("never returns secret values from GET shaping", () => {
    const stored = runtimeConfigSchema.parse({
      startCommand: "npm start",
      envVars: [
        { key: "PUBLIC", value: "visible", secret: false },
        { key: "DB_PASSWORD", value: "super-secret-value", secret: true },
      ],
    });
    const pub = publicRuntimeConfig(stored);
    expect(pub?.envVars.find((r) => r.key === "PUBLIC")?.value).toBe("visible");
    expect(pub?.envVars.find((r) => r.key === "DB_PASSWORD")).toEqual({
      key: "DB_PASSWORD",
      value: "",
      secret: true,
      hasValue: true,
    });
  });

  it("marks a blank secret row as having no stored value", () => {
    const stored = runtimeConfigSchema.parse({
      startCommand: "npm start",
      envVars: [
        { key: "FILLED", value: "abc", secret: true },
        { key: "EMPTY", value: "", secret: true },
      ],
    });
    const pub = publicRuntimeConfig(stored);
    expect(pub?.envVars.find((r) => r.key === "FILLED")?.hasValue).toBe(true);
    expect(pub?.envVars.find((r) => r.key === "EMPTY")?.hasValue).toBe(false);
  });

  it("keeps previous secret when PUT sends an empty write-only value", () => {
    const previous = runtimeConfigSchema.parse({
      startCommand: "npm start",
      envVars: [{ key: "TOKEN", value: "keep-me", secret: true }],
    });
    const incoming = runtimeConfigSchema.parse({
      startCommand: "npm start",
      envVars: [{ key: "TOKEN", value: "", secret: true }],
    });
    const merged = mergeRuntimeConfig(previous, incoming);
    expect(merged.envVars[0].value).toBe("keep-me");
  });

  it("redacts secret values and TOKEN= assignments from logs", () => {
    const text = redactSecrets(
      "API_TOKEN=abcd1234 connected with keep-me-please",
      ["keep-me-please"]
    );
    expect(text).not.toContain("keep-me-please");
    expect(text).toContain("[redacted]");
    expect(text).toMatch(/API_TOKEN=\[redacted\]/i);
  });
});

describe("snapshotShaFromSubmission", () => {
  it("uses upload sha or pinned commit", () => {
    expect(
      snapshotShaFromSubmission({
        codeSource: "upload",
        codeUpload: { sha256: "abc" },
      })
    ).toBe("abc");
    expect(
      snapshotShaFromSubmission({
        codeSource: "github",
        githubRepo: { pinnedCommitSha: "def" },
      })
    ).toBe("def");
  });
});

describe("emptyRuntimeConfig", () => {
  it("returns a valid blank form", () => {
    const blank = emptyRuntimeConfig();
    expect(blank.startCommand).toBe("");
    expect(blank.envVars).toEqual([]);
  });
});

describe("isLiveSetupSandbox", () => {
  it("is true only for a running or paused box with an id", () => {
    expect(
      isLiveSetupSandbox({ e2bSandboxId: "sbx_1", status: "running" })
    ).toBe(true);
    expect(
      isLiveSetupSandbox({ e2bSandboxId: "sbx_1", status: "paused" })
    ).toBe(true);
    expect(
      isLiveSetupSandbox({ e2bSandboxId: "sbx_1", status: "dead" })
    ).toBe(false);
    expect(
      isLiveSetupSandbox({ e2bSandboxId: "sbx_1", status: "provisioning" })
    ).toBe(false);
    expect(isLiveSetupSandbox({ e2bSandboxId: null, status: "running" })).toBe(
      false
    );
    expect(isLiveSetupSandbox(null)).toBe(false);
  });
});

describe("shouldApplyRuntimeRunResult", () => {
  it("skips writes when the sandbox id changed, the session is dead, or setup is finalized", () => {
    expect(
      shouldApplyRuntimeRunResult({
        expectedSandboxId: "sbx_old",
        currentSandboxId: "sbx_old",
        sessionStatus: "running",
        setupStatus: "in_progress",
      })
    ).toBe(true);
    expect(
      shouldApplyRuntimeRunResult({
        expectedSandboxId: "sbx_old",
        currentSandboxId: "sbx_new",
        sessionStatus: "running",
        setupStatus: "in_progress",
      })
    ).toBe(false);
    expect(
      shouldApplyRuntimeRunResult({
        expectedSandboxId: "sbx_old",
        currentSandboxId: null,
        sessionStatus: "dead",
        setupStatus: "in_progress",
      })
    ).toBe(false);
    expect(
      shouldApplyRuntimeRunResult({
        expectedSandboxId: "sbx_old",
        currentSandboxId: "sbx_old",
        sessionStatus: "running",
        setupStatus: "finalized",
      })
    ).toBe(false);
    expect(
      shouldApplyRuntimeRunResult({
        expectedSandboxId: null,
        currentSandboxId: "sbx_old",
        sessionStatus: "running",
        setupStatus: "in_progress",
      })
    ).toBe(false);
  });
});

describe("assertFinalizedForReplay", () => {
  it("refuses replay when the candidate has not finalized", () => {
    try {
      assertFinalizedForReplay({ runtimeSetup: { status: "in_progress" } });
      throw new Error("expected assertFinalizedForReplay to throw");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
      expect((err as Error).message).toMatch(/not finalized/i);
    }
  });

  it("refuses replay when runtimeSetup is missing", () => {
    try {
      assertFinalizedForReplay({});
      throw new Error("expected assertFinalizedForReplay to throw");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  it("allows replay when status is finalized", () => {
    expect(() =>
      assertFinalizedForReplay({ runtimeSetup: { status: "finalized" } })
    ).not.toThrow();
  });
});

describe("markRuntimeSetupInProgress", () => {
  it("does not write undefined lastRunResult onto a mongoose subdocument", () => {
    const prev = process.env.RUNTIME_SETUP_ENABLED;
    process.env.RUNTIME_SETUP_ENABLED = "true";
    try {
      const doc = new SubmissionModel({
        token: "runtime-setup-validate-token",
        assessmentId: new mongoose.Types.ObjectId(),
        candidateName: "Tester",
        candidateEmail: "tester@example.com",
        status: "submitted",
      });
      markRuntimeSetupInProgress(doc);
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.runtimeSetup?.status).toBe("in_progress");
    } finally {
      if (prev === undefined) delete process.env.RUNTIME_SETUP_ENABLED;
      else process.env.RUNTIME_SETUP_ENABLED = prev;
    }
  });
});

describe("isBusyRunPhase", () => {
  it("is true for install/build/start/health and false otherwise", () => {
    expect(isBusyRunPhase("installing")).toBe(true);
    expect(isBusyRunPhase("building")).toBe(true);
    expect(isBusyRunPhase("starting")).toBe(true);
    expect(isBusyRunPhase("waiting_health")).toBe(true);
    expect(isBusyRunPhase("ready")).toBe(false);
    expect(isBusyRunPhase("failed")).toBe(false);
    expect(isBusyRunPhase("idle")).toBe(false);
    expect(isBusyRunPhase(null)).toBe(false);
  });
});

describe("runtimeConfigToRunbook", () => {
  it("maps install/build/start onto runbook steps with the config's root dir", () => {
    const config = runtimeConfigSchema.parse({
      rootDir: "server",
      installCommand: "npm ci",
      buildCommand: "npm run build",
      startCommand: "npm start",
      port: 5050,
      executionProfile: "web_server",
    });
    const runbook = runtimeConfigToRunbook(config);
    expect(runbook.steps.map((s) => [s.purpose, s.command])).toEqual([
      ["install", "npm ci"],
      ["setup", "npm run build"],
      ["start", "npm start"],
    ]);
    expect(runbook.steps.every((s) => s.cwd === "server")).toBe(true);
    expect(runbook.steps.every((s) => s.origin === "readme")).toBe(true);
    expect(runbook.portsHint).toEqual([5050]);
    expect(runbook.executionProfile).toBe("web_server");
    expect(runbook.readmeCoverage.hasInstallCommand).toBe(true);
    expect(runbook.readmeCoverage.hasStartCommand).toBe(true);
  });

  it("omits absent steps and leaves cwd unset at the repo root", () => {
    const config = runtimeConfigSchema.parse({
      startCommand: "python3 solve.py",
      executionProfile: "cli_stdout",
    });
    const runbook = runtimeConfigToRunbook(config);
    expect(runbook.steps).toHaveLength(1);
    expect(runbook.steps[0].purpose).toBe("start");
    expect(runbook.steps[0].cwd).toBeUndefined();
    expect(runbook.portsHint).toEqual([]);
    expect(runbook.readmeCoverage.hasInstallCommand).toBe(false);
  });
});

describe("candidateGradingEnv", () => {
  it("adds PORT from the config and keeps a candidate-set PORT", () => {
    const withPort = runtimeConfigSchema.parse({
      startCommand: "npm start",
      port: 4000,
      envVars: [{ key: "API_KEY", value: "abc", secret: true }],
    });
    expect(candidateGradingEnv(withPort)).toEqual([
      { key: "API_KEY", value: "abc", secret: true },
      { key: "PORT", value: "4000", secret: false },
    ]);

    const explicit = runtimeConfigSchema.parse({
      startCommand: "npm start",
      port: 4000,
      envVars: [{ key: "PORT", value: "9999" }],
    });
    expect(candidateGradingEnv(explicit)).toEqual([
      { key: "PORT", value: "9999", secret: false },
    ]);
  });
});

describe("candidateRunbookFromSubmission", () => {
  const config = {
    startCommand: "npm start",
    installCommand: "npm ci",
    port: 5050,
    executionProfile: "web_server",
  };

  it("returns a runbook only when setup is finalized and verified", () => {
    expect(
      candidateRunbookFromSubmission({
        runtimeSetup: { status: "finalized", verified: true },
        runtimeConfig: config,
      })
    ).not.toBeNull();
    expect(
      candidateRunbookFromSubmission({
        runtimeSetup: { status: "finalized", verified: false },
        runtimeConfig: config,
      })
    ).toBeNull();
    expect(
      candidateRunbookFromSubmission({
        runtimeSetup: { status: "in_progress", verified: true },
        runtimeConfig: config,
      })
    ).toBeNull();
    expect(candidateRunbookFromSubmission({})).toBeNull();
  });

  it("falls back to the planner when the stored config has no start command", () => {
    expect(
      candidateRunbookFromSubmission({
        runtimeSetup: { status: "finalized", verified: true },
        runtimeConfig: { installCommand: "npm ci" },
      })
    ).toBeNull();
  });
});

describe("replay vs in-flight behavioral grading", () => {
  const ids: string[] = [];

  afterEach(() => {
    for (const id of ids) releaseBehavioralGradingRun(id);
    ids.length = 0;
  });

  it("allows recruiter replay when no grade is in flight", () => {
    expect(hasAnyBehavioralGradingInFlight()).toBe(false);
    expect(replayWouldPreemptGrading()).toBe(false);
    expect(() => assertReplayDoesNotPreemptGrading()).not.toThrow();
  });

  it("refuses a new replay sandbox while this submission is being graded", () => {
    const id = "replay-guard-same";
    ids.push(id);
    expect(claimBehavioralGradingRun(id)).toBe(true);
    expect(replayWouldPreemptGrading()).toBe(true);
    try {
      assertReplayDoesNotPreemptGrading();
      throw new Error("expected 409");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(409);
      expect((err as HttpError).message).toBe(REPLAY_BLOCKED_BY_GRADING_MESSAGE);
    }
  });

  it("refuses replay for a different submission too (shared E2B quota)", () => {
    const gradingId = "replay-guard-grade";
    ids.push(gradingId);
    expect(claimBehavioralGradingRun(gradingId)).toBe(true);
    expect(replayWouldPreemptGrading()).toBe(true);
    try {
      assertReplayDoesNotPreemptGrading();
      throw new Error("expected 409");
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(409);
    }
  });

  it("allows replay again after the grade is released", () => {
    const id = "replay-guard-release";
    ids.push(id);
    expect(claimBehavioralGradingRun(id)).toBe(true);
    releaseBehavioralGradingRun(id);
    expect(replayWouldPreemptGrading()).toBe(false);
    expect(() => assertReplayDoesNotPreemptGrading()).not.toThrow();
  });
});

describe("countRunningSandboxes", () => {
  it("counts provisioning boxes so simultaneous requests cannot overshoot the cap", () => {
    const filter = runningSandboxFilter();
    expect(filter.status.$in).toContain("running");
    expect(filter.status.$in).toContain("provisioning");
    expect(filter.status.$in).not.toContain("paused");
  });
});

describe("createRunDeadline", () => {
  it("caps a step at the time the run has left and reports expiry", () => {
    let now = 1_000;
    const deadline = createRunDeadline(1_000, 60_000, () => now);
    expect(deadline.stepTimeout(10_000)).toBe(10_000);
    expect(deadline.expired()).toBe(false);

    now = 1_000 + 55_000;
    expect(deadline.stepTimeout(10_000)).toBe(5_000);
    expect(deadline.expired()).toBe(false);

    now = 1_000 + 60_000;
    expect(deadline.expired()).toBe(true);
    expect(deadline.stepTimeout(10_000)).toBe(1_000);
  });
});

describe("parseListenPorts", () => {
  it("keeps app ports and drops ssh/ephemeral", () => {
    expect(parseListenPorts("22\n5050\n3000\n60123\n5050\n")).toEqual([
      5050, 3000,
    ]);
  });

  it("returns empty when nothing is listening", () => {
    expect(parseListenPorts("")).toEqual([]);
    expect(parseListenPorts("22\n")).toEqual([]);
  });
});
