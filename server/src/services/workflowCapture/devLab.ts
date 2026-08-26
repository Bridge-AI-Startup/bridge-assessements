/**
 * Dev lab: everything the capture pipeline knows about one session, plus the
 * ability to run each AI stage on demand.
 *
 * The tester page exists so a developer can watch a candidate session happen to
 * themselves — every byte we store, and every model call we would make if a
 * real candidate were sitting there. Two rules shape this file:
 *
 *  1. Deterministic work (metrics, timeline, capture integrity, video offsets)
 *     is recomputed on every poll. It is free, and stale numbers on a live page
 *     are worse than none.
 *  2. Anything that costs a model call is a *stage*: started explicitly, run in
 *     the background, and cached here with its status and timing, so the page
 *     can show "running… 14s" instead of hanging a request for a minute.
 *
 * Dev only. Every route that reaches this is gated to non-production twice
 * (route mount + handler), because it returns capture tokens and raw prompts.
 */

import fs from "fs";
import path from "path";

import {
  WorkflowCaptureSessionModel,
  WorkflowEventModel,
  WorkflowFileStateModel,
} from "../../models/workflowCapture.js";
import SubmissionModel from "../../models/submission.js";
import ProctoringSessionModel from "../../models/proctoringSession.js";

import { computeMetrics } from "./metrics.js";
import { buildTranscriptEvents, videoOffsetForSessionSeconds } from "./timeline.js";
import { offsetIntoVideo, nextVideoOffsetStart } from "./video.js";
import { assessCaptureIntegrity, evaluateWorkflowSession } from "./evaluate.js";
import { computeAndStoreEpisodes } from "./episodes.js";
import { classifyScreenGaps } from "./screenContext.js";
import { assessCommunication } from "../evaluation/communication.js";
import { groundCriterion } from "../evaluation/grounder.js";
import { validateCriterion } from "../evaluation/validator.js";
import {
  getVoiceEventsForSubmission,
  readCompanionMessages,
} from "../companion/transcript.js";
import { buildContextBundle } from "../agentContext/contextCenter.js";
import {
  DIRECTOR_SYSTEM_PROMPT,
  buildDirectorUserMessage,
  callDirectorModel,
  getDirectorModel,
} from "../companion/directorModel.js";

/** Criteria used when the session is not linked to an assessment. */
export const DEFAULT_DEV_CRITERIA = [
  "Inspects existing files before making the first edit",
  "Gives the AI assistant specific, informative instructions rather than one-word assent",
  "Runs the code or its tests after changes rather than accepting them untested",
  "Edits agent-written code rather than leaving it untouched",
];

export type StageKey =
  | "screen"
  | "episodes"
  | "evaluate"
  | "communication"
  | "agentContext"
  | "director";

export const STAGE_KEYS: StageKey[] = [
  "screen",
  "episodes",
  "evaluate",
  "communication",
  "agentContext",
  "director",
];

export interface StageState {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** Bumped on every completion so the page knows to refetch the payload. */
  version: number;
  error: string | null;
  /** Small enough to ride along with the 2s poll. */
  meta: Record<string, unknown> | null;
  /** Full payload — fetched separately via getStageResult. */
  result?: unknown;
}

const EMPTY_STAGE: StageState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  version: 0,
  error: null,
  meta: null,
};

const stageCache = new Map<string, Map<StageKey, StageState>>();

/**
 * Stage results are mirrored to disk.
 *
 * The lab is used with nodemon running: an in-memory cache alone means every
 * save throws away a grading run that cost a minute and a fistful of model
 * calls, which trains you to stop editing while you look at results. Dev-only
 * scratch — delete the directory any time.
 */
const CACHE_DIR = path.join(process.cwd(), "storage", "devlab");

function cachePath(sessionId: string): string {
  // Session ids are Mongo ObjectIds, but this builds a filesystem path from a
  // request parameter — keep it to hex or it is a path-traversal.
  return path.join(CACHE_DIR, `${sessionId.replace(/[^a-zA-Z0-9]/g, "")}.json`);
}

function persistStages(sessionId: string): void {
  const m = stageCache.get(sessionId);
  if (!m) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const obj: Record<string, StageState> = {};
    m.forEach((v, k) => {
      // A run that was in flight when the process died is not resumable.
      obj[k] = v.status === "running" ? { ...v, status: "idle" } : v;
    });
    fs.writeFileSync(cachePath(sessionId), JSON.stringify(obj), "utf8");
  } catch {
    // The lab must work with no writable storage dir; results just won't survive.
  }
}

function stagesFor(sessionId: string): Map<StageKey, StageState> {
  let m = stageCache.get(sessionId);
  if (!m) {
    m = new Map();
    try {
      const raw = fs.readFileSync(cachePath(sessionId), "utf8");
      const obj = JSON.parse(raw) as Record<string, StageState>;
      for (const key of STAGE_KEYS) {
        if (obj[key]) m.set(key, obj[key]);
      }
    } catch {
      // No cache on disk — first run for this session.
    }
    stageCache.set(sessionId, m);
  }
  return m;
}

export function getStageState(sessionId: string, stage: StageKey): StageState {
  return stagesFor(sessionId).get(stage) ?? { ...EMPTY_STAGE };
}

export function getStageSummaries(
  sessionId: string
): Record<string, Omit<StageState, "result">> {
  const out: Record<string, Omit<StageState, "result">> = {};
  for (const key of STAGE_KEYS) {
    const { result, ...rest } = getStageState(sessionId, key);
    out[key] = rest;
  }
  return out;
}

export function getStageResult(sessionId: string, stage: StageKey): StageState {
  return getStageState(sessionId, stage);
}

export interface RunStageOptions {
  criteria?: string[];
  question?: string;
  replaceExisting?: boolean;
}

/**
 * Kick a stage off in the background and return immediately.
 *
 * Re-entrant on purpose: a second click while one is running returns the
 * running state rather than spending a second model call on the same session.
 */
export function startStage(
  sessionId: string,
  stage: StageKey,
  options: RunStageOptions = {}
): StageState {
  const stages = stagesFor(sessionId);
  const existing = stages.get(stage);
  if (existing?.status === "running") return existing;

  const started = Date.now();
  const state: StageState = {
    status: "running",
    startedAt: new Date(started).toISOString(),
    finishedAt: null,
    durationMs: null,
    version: existing?.version ?? 0,
    error: null,
    meta: null,
    result: undefined,
  };
  stages.set(stage, state);

  void (async () => {
    try {
      const { result, meta } = await runStage(sessionId, stage, options);
      const finished = Date.now();
      stages.set(stage, {
        status: "done",
        startedAt: state.startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        version: (existing?.version ?? 0) + 1,
        error: null,
        meta,
        result,
      });
      persistStages(sessionId);
    } catch (err) {
      const finished = Date.now();
      stages.set(stage, {
        status: "error",
        startedAt: state.startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        version: (existing?.version ?? 0) + 1,
        error: err instanceof Error ? err.message : String(err),
        meta: null,
        result: undefined,
      });
      persistStages(sessionId);
    }
  })();

  return state;
}

async function runStage(
  sessionId: string,
  stage: StageKey,
  options: RunStageOptions
): Promise<{ result: unknown; meta: Record<string, unknown> }> {
  switch (stage) {
    case "screen":
      return runScreenStage(sessionId, options);
    case "episodes":
      return runEpisodesStage(sessionId);
    case "evaluate":
      return runEvaluateStage(sessionId, options);
    case "communication":
      return runCommunicationStage(sessionId);
    case "agentContext":
      return runAgentContextStage(sessionId, options);
    case "director":
      return runDirectorStage(sessionId);
    default:
      throw new Error(`Unknown stage: ${stage}`);
  }
}

// ---------------------------------------------------------------------------
// Shared loaders
// ---------------------------------------------------------------------------

async function loadSession(sessionId: string): Promise<any> {
  const session: any = await WorkflowCaptureSessionModel.findById(sessionId).lean();
  if (!session) throw new Error("Capture session not found.");
  return session;
}

/** The submission a session belongs to, by id or by the token the kit was seeded with. */
async function resolveSubmission(session: any): Promise<any | null> {
  if (session.submissionId) {
    const byId = await SubmissionModel.findById(session.submissionId)
      .populate("assessmentId")
      .lean();
    if (byId) return byId;
  }
  if (session.submissionToken) {
    return SubmissionModel.findOne({ token: session.submissionToken })
      .populate("assessmentId")
      .lean();
  }
  return null;
}

/** Hook events plus voice, merged chronologically — the timeline grading sees. */
async function buildMergedTimeline(session: any) {
  const events = await WorkflowEventModel.find({ sessionId: session._id })
    .sort({ at: 1 })
    .lean();
  const submission = await resolveSubmission(session);
  const voice = submission
    ? await getVoiceEventsForSubmission(String(submission._id))
    : [];
  const startedAt = session.startedAt || session.createdAt;
  const merged = [...(events as any[]), ...voice].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
  return {
    events,
    voice,
    submission,
    startedAt,
    timeline: buildTranscriptEvents(merged as any, { startedAt }),
  };
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

async function runScreenStage(sessionId: string, options: RunStageOptions) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set — screen classification is the one stage that needs it."
    );
  }
  const result = await classifyScreenGaps(sessionId, {
    replaceExisting: options.replaceExisting !== false,
  });
  return {
    result,
    meta: {
      windowsClassified: result.windowsClassified,
      eventsCreated: result.eventsCreated,
      eventsSuppressed: result.eventsSuppressed,
      model: result.model,
      tokens: result.promptTokens + result.completionTokens,
    },
  };
}

async function runEpisodesStage(sessionId: string) {
  const episodes = await computeAndStoreEpisodes(sessionId);
  return {
    result: { episodes },
    meta: { count: episodes.length },
  };
}

/**
 * The full grading pipeline, with the two per-criterion preprocessing calls
 * surfaced rather than hidden inside the orchestrator.
 *
 * Production decides evaluability once per criterion and stores it on the
 * assessment; here it is recomputed every run so a criterion edit is visible
 * immediately — that is the whole point of a lab.
 */
async function runEvaluateStage(sessionId: string, options: RunStageOptions) {
  const session = await loadSession(sessionId);
  const submission = await resolveSubmission(session);
  const assessmentCriteria: string[] = Array.isArray(
    submission?.assessmentId?.evaluationCriteria
  )
    ? submission.assessmentId.evaluationCriteria
    : [];

  const criteria = (options.criteria?.length
    ? options.criteria
    : assessmentCriteria.length
      ? assessmentCriteria
      : DEFAULT_DEV_CRITERIA
  )
    .map((c) => String(c).trim())
    .filter(Boolean);

  if (criteria.length === 0) throw new Error("No criteria to evaluate against.");

  const preStarted = Date.now();
  const [validations, groundings] = await Promise.all([
    Promise.all(criteria.map((c) => validateCriterion(c))),
    Promise.all(criteria.map((c) => groundCriterion(c))),
  ]);
  const preMs = Date.now() - preStarted;

  const gradeStarted = Date.now();
  const evaluation = await evaluateWorkflowSession(sessionId, criteria, {
    groundings,
    validations,
    submittedAt: submission?.submittedAt ?? null,
  });
  const gradeMs = Date.now() - gradeStarted;

  const report: any = evaluation.report;
  const results: any[] = Array.isArray(report?.criteria_results)
    ? report.criteria_results
    : [];
  const evaluable = results.filter((r) => r.evaluable);
  const averageScore = evaluable.length
    ? Math.round((evaluable.reduce((s, r) => s + (r.score || 0), 0) / evaluable.length) * 10) / 10
    : null;

  return {
    result: {
      criteria,
      criteriaSource: options.criteria?.length
        ? "typed in the lab"
        : assessmentCriteria.length
          ? "assessment linked to this session"
          : "lab defaults",
      validations,
      groundings,
      report,
      timings: { preprocessingMs: preMs, gradingMs: gradeMs },
      timelineEvents: evaluation.timelineEvents,
      citationsKept: evaluation.citationsKept,
      citationsDropped: evaluation.citationsDropped,
      invalidatedCriteria: evaluation.invalidatedCriteria,
    },
    meta: {
      criteria: criteria.length,
      evaluable: evaluable.length,
      averageScore,
      citationsKept: evaluation.citationsKept,
      citationsDropped: evaluation.citationsDropped,
      timelineEvents: evaluation.timelineEvents,
    },
  };
}

async function runCommunicationStage(sessionId: string) {
  const session = await loadSession(sessionId);
  const { timeline, voice } = await buildMergedTimeline(session);
  if (voice.length === 0) {
    // Say why rather than paying for a call that can only answer "no speech".
    return {
      result: {
        available: false,
        reason: "no_voice_companion_transcript",
        note: "This session has no linked proctoring session, so the in-session voice companion never ran. In a real assessment this is where spoken reasoning would be judged.",
        utteranceCount: 0,
        wordCount: 0,
        clarity: null,
        summary: null,
        highlights: [],
        claimChecks: [],
      },
      meta: { available: false, utterances: 0 },
    };
  }
  const assessment = await assessCommunication(timeline);
  return {
    result: assessment,
    meta: {
      available: assessment.available,
      utterances: assessment.utteranceCount,
      clarity: assessment.clarity,
      claimChecks: assessment.claimChecks.length,
    },
  };
}

async function runAgentContextStage(sessionId: string, options: RunStageOptions) {
  const session = await loadSession(sessionId);
  const submission = await resolveSubmission(session);
  const bundle = submission
    ? await buildContextBundle(String(submission._id), {
        question: options.question || undefined,
      })
    : await buildDevContextBundle(session);
  const bytes = Buffer.byteLength(JSON.stringify(bundle ?? {}), "utf8");
  return {
    result: {
      linkedSubmission: submission ? String(submission._id) : null,
      synthetic: !submission,
      bytes,
      bundle,
    },
    meta: {
      bytes,
      synthetic: !submission,
      sections: bundle ? Object.keys(bundle).length : 0,
    },
  };
}

/**
 * What the companion director would decide right now.
 *
 * The real loop needs a proctoring session; an unlinked lab session gets the
 * same model call against a bundle built from the capture stream, so prompt
 * changes can be tried without running a whole assessment.
 */
async function runDirectorStage(sessionId: string) {
  const session = await loadSession(sessionId);
  const submission = await resolveSubmission(session);

  let voiceTail: any[] = [];
  let pendingBriefing: any = null;
  let briefingHistory: any[] = [];
  if (submission) {
    const proctoring: any = await ProctoringSessionModel.findOne({
      submissionId: submission._id,
    })
      .select("companion")
      .lean();
    if (proctoring) {
      voiceTail = await readCompanionMessages(String(proctoring._id));
      pendingBriefing = proctoring.companion?.director?.currentBriefing ?? null;
      briefingHistory = proctoring.companion?.director?.briefingHistory ?? [];
    }
  }

  const contextBundle = submission
    ? await buildContextBundle(String(submission._id), {
        topics: ["assessment", "timeline", "episodes", "metrics"],
      })
    : await buildDevContextBundle(session);

  const startedAt = session.startedAt || session.createdAt;
  const elapsedMinutes = startedAt
    ? Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)
    : null;
  const lastDelivered = [...briefingHistory]
    .reverse()
    .find((b: any) => b?.deliveredAt);
  const minutesSinceLastDelivered = lastDelivered?.deliveredAt
    ? Math.round((Date.now() - new Date(lastDelivered.deliveredAt).getTime()) / 60000)
    : null;

  const input = {
    contextBundle,
    voiceTail,
    pendingBriefing,
    briefingHistory: briefingHistory.slice(-15),
    elapsedMinutes,
    minutesSinceLastDelivered,
  };
  const userMessage = buildDirectorUserMessage(input as any);
  const decision = await callDirectorModel(input as any);

  return {
    result: {
      model: getDirectorModel(),
      systemPrompt: DIRECTOR_SYSTEM_PROMPT,
      userMessage,
      userMessageBytes: Buffer.byteLength(userMessage, "utf8"),
      decision,
      synthetic: !submission,
      persisted: false,
    },
    meta: {
      shouldSpeak: decision?.shouldSpeak ?? null,
      question: decision?.question ?? null,
      reason: decision?.reason ?? null,
      model: getDirectorModel(),
    },
  };
}

/**
 * The context bundle for a session with no submission behind it.
 *
 * Mirrors `contextCenter`'s section shape (available/reason, `latest` with
 * `actor`, counts) so what the lab shows is what the voice agent would read —
 * a differently-shaped stand-in would teach the wrong lesson.
 */
export async function buildDevContextBundle(session: any) {
  const events = await WorkflowEventModel.find({ sessionId: session._id })
    .sort({ seq: 1 })
    .lean();
  const files = await WorkflowFileStateModel.find({ sessionId: session._id })
    .select("path sizeBytes origin updatedAt")
    .lean();
  const startedAt = session.startedAt || session.createdAt;

  const meaningful = (events as any[]).filter(
    (e) =>
      ["user_prompt", "assistant_message", "tool_use", "screen_context"].includes(e.type) &&
      !(e.type === "screen_context" && e.payload?.redundant)
  );
  const entries = meaningful.map((e) => ({
    at: e.at,
    source: e.type === "screen_context" ? "screen" : "workflow",
    type: e.type,
    actor:
      e.type === "screen_context"
        ? undefined
        : e.type === "user_prompt"
          ? "candidate"
          : "ai_assistant",
    tool: e.toolName || undefined,
    screen: e.type === "screen_context" ? e.payload?.label || "other" : undefined,
    text: typeof e.text === "string" ? e.text.slice(0, 600) : undefined,
  }));
  const latest = entries
    .slice(-8)
    .reverse()
    .map((e) => ({
      ...e,
      secondsAgo: Math.round((Date.now() - new Date(e.at).getTime()) / 1000),
    }));

  const metrics = computeMetrics(events as any, files as any, { startedAt });

  return {
    submissionId: null,
    generatedAt: new Date().toISOString(),
    topics: ["assessment", "conversation", "timeline", "code", "episodes", "metrics"],
    assessment: {
      available: false,
      reason: "dev_lab_session_not_linked_to_an_assessment",
    },
    conversation: {
      available: false,
      reason: "no_voice_companion_transcript",
    },
    timeline:
      entries.length === 0
        ? {
            available: true,
            status: "session_just_started",
            phase: "setup",
            captureStatus: session.status,
            latest: [],
            events: [],
            counts: { prompts: 0, toolCalls: 0, windowSwitches: 0 },
            guidance:
              "Nothing has been captured yet. This is the normal first minute — stay quiet and call again shortly.",
          }
        : {
            available: true,
            status: "ok",
            phase: "working",
            captureStatus: session.status,
            latest,
            events: entries.slice(-60),
            counts: {
              prompts: (events as any[]).filter((e) => e.type === "user_prompt").length,
              toolCalls: (events as any[]).filter((e) => e.type === "tool_use").length,
              windowSwitches: 0,
            },
          },
    episodes: Array.isArray(session.episodes) && session.episodes.length
      ? { available: true, episodes: session.episodes }
      : { available: false, reason: "episodes_not_computed_yet" },
    metrics: { available: true, metrics, source: "computed_live_in_dev_lab" },
    code: files.length
      ? {
          available: true,
          files: (files as any[]).map((f) => ({
            path: f.path,
            sizeBytes: f.sizeBytes,
            origin: f.origin,
          })),
        }
      : { available: false, reason: "no_code_context_yet" },
  };
}

// ---------------------------------------------------------------------------
// Deterministic snapshot (recomputed on every poll)
// ---------------------------------------------------------------------------

export interface SnapshotOptions {
  /** Only return events after this seq — the page accumulates the rest. */
  sinceSeq?: number;
  /** Include the built TranscriptEvent[] (bigger; the page asks for it per tab). */
  includeTimeline?: boolean;
}

export async function listLabSessions() {
  const sessions = await WorkflowCaptureSessionModel.find({})
    .sort({ createdAt: -1 })
    .limit(25)
    .select("candidateName status stats createdAt submissionId source lastEventAt")
    .lean();
  return (sessions as any[]).map((s) => ({
    id: String(s._id),
    candidateName: s.candidateName || null,
    status: s.status,
    source: s.source,
    eventCount: s.stats?.totalEvents ?? 0,
    createdAt: s.createdAt,
    lastEventAt: s.lastEventAt || null,
    linked: Boolean(s.submissionId),
  }));
}

export async function buildLabSnapshot(
  sessionId: string,
  options: SnapshotOptions = {}
): Promise<Record<string, unknown> | null> {
  const session: any = await WorkflowCaptureSessionModel.findById(sessionId).lean();
  if (!session) return null;

  const sinceSeq = Number.isFinite(options.sinceSeq as number)
    ? (options.sinceSeq as number)
    : -1;

  const [allEvents, files] = await Promise.all([
    WorkflowEventModel.find({ sessionId: session._id }).sort({ seq: 1 }).lean(),
    WorkflowFileStateModel.find({ sessionId: session._id })
      .sort({ path: 1 })
      .select("path sizeBytes origin revision updatedAt truncated")
      .lean(),
  ]);

  const startedAt = session.startedAt || session.createdAt;
  const video = session.video || {};
  const segments = (video.segments || []) as any[];

  const newEvents = (allEvents as any[]).filter((e) => (e.seq ?? 0) > sinceSeq);
  const maxSeq = (allEvents as any[]).reduce(
    (m, e) => Math.max(m, e.seq ?? 0),
    sinceSeq
  );

  const submission = await resolveSubmission(session);
  const proctoring: any = submission
    ? await ProctoringSessionModel.findOne({ submissionId: submission._id })
        .select(
          "status consent stats transcript mergedVideo companion sidecarEvents frames screens"
        )
        .lean()
    : null;

  const voice = submission
    ? await getVoiceEventsForSubmission(String(submission._id))
    : [];

  const metrics = computeMetrics(allEvents as any, files as any, { startedAt });
  const captureIntegrity = assessCaptureIntegrity(allEvents as any, {
    submittedAt: submission?.submittedAt ?? null,
    startedAt,
  });

  // The band is what the screen classifier said was visible at every moment.
  const screenBand = (allEvents as any[])
    .filter((e) => e.type === "screen_context" && e.payload?.videoStart != null)
    .map((e) => ({
      start: e.payload.videoStart,
      end: e.payload.videoEnd,
      label: e.payload.label,
      detail: e.payload.detail,
      redundant: Boolean(e.payload.redundant),
      concurrentWithAgent: Boolean(e.payload.concurrentWithAgent),
      durationSeconds: e.payload.durationSeconds ?? null,
    }))
    .sort((a, b) => a.start - b.start);

  let timeline: unknown[] | undefined;
  if (options.includeTimeline) {
    const merged = [...(allEvents as any[]), ...voice].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );
    timeline = buildTranscriptEvents(merged as any, { startedAt }).map((t) => ({
      ...t,
      videoOffsetSeconds: videoOffsetForSessionSeconds(t.ts, startedAt, segments),
    }));
  }

  return {
    sessionId: String(session._id),
    // Dev-only: the page uploads video chunks as this session.
    captureToken: session.captureToken,
    session: {
      status: session.status,
      source: session.source,
      candidateName: session.candidateName || null,
      consent: session.consent || null,
      environment: session.environment || null,
      startedAt,
      createdAt: session.createdAt,
      lastEventAt: session.lastEventAt || null,
      completedAt: session.completedAt || null,
      submissionToken: session.submissionToken || null,
      submissionId: session.submissionId ? String(session.submissionId) : null,
      updatedAt: session.updatedAt,
    },
    stats: session.stats || {},
    counts: {
      events: allEvents.length,
      files: files.length,
      voiceUtterances: voice.length,
      screenContext: (allEvents as any[]).filter((e) => e.type === "screen_context").length,
    },
    // Incremental: only what the page has not seen.
    events: newEvents.map((e: any) => ({
      id: String(e._id),
      seq: e.seq,
      at: e.at,
      receivedAt: e.receivedAt || null,
      type: e.type,
      tool: e.toolName || null,
      text: e.text || null,
      payload: e.payload ?? null,
      truncated: Boolean(e.truncated),
      cwd: e.cwd || null,
      gitBranch: e.gitBranch || null,
      toolSessionId: e.toolSessionId || null,
      videoOffsetSeconds: offsetIntoVideo(e.at, segments),
    })),
    maxSeq,
    files,
    screenBand,
    episodes: session.episodes || [],
    episodesComputedAt: session.episodesComputedAt || null,
    metrics,
    captureIntegrity,
    timeline,
    voice: voice.map((v) => ({
      at: v.at,
      role: v.payload.role,
      text: v.text,
    })),
    video: {
      status: video.status || "not_started",
      startedAt: video.startedAt || null,
      endedAt: video.endedAt || null,
      chunkCount: (video.chunks || []).length,
      chunkBytes: (video.chunks || []).reduce(
        (n: number, c: any) => n + (c.sizeBytes || 0),
        0
      ),
      mergedKey: video.mergedKey || null,
      mergedSizeBytes: video.mergedSizeBytes || 0,
      error: video.error || null,
      segments: segments.map((s: any) => ({
        wallStartedAt: s.wallStartedAt,
        wallEndedAt: s.wallEndedAt || null,
        videoOffsetStart: s.videoOffsetStart,
        endReason: s.endReason || null,
      })),
      totalRecordedSeconds: nextVideoOffsetStart(segments),
    },
    submission: submission
      ? {
          id: String(submission._id),
          token: submission.token,
          candidateName: submission.candidateName,
          status: submission.status,
          startedAt: submission.startedAt || null,
          submittedAt: submission.submittedAt || null,
          evidenceMode: submission.assessmentId?.evidenceMode || null,
          assessmentTitle: submission.assessmentId?.title || null,
          criteria: submission.assessmentId?.evaluationCriteria || [],
          evaluationStatus: submission.evaluationStatus || null,
        }
      : null,
    proctoring: proctoring
      ? {
          id: String(proctoring._id),
          status: proctoring.status,
          consentGranted: Boolean(proctoring.consent?.granted),
          frames: (proctoring.frames || []).length,
          sidecarEvents: (proctoring.sidecarEvents || []).length,
          transcriptStatus: proctoring.transcript?.status || "not_started",
          mergedVideo: proctoring.mergedVideo?.status || "not_started",
          companionStatus: proctoring.companion?.status || "not_started",
          currentBriefing: proctoring.companion?.director?.currentBriefing || null,
          briefingHistory: (proctoring.companion?.director?.briefingHistory || []).slice(-10),
        }
      : null,
    stages: getStageSummaries(String(session._id)),
    config: {
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      directorEnabled: process.env.COMPANION_DIRECTOR_ENABLED === "true",
      directorModel: getDirectorModel(),
    },
    defaultCriteria: DEFAULT_DEV_CRITERIA,
  };
}

export async function readLabFile(
  sessionId: string,
  path: string
): Promise<Record<string, unknown> | null> {
  const file: any = await WorkflowFileStateModel.findOne({ sessionId, path }).lean();
  if (!file) return null;
  return {
    path: file.path,
    content: file.content,
    sizeBytes: file.sizeBytes,
    origin: file.origin,
    revision: file.revision,
    truncated: Boolean(file.truncated),
    updatedAt: file.updatedAt,
  };
}
