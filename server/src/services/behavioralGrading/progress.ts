/**
 * Live progress for one behavioral grading run.
 *
 * The recruiter UI already polls `behavioralGradingProgress` every 3s. The
 * stress-demo simulator used to be the only writer; real E2B runs now use the
 * same document. Phase changes persist immediately. Step-level updates are
 * coalesced so Atlas is not hit on every agent tool turn.
 */

import SubmissionModel from "../../models/submission.js";

export const PROGRESS_STEP_THROTTLE_MS = 750;

export type BehavioralProgressPhase =
  | "sandbox"
  | "install"
  | "test"
  | "start"
  | "judge";

export type BehavioralProgressStep = {
  iteration: number;
  tool: string;
  detail: string;
  status: "pending" | "running" | "done";
  outputPreview?: string;
};

export type BehavioralProgressCompletedCheck = {
  checkIndex: number;
  checkText: string;
  verdict: "pass" | "fail" | "inconclusive" | "blocked";
  verifiedBy?: string;
};

export type BehavioralGradingProgress = {
  phase: BehavioralProgressPhase;
  phaseLabel: string;
  checkIndex: number | null;
  checksTotal: number;
  checkText?: string;
  agentSteps: BehavioralProgressStep[];
  completedChecks: BehavioralProgressCompletedCheck[];
  startedAt: string;
  updatedAt: string;
};

export type ProgressPersistFn = (
  submissionId: string,
  progress: BehavioralGradingProgress
) => Promise<void>;

export type ProgressUnsetFn = (submissionId: string) => Promise<void>;

export async function writeBehavioralProgress(
  submissionId: string,
  progress: BehavioralGradingProgress
): Promise<void> {
  await SubmissionModel.findByIdAndUpdate(submissionId, {
    $set: { behavioralGradingProgress: progress },
  });
}

export async function clearBehavioralProgress(
  submissionId: string
): Promise<void> {
  await SubmissionModel.findByIdAndUpdate(submissionId, {
    $unset: { behavioralGradingProgress: "" },
  });
}

export function queuedBehavioralProgress(
  checksTotal = 0,
  startedAt = new Date().toISOString()
): BehavioralGradingProgress {
  return {
    phase: "sandbox",
    phaseLabel: "Queued — waiting for a grading slot",
    checkIndex: null,
    checksTotal,
    agentSteps: [],
    completedChecks: [],
    startedAt,
    updatedAt: startedAt,
  };
}

export type ProgressWriter = {
  snapshot: () => BehavioralGradingProgress;
  setPhase: (
    phase: BehavioralProgressPhase,
    phaseLabel: string,
    extras?: {
      checkIndex?: number | null;
      checkText?: string;
      agentSteps?: BehavioralProgressStep[];
    }
  ) => Promise<void>;
  setSteps: (agentSteps: BehavioralProgressStep[]) => Promise<void>;
  beginCheck: (
    checkIndex: number,
    checkText: string,
    phaseLabel: string
  ) => Promise<void>;
  addCompletedCheck: (
    check: BehavioralProgressCompletedCheck
  ) => Promise<void>;
  flush: () => Promise<void>;
  /** Cancel a pending throttled write without touching Mongo. */
  stop: () => Promise<void>;
  clear: () => Promise<void>;
};

export function createProgressWriter(options: {
  submissionId: string;
  checksTotal: number;
  startedAt?: string;
  throttleMs?: number;
  now?: () => number;
  persist?: ProgressPersistFn;
  unset?: ProgressUnsetFn;
}): ProgressWriter {
  const throttleMs = options.throttleMs ?? PROGRESS_STEP_THROTTLE_MS;
  const persist = options.persist ?? writeBehavioralProgress;
  const unset = options.unset ?? clearBehavioralProgress;
  const now = options.now ?? (() => Date.now());
  const startedAt = options.startedAt ?? new Date(now()).toISOString();

  let current: BehavioralGradingProgress = queuedBehavioralProgress(
    options.checksTotal,
    startedAt
  );
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPersistAt = 0;
  let persistChain: Promise<void> = Promise.resolve();

  const iso = () => new Date(now()).toISOString();

  const persistNow = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const snapshot: BehavioralGradingProgress = {
      ...current,
      updatedAt: iso(),
    };
    current = snapshot;
    lastPersistAt = now();
    persistChain = persistChain
      .then(() => persist(options.submissionId, snapshot))
      .catch((err) => {
        console.error(
          `[behavioral] progress persist failed for ${options.submissionId}:`,
          err
        );
      });
    return persistChain;
  };

  const scheduleThrottled = (): Promise<void> => {
    const elapsed = now() - lastPersistAt;
    if (elapsed >= throttleMs) {
      return persistNow();
    }
    if (timer) return persistChain;
    const wait = Math.max(0, throttleMs - elapsed);
    timer = setTimeout(() => {
      timer = null;
      void persistNow();
    }, wait);
    return persistChain;
  };

  return {
    snapshot: () => ({ ...current, agentSteps: [...current.agentSteps] }),
    async setPhase(phase, phaseLabel, extras) {
      current = {
        ...current,
        phase,
        phaseLabel,
        checkIndex:
          extras && "checkIndex" in extras
            ? (extras.checkIndex ?? null)
            : current.checkIndex,
        ...(extras && "checkText" in extras
          ? { checkText: extras.checkText }
          : {}),
        agentSteps: extras?.agentSteps ?? [],
      };
      await persistNow();
    },
    async setSteps(agentSteps) {
      current = { ...current, agentSteps };
      await scheduleThrottled();
    },
    async beginCheck(checkIndex, checkText, phaseLabel) {
      current = {
        ...current,
        phase: "judge",
        phaseLabel,
        checkIndex,
        checkText,
        agentSteps: [],
      };
      await persistNow();
    },
    async addCompletedCheck(check) {
      current = {
        ...current,
        completedChecks: [...current.completedChecks, check],
        checkIndex: check.checkIndex,
        checkText: check.checkText,
        agentSteps: [],
      };
      await persistNow();
    },
    async flush() {
      await persistNow();
    },
    async stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await persistChain.catch(() => {});
    },
    async clear() {
      await this.stop();
      try {
        await unset(options.submissionId);
      } catch (err) {
        console.error(
          `[behavioral] progress clear failed for ${options.submissionId}:`,
          err
        );
      }
    },
  };
}
