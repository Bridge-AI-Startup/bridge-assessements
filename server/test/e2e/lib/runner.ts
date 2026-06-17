/**
 * Lightweight process/step runner. Each "process" (P1..P7) is a sequence of
 * timed, budgeted steps. The runner records per-step status + evidence and
 * derives a process-level status, never letting a step run unbounded.
 */

import type {
  Evidence,
  ProcessResult,
  Recommendation,
  StepResult,
  StepStatus,
} from "./types.js";

export interface EvidenceSink {
  json(label: string, value: unknown): void;
  text(label: string, value: string): void;
  screenshot(label: string, path: string): void;
  file(label: string, path: string): void;
}

/** Race a promise against a hard timeout so a hung op can never jam the run. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${ms}ms budget`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export class ProcessContext {
  private steps: StepResult[] = [];
  private recommendation?: Recommendation;
  private summaryText = "";
  private startedAt = new Date();

  constructor(
    public meta: {
      id: string;
      title: string;
      description: string;
      scriptPath: string;
    }
  ) {}

  summary(text: string): void {
    this.summaryText = text;
  }

  /** Attach a process-level recommended fix (also aggregated into suite.fixes). */
  recommend(rec: Omit<Recommendation, "process">): void {
    this.recommendation = { ...rec, process: this.meta.id };
  }

  /** Run a timed, budgeted step. Throws on failure (after recording it). */
  async step<T>(
    name: string,
    fn: (ev: EvidenceSink) => Promise<T>,
    budgetMs = 30_000
  ): Promise<T> {
    const evidence: Evidence[] = [];
    const sink: EvidenceSink = {
      json: (label, value) => evidence.push({ type: "json", label, value }),
      text: (label, value) => evidence.push({ type: "text", label, value }),
      screenshot: (label, path) =>
        evidence.push({ type: "screenshot", label, path }),
      file: (label, path) => evidence.push({ type: "file", label, path }),
    };
    const start = Date.now();
    try {
      const result = await withTimeout(fn(sink), budgetMs, `step "${name}"`);
      this.steps.push({
        name,
        status: "pass",
        durationMs: Date.now() - start,
        evidence,
      });
      return result;
    } catch (err: any) {
      this.steps.push({
        name,
        status: "fail",
        durationMs: Date.now() - start,
        detail: err?.message || String(err),
        evidence,
      });
      throw err;
    }
  }

  /**
   * Like step(), but a failure is recorded as "blocked" (not "fail") and the
   * method returns null instead of throwing. Use for attempts we expect may be
   * unavailable in this environment (e.g. auth-gated calls when the Firebase
   * Admin credential is broken) where a fallback path exists.
   */
  async attempt<T>(
    name: string,
    fn: (ev: EvidenceSink) => Promise<T>,
    budgetMs = 30_000
  ): Promise<T | null> {
    const evidence: Evidence[] = [];
    const sink: EvidenceSink = {
      json: (label, value) => evidence.push({ type: "json", label, value }),
      text: (label, value) => evidence.push({ type: "text", label, value }),
      screenshot: (label, path) =>
        evidence.push({ type: "screenshot", label, path }),
      file: (label, path) => evidence.push({ type: "file", label, path }),
    };
    const start = Date.now();
    try {
      const result = await withTimeout(fn(sink), budgetMs, `attempt "${name}"`);
      this.steps.push({
        name,
        status: "pass",
        durationMs: Date.now() - start,
        evidence,
      });
      return result;
    } catch (err: any) {
      this.steps.push({
        name,
        status: "blocked",
        durationMs: Date.now() - start,
        detail: err?.message || String(err),
        evidence,
      });
      return null;
    }
  }

  /** Record a deliberately blocked step (e.g. missing external credential). */
  blocked(name: string, detail: string): void {
    this.steps.push({ name, status: "blocked", durationMs: 0, detail, evidence: [] });
  }

  /** Mark remaining intended steps as skipped after an upstream failure. */
  skip(name: string, detail: string): void {
    this.steps.push({ name, status: "skipped", durationMs: 0, detail, evidence: [] });
  }

  private deriveStatus(): StepStatus {
    if (this.steps.some((s) => s.status === "fail")) return "fail";
    if (this.steps.some((s) => s.status === "pass")) return "pass";
    if (this.steps.some((s) => s.status === "blocked")) return "blocked";
    return "skipped";
  }

  finish(): ProcessResult {
    return {
      id: this.meta.id,
      title: this.meta.title,
      description: this.meta.description,
      scriptPath: this.meta.scriptPath,
      status: this.deriveStatus(),
      startedAt: this.startedAt.toISOString(),
      durationMs: Date.now() - this.startedAt.getTime(),
      summary: this.summaryText,
      steps: this.steps,
      recommendation: this.recommendation,
    };
  }
}

/**
 * Execute a process body. The body may throw; we still return a finished
 * ProcessResult (with the failure captured) so the suite continues.
 */
export async function runProcess(
  meta: {
    id: string;
    title: string;
    description: string;
    scriptPath: string;
  },
  body: (ctx: ProcessContext) => Promise<void>
): Promise<ProcessResult> {
  const ctx = new ProcessContext(meta);
  try {
    await body(ctx);
  } catch (err: any) {
    if (!ctx.finish().summary) {
      ctx.summary(`Halted early: ${err?.message || String(err)}`);
    }
  }
  return ctx.finish();
}
