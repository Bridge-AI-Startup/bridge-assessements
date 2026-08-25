/**
 * Companion director loop — watches every live companion session and prepares
 * briefings (see directorModel.ts for the thinking; this file is plumbing).
 *
 * Pattern copied from services/submission/finalizeExpired.ts: env-gated
 * setInterval, module-level id, catches everything, never throws to the
 * scheduler. Cost control is the point of the gate below: an idle session
 * (no new activity, no new speech) costs zero LLM calls.
 */
import crypto from "crypto";

import ProctoringSessionModel from "../../models/proctoringSession.js";
import SubmissionModel from "../../models/submission.js";
// Imported for its side effect too: buildContextBundle populates
// `assessmentId`, which requires the Assessment schema to be registered in
// whatever process runs the director (the dev tick script has no server.ts).
import "../../models/assessment.js";
import { WorkflowCaptureSessionModel } from "../../models/workflowCapture.js";
import { buildContextBundle } from "../agentContext/contextCenter.js";
import { readCompanionMessages, isCandidateRole } from "./transcript.js";
import {
  callDirectorModel,
  type BriefingLike,
  type DirectorDecision,
} from "./directorModel.js";

const DEFAULT_INTERVAL_MS = 30_000;
/** Unspoken briefing older than this is stale — the moment has passed. */
export const BRIEFING_TTL_MS = 4 * 60_000;
// Deliberately NO minimum gap between questions: pacing is the director
// model's judgment (it sees minutesSinceLastDelivered), not a hard rule.
const TARGET_BATCH = 20;
const HISTORY_SLICE = -40;
const HISTORY_FOR_MODEL = 15;

export function isCompanionDirectorEnabled(): boolean {
  return process.env.COMPANION_DIRECTOR_ENABLED === "true";
}

type BriefingOutcome =
  | "delivered"
  | "superseded"
  | "expired"
  | "withdrawn"
  | "dropped";

function log(msg: string): void {
  console.log(`[companion-director] ${msg}`);
}

/** Retire the current briefing (if any) into capped history with an outcome. */
async function retireCurrentBriefing(
  sessionId: string,
  briefing: BriefingLike | null | undefined,
  outcome: BriefingOutcome
): Promise<void> {
  if (!briefing) return;
  // Filter on the briefingId so a concurrent ack (which also clears the slot)
  // can't be clobbered — whoever matches first wins, the other no-ops.
  await ProctoringSessionModel.updateOne(
    {
      _id: sessionId,
      "companion.director.currentBriefing.briefingId": briefing.briefingId,
    },
    {
      $set: { "companion.director.currentBriefing": null },
      $push: {
        "companion.director.briefingHistory": {
          $each: [{ ...briefing, outcome }],
          $slice: HISTORY_SLICE,
        },
      },
    }
  );
}

function toMs(d: Date | string | null | undefined): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * One director pass over one session. Exported for the dev tick script.
 * Returns a short outcome string for logging/tests. `dryRun` gathers context
 * and calls the model but persists nothing.
 */
export async function runDirectorForSession(
  proctoringSessionId: string,
  options: { dryRun?: boolean } = {}
): Promise<{ outcome: string; decision?: DirectorDecision | null }> {
  const session = await ProctoringSessionModel.findById(proctoringSessionId)
    .select("submissionId companion")
    .lean();
  if (!session) return { outcome: "session_not_found" };

  const director = (session.companion as any)?.director ?? {};
  const currentBriefing: BriefingLike | null =
    director.currentBriefing ?? null;
  const now = Date.now();

  const submission = await SubmissionModel.findById(session.submissionId)
    .select("status token startedAt")
    .lean();
  if (!submission) return { outcome: "submission_not_found" };
  const live = ["pending", "in-progress"].includes(String(submission.status));
  if (!live && !options.dryRun) {
    // Attempt is over — nothing left to direct.
    await retireCurrentBriefing(String(session._id), currentBriefing, "expired");
    return { outcome: "submission_not_live" };
  }
  // Dry-run continues on finished sessions on purpose: replaying past sessions
  // through the director is how the prompt gets iterated.

  // Housekeeping: an unspoken briefing past TTL describes a moment that passed.
  let pending = currentBriefing;
  if (
    pending &&
    !pending.deliveredAt &&
    toMs(pending.expiresAt) <= now &&
    !options.dryRun
  ) {
    await retireCurrentBriefing(String(session._id), pending, "expired");
    pending = null;
  }

  // ---- Cost gate: skip the LLM entirely when nothing changed. ----
  const capture = await WorkflowCaptureSessionModel.findOne({
    $or: [
      { submissionId: session.submissionId },
      { submissionToken: submission.token },
    ],
  })
    .sort({ createdAt: -1 })
    .select("lastEventAt")
    .lean();

  const voice = await readCompanionMessages(String(session._id));
  const lastCandidateVoiceMs = voice.reduce(
    (max, m) => (isCandidateRole(m.role) ? Math.max(max, m.timestampMs) : max),
    0
  );

  const newEvents = toMs(capture?.lastEventAt) > toMs(director.lastEventAt);
  const newVoice = lastCandidateVoiceMs > (director.lastVoiceAt ?? 0);
  if (!newEvents && !newVoice && !options.dryRun) {
    await ProctoringSessionModel.updateOne(
      { _id: session._id },
      { $set: { "companion.director.lastTickAt": new Date() } }
    );
    return { outcome: "no_change" };
  }

  // ---- Decide. ----
  const bundle = await buildContextBundle(String(session.submissionId), {
    topics: ["assessment", "timeline", "conversation"],
  });
  const startedAtMs = toMs(submission.startedAt);
  const lastDeliveredMs = toMs(director.lastDeliveredAt);
  const history: BriefingLike[] = Array.isArray(director.briefingHistory)
    ? director.briefingHistory.slice(-HISTORY_FOR_MODEL)
    : [];

  const decision = await callDirectorModel({
    contextBundle: {
      assessment: bundle?.assessment,
      timeline: bundle?.timeline,
    },
    voiceTail: voice,
    pendingBriefing: pending,
    briefingHistory: history,
    elapsedMinutes: startedAtMs
      ? Math.round((now - startedAtMs) / 60_000)
      : null,
    minutesSinceLastDelivered: lastDeliveredMs
      ? Math.round((now - lastDeliveredMs) / 60_000)
      : null,
  });

  if (!decision) {
    log(`session ${session._id}: unparseable model reply — skipping`);
    return { outcome: "unparseable", decision: null };
  }

  if (options.dryRun) {
    return { outcome: "dry_run", decision };
  }

  // ---- Apply. ----
  const cursorUpdate: Record<string, unknown> = {
    "companion.director.lastTickAt": new Date(),
    "companion.director.lastEventAt": capture?.lastEventAt ?? null,
    "companion.director.lastVoiceAt": lastCandidateVoiceMs,
  };

  if (decision.shouldSpeak && decision.question) {
    if (pending && pending.question === decision.question) {
      // Same question re-issued: refresh the TTL, keep the id so an
      // already-polled client's dedupe still holds.
      await ProctoringSessionModel.updateOne(
        { _id: session._id },
        {
          $set: {
            ...cursorUpdate,
            "companion.director.currentBriefing.expiresAt": new Date(
              now + BRIEFING_TTL_MS
            ),
          },
        }
      );
      return { outcome: "reissued", decision };
    }

    if (pending) {
      await retireCurrentBriefing(String(session._id), pending, "superseded");
    }
    await ProctoringSessionModel.updateOne(
      { _id: session._id },
      {
        $set: {
          ...cursorUpdate,
          "companion.director.currentBriefing": {
            briefingId: crypto.randomBytes(8).toString("hex"),
            question: decision.question,
            anchorSummary: decision.anchorSummary ?? "",
            reason: decision.reason ?? "",
            createdAt: new Date(now),
            expiresAt: new Date(now + BRIEFING_TTL_MS),
            deliveredAt: null,
          },
        },
      }
    );
    log(
      `session ${session._id}: briefing published — ${decision.question.slice(0, 100)}`
    );
    return { outcome: "published", decision };
  }

  // Stay quiet — and if a briefing was pending, the model saw it and chose
  // silence anyway: the moment passed, withdraw it.
  if (pending) {
    await retireCurrentBriefing(String(session._id), pending, "withdrawn");
  }
  await ProctoringSessionModel.updateOne(
    { _id: session._id },
    { $set: cursorUpdate }
  );
  return { outcome: pending ? "withdrawn" : "quiet", decision };
}

let inFlight = false;

/** One sweep over every active companion session. Never throws. */
export async function companionDirectorTick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const sessions = await ProctoringSessionModel.find({
      "companion.status": "active",
    })
      .select("_id")
      .limit(TARGET_BATCH)
      .lean();
    for (const s of sessions) {
      try {
        await runDirectorForSession(String(s._id));
      } catch (err) {
        log(
          `session ${s._id} failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  } catch (err) {
    log(`tick failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    inFlight = false;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

function getIntervalMs(): number {
  const raw = process.env.COMPANION_DIRECTOR_INTERVAL_MS;
  if (raw == null || raw === "") return DEFAULT_INTERVAL_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

export function startCompanionDirector(): void {
  if (!isCompanionDirectorEnabled()) return;
  if (intervalId) return;
  const intervalMs = getIntervalMs();
  intervalId = setInterval(() => {
    void companionDirectorTick();
  }, intervalMs);
  log(`started (interval ${intervalMs}ms)`);
  void companionDirectorTick();
}

export function stopCompanionDirector(): void {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
  log("stopped");
}
