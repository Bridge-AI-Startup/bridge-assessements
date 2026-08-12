/**
 * Screen context classification — filling the hook blind spot.
 *
 * The hook stream is a perfect record of the agent conversation and the code,
 * and says nothing about the stretches where the candidate was not prompting:
 * reading docs, searching, using an AI tool in a browser tab, or testing the
 * thing they just built. That silence is exactly where several of the most
 * interesting signals live.
 *
 * So we classify **only the gaps**. A 90-minute session might have 35 minutes of
 * silence; at one frame per five seconds and LOW media resolution that is a few
 * hundred frames and well under a cent. Classifying the whole recording would
 * cost dollars and mostly re-describe what the hooks already captured perfectly.
 *
 * This is classification, NOT transcription. LOW resolution is deliberate and is
 * the opposite of the transcript engine's HIGH: we only need to know which
 * surface is on screen, not to read the text on it.
 */

import fs from "fs/promises";
import { createWriteStream } from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { GoogleGenAI, FileState, MediaResolution, type Part } from "@google/genai";

import {
  WorkflowCaptureSessionModel,
  WorkflowEventModel,
} from "../../models/workflowCapture.js";
import { getFrameStorage } from "../capture/storage.js";
import { buildPlaybackVideo, offsetIntoVideo, type VideoSegment } from "./video.js";
import { logTs } from "../../ai/transcript/logger.js";

/** Labels kept few and evaluation-relevant; a long taxonomy just adds noise. */
export const SCREEN_LABELS = [
  "ide",
  "terminal",
  /**
   * A CLI coding agent (Claude Code, Codex, Aider) running in a terminal.
   * Split out from `browser:ai_chat` deliberately: we capture CLI agents
   * perfectly through hooks, whereas AI in a browser is invisible to them. If
   * the model conflates the two, the label that exists to reveal uncaptured AI
   * use stops meaning anything.
   */
  "cli_agent",
  "browser:search",
  "browser:docs",
  "browser:ai_chat",
  "browser:own_app",
  "other",
  "idle",
] as const;

const MODEL = () =>
  process.env.WORKFLOW_SCREEN_MODEL || "gemini-3.1-flash-lite";
/**
 * Frames per second Gemini samples from the video — Gemini's own default.
 *
 * "Native video input" does not mean the model watches continuously: it samples
 * frames and charges per frame, and `fps` sets how densely. This started at 0.2
 * in gaps and 0.05 elsewhere to save tokens, which was a false economy — a
 * candidate flicking to their running app for fifteen seconds produced at most
 * one frame, so short switches (exactly the verification behaviour worth
 * measuring) were routinely missed.
 *
 * At LOW resolution a 90-minute session is ~5,400 frames × 70 tokens ≈ 380k
 * tokens, about ten cents. Temporal resolution is worth ten cents.
 */
const FPS = () => Number(process.env.WORKFLOW_SCREEN_FPS) || 1;
/** Silence shorter than this is not worth a model call. */
const MIN_GAP_SECONDS = () => Number(process.env.WORKFLOW_SCREEN_MIN_GAP_SEC) || 45;
/** Guard against a runaway bill on a pathological session. */
const MAX_WINDOWS = () => Number(process.env.WORKFLOW_SCREEN_MAX_WINDOWS) || 40;

const PROMPT = `You identify what application or surface is visible in a screen recording of a developer working. You are NOT transcribing — do not copy text out of the screen.

For each distinct stretch, return one segment with:
- label: exactly one of
    "ide"              a code editor with code visible
    "terminal"         a plain terminal — shell prompts, command output, logs
    "cli_agent"        a coding agent running IN A TERMINAL (Claude Code, Codex,
                       Aider): a conversational exchange rendered as terminal
                       text, not a web page. If it is in a terminal window it is
                       "cli_agent", never "browser:ai_chat".
    "browser:search"   a search engine results or query page
    "browser:docs"     documentation, reference, StackOverflow, a GitHub repo being read
    "browser:ai_chat"  an AI assistant as a WEB PAGE (chatgpt.com, claude.ai,
                       gemini.google.com, perplexity) — a browser chrome, tabs
                       and an address bar are visible
    "browser:own_app"  a locally-running app being used or tested (localhost, a dev server)
    "other"            anything else, including unrelated windows
    "idle"             no meaningful change; screensaver, empty desktop, nothing happening
- detail: at most 12 words of specific context — a visible search query, page title, or
  URL host. Empty string if nothing specific is legible. Never guess.
- confidence: 0 to 1.

Merge CONSECUTIVE moments showing the same surface into one segment rather than emitting one per frame.

But do not smooth over switches. If the screen changes to a different surface and back — even for only a few seconds — emit a separate segment for it. Brief switches are the most important thing you report: someone flicking to their running app to check a change, or to a browser tab mid-task, is precisely the behaviour being measured. A segment lasting three seconds is valid and expected.

Cover the whole clip: consecutive segments should touch, so every second is accounted for. Offsets are seconds from the start of THIS clip.`;

const SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          label: { type: "string", enum: [...SCREEN_LABELS] },
          detail: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["start", "end", "label"],
      },
    },
  },
  required: ["segments"],
} as const;

/**
 * Sampling tiers.
 *
 * "gap"    — nothing was captured, so the screen is the only record. Sample
 *            densely and keep whatever it shows.
 * "active" — hooks were firing, so we already know what the agent did. Sample
 *            sparsely and keep ONLY surfaces the hooks cannot explain: a
 *            browser, another AI tool, an unrelated app. This is what catches
 *            someone running ChatGPT in a second window while Claude Code
 *            works — invisible to hooks by construction.
 */
export type WindowMode = "gap" | "active";

/** Labels an active-period sweep is allowed to emit; the rest are hook noise. */
const ACTIVE_KEEP = new Set([
  "browser:search",
  "browser:docs",
  // AI in a browser is the headline case: hooks cannot see it, so it is always
  // evidence. `cli_agent` is deliberately absent — the hook stream already has
  // that conversation in full fidelity.
  "browser:ai_chat",
  "browser:own_app",
  "other",
]);

/**
 * Hook-active stretches are sampled at the same rate as gaps. The tiering only
 * survives in *what is kept as evidence* (see ACTIVE_KEEP), not in how densely
 * we look — undersampling here is what made brief app switches disappear.
 */
const ACTIVE_FPS = () => Number(process.env.WORKFLOW_SCREEN_ACTIVE_FPS) || FPS();
/**
 * Skip only true slivers. This was 60s to avoid spending a call on a short
 * lull, which silently meant any recording under a minute — every short test
 * run — was classified as nothing at all, and the band stayed empty. Coverage
 * is the point; a wasted call on a 6-second stretch costs a fraction of a cent.
 */
const MIN_ACTIVE_SECONDS = () => Number(process.env.WORKFLOW_SCREEN_MIN_ACTIVE_SEC) || 5;
/** Keep any single request to a sane clip length. */
const MAX_WINDOW_SECONDS = () => Number(process.env.WORKFLOW_SCREEN_MAX_WINDOW_SEC) || 600;

export interface ClassificationWindow {
  mode: WindowMode;
  /** Wall-clock bounds. */
  startMs: number;
  endMs: number;
  /** Where that stretch sits in the merged recording. */
  videoStart: number;
  videoEnd: number;
  fps: number;
}

/**
 * Plan the whole recording, not just the silences.
 *
 * At classification resolution a full sweep costs about a cent more than
 * gaps-only, and gaps-only is blind to anything happening *alongside* agent
 * activity. Windows never straddle a recording break: both ends must sit in the
 * same segment, or the clip would splice together footage from different times.
 */
export function planClassificationWindows(
  eventTimes: Array<Date | string>,
  segments: VideoSegment[] | null | undefined,
  options?: { minGapSeconds?: number; includeActive?: boolean }
): ClassificationWindow[] {
  if (!segments?.length) return [];
  const minGap = (options?.minGapSeconds ?? MIN_GAP_SECONDS()) * 1000;
  const includeActive = options?.includeActive !== false;
  const maxWindowMs = MAX_WINDOW_SECONDS() * 1000;

  const times = eventTimes
    .map((t) => new Date(t).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const windows: ClassificationWindow[] = [];

  const push = (mode: WindowMode, startMs: number, endMs: number) => {
    if (endMs <= startMs) return;
    // Split over-long stretches so no single request covers an hour.
    for (let s = startMs; s < endMs; s += maxWindowMs) {
      const e = Math.min(s + maxWindowMs, endMs);
      const videoStart = offsetIntoVideo(new Date(s), segments);
      const videoEnd = offsetIntoVideo(new Date(e), segments);
      if (videoStart == null || videoEnd == null || videoEnd <= videoStart) continue;
      if (mode === "active" && (e - s) / 1000 < MIN_ACTIVE_SECONDS()) continue;
      windows.push({
        mode,
        startMs: s,
        endMs: e,
        videoStart,
        videoEnd,
        fps: mode === "gap" ? FPS() : ACTIVE_FPS(),
      });
    }
  };

  for (const seg of segments) {
    const segStart = new Date(seg.wallStartedAt).getTime();
    const segEnd = seg.wallEndedAt ? new Date(seg.wallEndedAt).getTime() : Date.now();
    if (!Number.isFinite(segStart) || segEnd <= segStart) continue;

    // Boundaries inside this segment: the segment edges plus every event.
    const inner = times.filter((t) => t >= segStart && t <= segEnd);
    const marks = [segStart, ...inner, segEnd];

    let activeRunStart: number | null = null;
    for (let i = 1; i < marks.length; i++) {
      const a = marks[i - 1];
      const b = marks[i];
      if (b - a >= minGap) {
        // Close any active run before the gap, then record the gap itself.
        if (activeRunStart != null) {
          if (includeActive) push("active", activeRunStart, a);
          activeRunStart = null;
        }
        push("gap", a, b);
      } else if (activeRunStart == null) {
        activeRunStart = a;
      }
    }
    if (activeRunStart != null && includeActive) {
      push("active", activeRunStart, segEnd);
    }

    // Coverage guarantee: a recorded segment that produced no window at all
    // (too short, or every stretch fell under a threshold) still gets one.
    // Recorded footage that nothing describes is the failure mode this whole
    // feature exists to avoid.
    if (includeActive && !windows.some((w) => w.startMs >= segStart && w.endMs <= segEnd)) {
      const videoStart = offsetIntoVideo(new Date(segStart), segments);
      const videoEnd = offsetIntoVideo(new Date(segEnd), segments);
      if (videoStart != null && videoEnd != null && videoEnd > videoStart) {
        windows.push({
          mode: "active",
          startMs: segStart,
          endMs: segEnd,
          videoStart,
          videoEnd,
          fps: FPS(),
        });
      }
    }
  }

  return windows.sort((x, y) => x.startMs - y.startMs);
}

/** Back-compat helper used by tests: just the silent stretches. */
export function findSilentWindows(
  eventTimes: Array<Date | string>,
  segments: VideoSegment[] | null | undefined,
  options?: { minGapSeconds?: number; sessionEndMs?: number }
): ClassificationWindow[] {
  return planClassificationWindows(eventTimes, segments, {
    minGapSeconds: options?.minGapSeconds,
    includeActive: false,
  });
}

async function materializeVideo(
  sessionId: string
): Promise<{ filePath: string; cleanup: () => Promise<void> } | null> {
  const built = await buildPlaybackVideo(sessionId);
  if (!built) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wfc-screen-${sessionId}-`));
  const filePath = path.join(dir, "playback.webm");
  await pipeline(
    await getFrameStorage().openReadStream(built.key),
    createWriteStream(filePath)
  );
  return {
    filePath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export interface ScreenContextResult {
  windowsConsidered: number;
  gapWindows: number;
  activeWindows: number;
  windowsClassified: number;
  eventsCreated: number;
  /** Active-period findings dropped as redundant with the hook stream. */
  eventsSuppressed: number;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

/**
 * Classify hook-silent stretches and write them back as `screen_context` events
 * on the same timeline, so downstream grading treats them as ordinary evidence.
 */
export async function classifyScreenGaps(
  sessionId: string,
  options?: { replaceExisting?: boolean }
): Promise<ScreenContextResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  // Re-classifying covers the whole recording again, so clear prior results
  // first. Appending would duplicate every span each time recording is stopped
  // and resumed, and a band drawn from duplicates is unreadable.
  if (options?.replaceExisting !== false) {
    await WorkflowEventModel.deleteMany({ sessionId, type: "screen_context" });
  }

  const session: any = await WorkflowCaptureSessionModel.findById(sessionId).lean();
  if (!session) throw new Error(`Capture session ${sessionId} not found`);

  const events = await WorkflowEventModel.find({ sessionId })
    .sort({ at: 1 })
    .select("at type seq")
    .lean();
  // Our own screen events must not count as activity, or a second run would
  // see no silence at all.
  const hookTimes = events
    .filter((e: any) => e.type !== "screen_context")
    .map((e: any) => e.at);

  const segments = (session.video?.segments ?? []) as VideoSegment[];
  const windows = planClassificationWindows(hookTimes, segments).slice(0, MAX_WINDOWS());

  const result: ScreenContextResult = {
    windowsConsidered: windows.length,
    gapWindows: windows.filter((w) => w.mode === "gap").length,
    activeWindows: windows.filter((w) => w.mode === "active").length,
    windowsClassified: 0,
    eventsCreated: 0,
    eventsSuppressed: 0,
    promptTokens: 0,
    completionTokens: 0,
    model: MODEL(),
  };
  if (windows.length === 0) return result;

  const video = await materializeVideo(sessionId);
  if (!video) return result;

  const ai = new GoogleGenAI({ apiKey });
  let file;
  try {
    file = await ai.files.upload({
      file: video.filePath,
      config: { mimeType: "video/webm" },
    });
    const deadline = Date.now() + 5 * 60 * 1000;
    while (file.state === FileState.PROCESSING) {
      if (Date.now() > deadline) throw new Error("Gemini file processing timed out");
      await new Promise((r) => setTimeout(r, 3000));
      file = await ai.files.get({ name: file.name! });
    }
    if (file.state !== FileState.ACTIVE) {
      throw new Error(`Gemini file entered state ${file.state}`);
    }

    // Highest seq wins ordering ties; screen events append after hook events.
    const maxSeq = events.reduce(
      (m: number, e: any) => Math.max(m, Number(e.seq) || 0),
      0
    );
    let seq = maxSeq + 1;
    const docs: Record<string, unknown>[] = [];

    for (const w of windows) {
      const part: Part = {
        fileData: { fileUri: file.uri!, mimeType: file.mimeType ?? "video/webm" },
        videoMetadata: {
          startOffset: `${w.videoStart}s`,
          endOffset: `${w.videoEnd}s`,
          // Dense in the gaps (the screen is the only record), sparse while
          // hooks were firing (we only need "is anything else going on").
          fps: w.fps,
        },
      };
      let res;
      try {
        res = await ai.models.generateContent({
          model: MODEL(),
          contents: [{ role: "user", parts: [part, { text: PROMPT }] }],
          config: {
            // LOW, not HIGH: identifying a surface needs a quarter of the tokens
            // that reading its text would.
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            responseMimeType: "application/json",
            responseJsonSchema: SCHEMA,
            temperature: 0,
          },
        });
      } catch (err) {
        logTs("screen", `window ${w.videoStart}-${w.videoEnd}s failed: ${(err as Error).message}`);
        continue;
      }

      result.promptTokens += res.usageMetadata?.promptTokenCount ?? 0;
      result.completionTokens += res.usageMetadata?.candidatesTokenCount ?? 0;
      result.windowsClassified++;

      let parsed: any;
      try {
        parsed = JSON.parse(res.text ?? "{}");
      } catch {
        continue;
      }
      for (const s of parsed.segments ?? []) {
        if (typeof s?.start !== "number" || !s?.label) continue;
        // While hooks were firing we already know the agent was in the editor
        // and terminal, so re-reporting that as *evidence* is noise for the
        // judge. But it is still needed for coverage: the timeline band shows
        // what was on screen at EVERY moment, and dropping these would punch
        // holes in it. So keep the observation and flag it — the band draws
        // everything, grading reads only what is not redundant.
        const redundant = w.mode === "active" && !ACTIVE_KEEP.has(String(s.label));
        if (redundant) result.eventsSuppressed++;
        // Offsets come back relative to the clip; re-base onto wall clock.
        const atMs = w.startMs + Math.max(0, s.start - w.videoStart) * 1000;
        const withinGap = Math.min(Math.max(atMs, w.startMs), w.endMs);
        // Screen context is a SPAN, not an instant — "Chrome was up for four
        // minutes" is the fact, and a band can only be drawn if we keep the end.
        const endSec = typeof s.end === "number" ? s.end : s.start;
        const segVideoStart = Math.max(w.videoStart, Math.min(s.start, w.videoEnd));
        const segVideoEnd = Math.max(segVideoStart, Math.min(endSec, w.videoEnd));
        docs.push({
          sessionId,
          type: "screen_context",
          at: new Date(withinGap),
          seq: seq++,
          text: s.detail || null,
          payload: {
            source: "screen",
            label: s.label,
            detail: s.detail || null,
            confidence: s.confidence ?? null,
            // "active" means this was seen WHILE the agent was working — that
            // is the concurrent-activity signal, and worth flagging as such.
            mode: w.mode,
            concurrentWithAgent: w.mode === "active",
            /** True = shown in the coverage band, excluded from grading evidence. */
            redundant,
            // Span of THIS observation in the recording, for the timeline band.
            videoStart: Number(segVideoStart.toFixed(2)),
            videoEnd: Number(segVideoEnd.toFixed(2)),
            durationSeconds: Number((segVideoEnd - segVideoStart).toFixed(1)),
            windowStart: w.videoStart,
            windowEnd: w.videoEnd,
          },
          truncated: false,
        });
      }
    }

    if (docs.length) {
      try {
        const inserted = await WorkflowEventModel.insertMany(docs, { ordered: false });
        result.eventsCreated = inserted.length;
      } catch (err: any) {
        result.eventsCreated = err?.insertedDocs?.length ?? 0;
      }
    }
    logTs(
      "screen",
      `session ${sessionId}: ${result.windowsClassified}/${windows.length} windows ` +
        `(${result.gapWindows} gap @${FPS()}fps, ${result.activeWindows} active @${ACTIVE_FPS()}fps) → ` +
        `${result.eventsCreated} events kept, ${result.eventsSuppressed} suppressed as hook-redundant ` +
        `(${result.promptTokens}p tokens, ${MODEL()})`
    );
    return result;
  } finally {
    if (file?.name) await ai.files.delete({ name: file.name }).catch(() => {});
    await video.cleanup().catch(() => {});
  }
}
