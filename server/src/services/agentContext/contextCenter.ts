import SubmissionModel from "../../models/submission.js";
import RepoIndexModel from "../../models/repoIndex.js";
import ProctoringSessionModel from "../../models/proctoringSession.js";
import {
  WorkflowCaptureSessionModel,
  WorkflowEventModel,
  WorkflowFileStateModel,
} from "../../models/workflowCapture.js";
import { searchCodeChunks } from "../repoRetrieval.js";
import { readCompanionMessages } from "../companion/transcript.js";

/**
 * Context center for the ElevenLabs voice agent.
 *
 * One place that answers "what should the agent know right now?" for a
 * submission: the assessment brief, everything the candidate has said, the
 * recent work timeline (AI-workflow capture + proctoring sidecar events), and
 * code context (Pinecone once indexed, live captured files before that).
 *
 * Design rules:
 * - Every section is independently fail-soft. A missing source yields
 *   `available: false` with a `reason`, never a thrown error — a tool failure
 *   mid-call would stall the voice conversation.
 * - `available: false` means "this source is missing", and a voice model reads
 *   it as breakage. So an empty-but-healthy read of a LIVE session's timeline is
 *   reported as `available: true` with an empty `events` list, a `phase`, and a
 *   `guidance` line instead. Genuine failures still return `available: false`.
 * - Everything is budgeted. This feeds a realtime voice model; it needs a
 *   usable prompt, not a dump.
 */

export type ContextTopic =
  | "assessment"
  | "conversation"
  | "timeline"
  | "code"
  | "episodes"
  | "metrics";

const ALL_TOPICS: ContextTopic[] = [
  "assessment",
  "conversation",
  "timeline",
  "code",
  "episodes",
  "metrics",
];

// Budgets (chars unless noted)
const DESCRIPTION_MAX = 2400;
const CONVERSATION_MAX_MESSAGES = 30;
const CONVERSATION_MSG_MAX = 500;
const TIMELINE_MAX_EVENTS = 60;
const TIMELINE_TEXT_MAX = 300;
const EPISODES_MAX = 40;
const EPISODE_SUMMARY_MAX = 400;
/** Above this, computing metrics live would cost more latency than a voice turn can spend. */
const METRICS_LIVE_EVENT_CAP = 4000;
const CODE_MAX_CHUNKS = 5;
const CODE_CHUNK_MAX = 3000;
const CODE_TOTAL_MAX = 12000;
const LIVE_FILES_MAX = 6;
const LIVE_FILE_CONTENT_MAX = 1600;

type Section<T> =
  | ({ available: true } & T)
  | { available: false; reason: string };

/**
 * Statuses where the record is still being written. For these, "nothing yet" is
 * a normal reading, not a missing source.
 */
const LIVE_SUBMISSION_STATUSES = new Set(["pending", "in-progress"]);

function isLiveSubmission(submission: any): boolean {
  return LIVE_SUBMISSION_STATUSES.has(String(submission?.status));
}

/**
 * Plain-language instructions returned alongside the timeline. The consumer is a
 * realtime voice model that will otherwise invent an explanation for an empty
 * result and say it out loud to the candidate; telling it what to do with the
 * emptiness is cheaper than hoping it infers silence.
 */
const EMPTY_TIMELINE_GUIDANCE =
  "Nothing has been recorded yet. This is expected early in a session, while the candidate is still setting up — it is not an error and there is nothing wrong. You simply have no question this turn: stay quiet and call again in a couple of minutes. Never mention this to the candidate.";
const SETUP_TIMELINE_GUIDANCE =
  "Only setup or window-focus activity so far — no work on the task has been recorded yet. There is nothing worth asking about: stay quiet and call again in a couple of minutes. Never mention this to the candidate.";
const WORKING_TIMELINE_GUIDANCE =
  "Real work is being recorded. If something in `latest` is new since you last spoke, ask one short question about that specific thing; otherwise stay quiet.";

async function buildAssessmentSection(submission: any): Promise<Section<any>> {
  const assessment = submission.assessmentId as {
    title?: string;
    description?: string;
    timeLimit?: number;
    behavioralChecks?: string[];
  } | null;
  if (!assessment || typeof assessment !== "object" || !assessment.title) {
    return { available: false, reason: "assessment_not_found" };
  }
  let description = assessment.description || "";
  const truncated = description.length > DESCRIPTION_MAX;
  if (truncated) description = description.slice(0, DESCRIPTION_MAX);
  return {
    available: true,
    title: assessment.title,
    description,
    descriptionTruncated: truncated,
    timeLimitMinutes: assessment.timeLimit ?? null,
    behavioralChecks: (assessment.behavioralChecks || []).slice(0, 12),
    candidateName: submission.candidateName || null,
    submissionStatus: submission.status,
    startedAt: submission.startedAt ?? null,
  };
}

async function buildConversationSection(
  submission: any
): Promise<Section<any>> {
  const out: {
    companion: Array<{ role: string; text: string; timestampMs: number }>;
  } = { companion: [] };

  try {
    const proctoringSession = await ProctoringSessionModel.findOne({
      submissionId: submission._id,
    })
      .select("_id")
      .lean();
    if (proctoringSession) {
      const all = await readCompanionMessages(String(proctoringSession._id));
      out.companion = all.slice(-CONVERSATION_MAX_MESSAGES).map((m) => ({
        ...m,
        text:
          m.text.length > CONVERSATION_MSG_MAX
            ? m.text.slice(0, CONVERSATION_MSG_MAX)
            : m.text,
      }));
    }
  } catch {
    // storage/db hiccup — leave companion empty
  }

  if (out.companion.length === 0) {
    return { available: false, reason: "no_conversation_recorded_yet" };
  }
  return { available: true, ...out };
}

async function buildTimelineSection(submission: any): Promise<Section<any>> {
  type TimelineEntry = {
    at: Date;
    source: "workflow" | "screen" | "proctoring";
    type: string;
    /** workflow only: candidate = their own prompt; ai_assistant = the agent's autonomous tool calls/replies. */
    actor?: "candidate" | "ai_assistant";
    tool?: string;
    text?: string;
    /** screen_context only: what surface was on screen, and for how long. */
    screen?: string;
    durationSeconds?: number;
    concurrentWithAgent?: boolean;
  };
  const entries: TimelineEntry[] = [];

  // AI-workflow capture events (the candidate's Claude Code activity).
  let captureStatus: string | null = null;
  let workflowQueryFailed = false;
  try {
    const captureSession = await WorkflowCaptureSessionModel.findOne({
      $or: [
        { submissionId: submission._id },
        { submissionToken: submission.token },
      ],
    })
      .sort({ createdAt: -1 })
      .select("_id status")
      .lean();
    if (captureSession) {
      captureStatus = (captureSession as any).status;
      const events = await WorkflowEventModel.find({
        sessionId: (captureSession as any)._id,
        type: {
          $in: [
            "user_prompt",
            "assistant_message",
            "tool_use",
            // Gemini's read of what was actually on screen. This is the only
            // record of work done OUTSIDE the captured agent — a browser AI
            // chat, docs, the running app — so it belongs in the timeline the
            // interviewer sees, not just in grading.
            "screen_context",
          ],
        },
        // `redundant` observations exist to keep the coverage band unbroken
        // (editor/terminal seen while hooks were already reporting). They add
        // nothing an interviewer can ask about, and they would crowd out real
        // events under the entry cap.
        "payload.redundant": { $ne: true },
      })
        .sort({ seq: -1 })
        .limit(TIMELINE_MAX_EVENTS)
        .select("at type toolName text payload")
        .lean();
      for (const e of events as any[]) {
        const text =
          typeof e.text === "string" && e.text.length > TIMELINE_TEXT_MAX
            ? e.text.slice(0, TIMELINE_TEXT_MAX)
            : e.text || undefined;
        if (e.type === "screen_context") {
          entries.push({
            at: e.at,
            source: "screen",
            type: "screen_context",
            screen: e.payload?.label || "other",
            text,
            durationSeconds: e.payload?.durationSeconds ?? undefined,
            concurrentWithAgent: Boolean(e.payload?.concurrentWithAgent),
          });
        } else {
          entries.push({
            at: e.at,
            source: "workflow",
            type: e.type,
            // Who performed it. Prompts are the candidate's own words;
            // everything else (file reads, edits, commands, replies) is their
            // AI assistant acting autonomously. Without this label the voice
            // agent inferred — and told a candidate "you've made edits to
            // time.js" about files Claude touched that they had never opened.
            actor: e.type === "user_prompt" ? "candidate" : "ai_assistant",
            tool: e.toolName || undefined,
            text,
          });
        }
      }
    }
  } catch {
    // capture models unavailable — proceed with proctoring events only
    workflowQueryFailed = true;
  }

  // Proctoring sidecar events (tab switches, focus changes, paste).
  //
  // These are gathered separately from the meaningful events above and merged
  // last, on purpose. A blur/focus pair fires on every alt-tab, so on a real
  // session they outnumber prompts several times over; merged naively they eat
  // the entry cap and the agent ends up seeing window churn and no prompts.
  const sidecarEntries: TimelineEntry[] = [];
  let sidecarQueryFailed = false;
  try {
    const proctoringSession = await ProctoringSessionModel.findOne({
      submissionId: submission._id,
    })
      .select("sidecarEvents")
      .lean();
    const sidecar = (proctoringSession as any)?.sidecarEvents;
    if (Array.isArray(sidecar)) {
      let previousType: string | null = null;
      for (const e of sidecar) {
        // The client can emit the same transition twice; a repeated blur says
        // nothing the first one didn't.
        if (e.type === previousType) continue;
        previousType = e.type;
        sidecarEntries.push({
          at: e.timestamp,
          source: "proctoring",
          type: e.type,
        });
      }
    }
  } catch {
    // ignore
    sidecarQueryFailed = true;
  }

  if (entries.length === 0 && sidecarEntries.length === 0) {
    // Both sources blew up: this is a genuine failure and must stay
    // distinguishable from "the session just hasn't produced anything yet".
    if (workflowQueryFailed && sidecarQueryFailed) {
      return { available: false, reason: "timeline_unavailable" };
    }
    // A live session with nothing recorded yet is the NORMAL first minute of
    // every assessment, not a broken tool. Reporting it as `available: false`
    // reads as breakage to a realtime voice model, which then apologises to the
    // candidate for "not being able to access the timeline". Answer it as a
    // successful read of an empty record, with a phase and an instruction.
    if (isLiveSubmission(submission)) {
      return {
        available: true,
        status: "session_just_started",
        phase: "setup",
        captureStatus,
        latest: [],
        events: [],
        counts: { prompts: 0, toolCalls: 0, windowSwitches: 0 },
        guidance: EMPTY_TIMELINE_GUIDANCE,
      };
    }
    return { available: false, reason: "no_timeline_recorded_yet" };
  }

  // Meaningful events get first claim on the budget; sidecar fills what is left.
  const meaningful = entries
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-TIMELINE_MAX_EVENTS);
  const sidecarBudget = Math.max(0, TIMELINE_MAX_EVENTS - meaningful.length);
  // slice(-0) === slice(0) — a zero budget must mean "no sidecar", not "all of it".
  const sidecarKept = sidecarBudget > 0 ? sidecarEntries.slice(-sidecarBudget) : [];
  const merged = [...meaningful, ...sidecarKept].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  // Relative ages let the agent say "you just..." vs "earlier you..." without
  // doing clock arithmetic on ISO strings mid-conversation.
  const now = Date.now();
  const withAge = merged.map((e) => ({
    ...e,
    secondsAgo: Math.max(0, Math.round((now - new Date(e.at).getTime()) / 1000)),
  }));

  // Only window churn so far means the same thing as an empty timeline for the
  // agent: nothing to ask about. Say so in the same vocabulary.
  const phase: "setup" | "working" = meaningful.length > 0 ? "working" : "setup";

  return {
    available: true,
    status: phase === "working" ? "activity_recorded" : "setup_activity_only",
    phase,
    guidance:
      phase === "working" ? WORKING_TIMELINE_GUIDANCE : SETUP_TIMELINE_GUIDANCE,
    captureStatus,
    /** Most recent meaningful activity — what a proactive question should be about. */
    latest: withAge
      .filter((e) => e.source !== "proctoring")
      .slice(-8)
      .reverse(),
    events: withAge,
    counts: {
      prompts: merged.filter((e) => e.type === "user_prompt").length,
      toolCalls: merged.filter((e) => e.type === "tool_use").length,
      windowSwitches: sidecarEntries.filter((e) => e.type === "window_blur")
        .length,
    },
  };
}

/** Resolve the capture session for a submission, by id or token. */
async function findCaptureSession(submission: any, select: string) {
  return WorkflowCaptureSessionModel.findOne({
    $or: [
      { submissionId: submission._id },
      { submissionToken: submission.token },
    ],
  })
    .sort({ createdAt: -1 })
    .select(select)
    .lean();
}

/**
 * The narrative arc of the session: ~15-40 stretches like "fixing stale summary
 * counts", each with a time range.
 *
 * This is the single most useful section for a voice agent. Raw events are far
 * too granular to reason about mid-conversation ("Edit routes/users.js" says
 * nothing worth asking about), whereas an episode is already at the altitude a
 * human interviewer thinks at. Episodes are computed once when capture ends and
 * persisted, so this is a cheap read, not an LLM call on the critical path.
 */
async function buildEpisodesSection(submission: any): Promise<Section<any>> {
  try {
    const captureSession: any = await findCaptureSession(
      submission,
      "episodes episodesComputedAt status startedAt"
    );
    if (!captureSession) {
      return { available: false, reason: "no_capture_session" };
    }
    const episodes = Array.isArray(captureSession.episodes)
      ? captureSession.episodes
      : [];
    if (episodes.length === 0) {
      // Episodes land when capture ends; before that there is nothing to read.
      return {
        available: false,
        reason:
          captureSession.status === "completed"
            ? "episodes_not_computed"
            : "capture_still_in_progress",
      };
    }
    return {
      available: true,
      computedAt: captureSession.episodesComputedAt ?? null,
      sessionStartedAt: captureSession.startedAt ?? null,
      episodes: episodes.slice(0, EPISODES_MAX).map((e: any) => ({
        index: e.index,
        label: e.label,
        kind: e.kind,
        startSeconds: e.startSeconds,
        endSeconds: e.endSeconds,
        summary:
          typeof e.summary === "string" && e.summary.length > EPISODE_SUMMARY_MAX
            ? e.summary.slice(0, EPISODE_SUMMARY_MAX)
            : e.summary,
      })),
    };
  } catch {
    return { available: false, reason: "episodes_unavailable" };
  }
}

/**
 * Deterministic behavioural numbers (read:edit, verified writes, think time,
 * authorship, tokens). Counted, never asked of a model.
 *
 * Prefers the copy already persisted on the evaluation report; only falls back
 * to computing live for sessions small enough that the extra queries fit inside
 * a voice turn.
 */
async function buildMetricsSection(submission: any): Promise<Section<any>> {
  const persisted = submission.evaluationReport?.workflowMetrics;
  if (persisted && typeof persisted === "object") {
    return { available: true, source: "evaluation_report", metrics: persisted };
  }

  try {
    const captureSession: any = await findCaptureSession(
      submission,
      "_id startedAt stats"
    );
    if (!captureSession) return { available: false, reason: "no_capture_session" };

    const total = captureSession.stats?.totalEvents ?? 0;
    if (total > METRICS_LIVE_EVENT_CAP) {
      return {
        available: false,
        reason: "session_too_large_for_live_metrics_grade_first",
      };
    }

    const [events, files] = await Promise.all([
      WorkflowEventModel.find({ sessionId: captureSession._id })
        .sort({ seq: 1 })
        .select("at type toolName text payload")
        .lean(),
      WorkflowFileStateModel.find({ sessionId: captureSession._id })
        .select("path sizeBytes origin")
        .lean(),
    ]);
    if (events.length === 0) return { available: false, reason: "no_events" };

    const { computeMetrics } = await import(
      "../workflowCapture/metrics.js"
    );
    const metrics = computeMetrics(events as any, files as any, {
      startedAt: captureSession.startedAt,
    });
    return { available: true, source: "computed_live", metrics };
  } catch {
    return { available: false, reason: "metrics_unavailable" };
  }
}

async function buildCodeSection(
  submission: any,
  question: string | undefined
): Promise<Section<any>> {
  // Preferred: semantic search over the indexed snapshot (post-submission).
  try {
    const repoIndex = await RepoIndexModel.findOne({
      submissionId: submission._id,
    })
      .sort({ createdAt: -1 })
      .select("status")
      .lean();
    if (repoIndex && (repoIndex as any).status === "ready" && question) {
      const result = await searchCodeChunks(String(submission._id), question, {
        topK: 8,
        maxChunks: CODE_MAX_CHUNKS,
        maxTotalChars: CODE_TOTAL_MAX,
        maxChunkChars: CODE_CHUNK_MAX,
      });
      if (result.chunks.length > 0) {
        return {
          available: true,
          mode: "indexed_search",
          chunks: result.chunks.map((c) => ({
            path: c.path,
            startLine: c.startLine,
            endLine: c.endLine,
            content: c.content,
            score: c.score,
          })),
        };
      }
    }
  } catch {
    // Pinecone/index failure — fall through to live files
  }

  // Fallback: live file state from workflow capture (mid-assessment).
  try {
    const captureSession = await WorkflowCaptureSessionModel.findOne({
      $or: [
        { submissionId: submission._id },
        { submissionToken: submission.token },
      ],
    })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();
    if (captureSession) {
      const files = await WorkflowFileStateModel.find({
        sessionId: (captureSession as any)._id,
      })
        .sort({ updatedAt: -1 })
        .limit(LIVE_FILES_MAX)
        .select("path content sizeBytes updatedAt origin truncated")
        .lean();
      const withContent = (files as any[]).filter(
        (f) => typeof f.content === "string" && f.content.length > 0
      );
      if (withContent.length > 0) {
        return {
          available: true,
          mode: "live_files",
          files: withContent.map((f) => ({
            path: f.path,
            updatedAt: f.updatedAt,
            origin: f.origin,
            sizeBytes: f.sizeBytes,
            content:
              f.content.length > LIVE_FILE_CONTENT_MAX
                ? f.content.slice(0, LIVE_FILE_CONTENT_MAX)
                : f.content,
            truncated:
              Boolean(f.truncated) || f.content.length > LIVE_FILE_CONTENT_MAX,
          })),
        };
      }
    }
  } catch {
    // ignore
  }

  return {
    available: false,
    reason: question
      ? "no_code_context_yet"
      : "no_code_context_yet_provide_question_for_indexed_search",
  };
}

export interface ContextCenterResult {
  submissionId: string;
  generatedAt: string;
  topics: ContextTopic[];
  assessment?: Section<any>;
  conversation?: Section<any>;
  timeline?: Section<any>;
  code?: Section<any>;
  episodes?: Section<any>;
  metrics?: Section<any>;
}

/**
 * Build the budgeted context bundle for one submission.
 * Throws only if the submission itself doesn't exist.
 */
export async function buildContextBundle(
  submissionId: string,
  options: { question?: string; topics?: ContextTopic[] } = {}
): Promise<ContextCenterResult | null> {
  const submission = await SubmissionModel.findById(submissionId)
    .populate("assessmentId")
    .lean();
  if (!submission) return null;

  const topics =
    options.topics && options.topics.length > 0
      ? ALL_TOPICS.filter((t) => options.topics!.includes(t))
      : ALL_TOPICS;

  const result: ContextCenterResult = {
    submissionId,
    generatedAt: new Date().toISOString(),
    topics,
  };

  // Sections are independent; build the requested ones concurrently.
  const jobs: Array<Promise<void>> = [];
  if (topics.includes("assessment")) {
    jobs.push(
      buildAssessmentSection(submission).then((s) => {
        result.assessment = s;
      })
    );
  }
  if (topics.includes("conversation")) {
    jobs.push(
      buildConversationSection(submission).then((s) => {
        result.conversation = s;
      })
    );
  }
  if (topics.includes("timeline")) {
    jobs.push(
      buildTimelineSection(submission).then((s) => {
        result.timeline = s;
      })
    );
  }
  if (topics.includes("code")) {
    jobs.push(
      buildCodeSection(submission, options.question).then((s) => {
        result.code = s;
      })
    );
  }
  if (topics.includes("episodes")) {
    jobs.push(
      buildEpisodesSection(submission).then((s) => {
        result.episodes = s;
      })
    );
  }
  if (topics.includes("metrics")) {
    jobs.push(
      buildMetricsSection(submission).then((s) => {
        result.metrics = s;
      })
    );
  }
  await Promise.all(jobs);

  return result;
}
