import SubmissionModel from "../../models/submission.js";
import RepoIndexModel from "../../models/repoIndex.js";
import ProctoringSessionModel from "../../models/proctoringSession.js";
import {
  WorkflowCaptureSessionModel,
  WorkflowEventModel,
  WorkflowFileStateModel,
} from "../../models/workflowCapture.js";
import { searchCodeChunks } from "../repoRetrieval.js";
import { getFrameStorage } from "../capture/storage.js";

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
 * - Everything is budgeted. This feeds a realtime voice model; it needs a
 *   usable prompt, not a dump.
 */

export type ContextTopic = "assessment" | "conversation" | "timeline" | "code";

const ALL_TOPICS: ContextTopic[] = [
  "assessment",
  "conversation",
  "timeline",
  "code",
];

// Budgets (chars unless noted)
const DESCRIPTION_MAX = 2400;
const CONVERSATION_MAX_MESSAGES = 30;
const CONVERSATION_MSG_MAX = 500;
const TIMELINE_MAX_EVENTS = 60;
const TIMELINE_TEXT_MAX = 300;
const CODE_MAX_CHUNKS = 5;
const CODE_CHUNK_MAX = 3000;
const CODE_TOTAL_MAX = 12000;
const LIVE_FILES_MAX = 6;
const LIVE_FILE_CONTENT_MAX = 1600;

type Section<T> =
  | ({ available: true } & T)
  | { available: false; reason: string };

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

/** Read the persisted companion (voice check-in) transcript from storage. */
async function readCompanionMessages(
  proctoringSessionId: string
): Promise<Array<{ role: string; text: string; timestampMs: number }>> {
  const storage = getFrameStorage();
  let keys: string[] = [];
  try {
    keys = await storage.listKeys(`${proctoringSessionId}/companion`);
  } catch {
    return [];
  }
  // Voice chunks and other artifacts may live under the same prefix.
  keys = keys.filter((k) => k.endsWith(".jsonl")).sort();

  const messages: Array<{ role: string; text: string; timestampMs: number }> =
    [];
  for (const key of keys) {
    try {
      const content = await storage.getTranscript(key);
      for (const line of content.split("\n").filter(Boolean)) {
        try {
          const msg = JSON.parse(line);
          if (msg.role && msg.text != null && typeof msg.timestampMs === "number") {
            messages.push({
              role: msg.role,
              text: String(msg.text),
              timestampMs: msg.timestampMs,
            });
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // skip unreadable chunk
    }
  }
  messages.sort((a, b) => a.timestampMs - b.timestampMs);
  return messages;
}

async function buildConversationSection(
  submission: any
): Promise<Section<any>> {
  const out: {
    companion: Array<{ role: string; text: string; timestampMs: number }>;
    interviewTurns: Array<{ role: string; text: string }>;
  } = { companion: [], interviewTurns: [] };

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

  const turns = submission.interview?.transcript?.turns;
  if (Array.isArray(turns) && turns.length > 0) {
    out.interviewTurns = turns
      .slice(-CONVERSATION_MAX_MESSAGES)
      .map((t: any) => ({
        role: t.role,
        text:
          typeof t.text === "string" && t.text.length > CONVERSATION_MSG_MAX
            ? t.text.slice(0, CONVERSATION_MSG_MAX)
            : t.text,
      }));
  }

  if (out.companion.length === 0 && out.interviewTurns.length === 0) {
    return { available: false, reason: "no_conversation_recorded_yet" };
  }
  return { available: true, ...out };
}

async function buildTimelineSection(submission: any): Promise<Section<any>> {
  type TimelineEntry = {
    at: Date;
    source: "workflow" | "proctoring";
    type: string;
    tool?: string;
    text?: string;
  };
  const entries: TimelineEntry[] = [];

  // AI-workflow capture events (the candidate's Claude Code activity).
  let captureStatus: string | null = null;
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
        type: { $in: ["user_prompt", "assistant_message", "tool_use"] },
      })
        .sort({ seq: -1 })
        .limit(TIMELINE_MAX_EVENTS)
        .select("at type toolName text")
        .lean();
      for (const e of events as any[]) {
        entries.push({
          at: e.at,
          source: "workflow",
          type: e.type,
          tool: e.toolName || undefined,
          text:
            typeof e.text === "string" && e.text.length > TIMELINE_TEXT_MAX
              ? e.text.slice(0, TIMELINE_TEXT_MAX)
              : e.text || undefined,
        });
      }
    }
  } catch {
    // capture models unavailable — proceed with proctoring events only
  }

  // Proctoring sidecar events (tab switches, focus changes, paste).
  try {
    const proctoringSession = await ProctoringSessionModel.findOne({
      submissionId: submission._id,
    })
      .select("sidecarEvents")
      .lean();
    const sidecar = (proctoringSession as any)?.sidecarEvents;
    if (Array.isArray(sidecar)) {
      for (const e of sidecar.slice(-TIMELINE_MAX_EVENTS)) {
        entries.push({
          at: e.timestamp,
          source: "proctoring",
          type: e.type,
        });
      }
    }
  } catch {
    // ignore
  }

  if (entries.length === 0) {
    return { available: false, reason: "no_timeline_recorded_yet" };
  }

  entries.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
  return {
    available: true,
    captureStatus,
    events: entries.slice(-TIMELINE_MAX_EVENTS),
  };
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
      if (files.length > 0) {
        return {
          available: true,
          mode: "live_files",
          files: (files as any[]).map((f) => ({
            path: f.path,
            updatedAt: f.updatedAt,
            origin: f.origin,
            sizeBytes: f.sizeBytes,
            content:
              typeof f.content === "string" &&
              f.content.length > LIVE_FILE_CONTENT_MAX
                ? f.content.slice(0, LIVE_FILE_CONTENT_MAX)
                : f.content,
            truncated:
              Boolean(f.truncated) ||
              (typeof f.content === "string" &&
                f.content.length > LIVE_FILE_CONTENT_MAX),
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
  await Promise.all(jobs);

  return result;
}
