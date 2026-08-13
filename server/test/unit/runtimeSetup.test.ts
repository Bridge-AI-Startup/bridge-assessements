import { describe, expect, it } from "vitest";
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
  isLiveSetupSandbox,
  markRuntimeSetupInProgress,
  shouldApplyRuntimeRunResult,
} from "../../src/services/runtimeSetup/sessions.js";
import { isBusyRunPhase } from "../../src/services/runtimeSetup/config.js";
import { parseListenPorts } from "../../src/services/runtimeSetup/run.js";

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
    });
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
