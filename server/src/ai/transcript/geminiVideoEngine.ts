/**
 * Gemini native-video transcript engine (TRANSCRIPT_ENGINE=gemini).
 *
 * Instead of extracting frames and OCRing them one by one (the frames engine),
 * this uploads the session's merged screen recording to the Gemini Files API
 * and asks a video-capable model for the same JSONL segment stream in one or
 * a few requests. The video is uploaded ONCE; long recordings are processed
 * as overlapping time windows via videoMetadata start/end offsets so
 * timestamps stay accurate and output stays under the completion cap.
 *
 * Screen 0 only for now (the merged playback covers screen 0; multi-monitor
 * sessions fall back to the frames engine for other screens).
 */

import fs from "fs/promises";
import { createWriteStream } from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import {
  GoogleGenAI,
  FileState,
  MediaResolution,
  type Part,
} from "@google/genai";

import ProctoringSessionModel from "../../models/proctoringSession.js";
import { getFrameStorage } from "../../services/capture/storage.js";
import { buildSessionWebmForPlayback } from "../../services/capture/sessionVideoMerge.js";
import { getVideoDurationSeconds } from "../../services/capture/videoFrameExtractor.js";
import type { TranscriptSegment } from "./stitcher.js";
import { logTs } from "./logger.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function isGeminiEngineConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function isGeminiEngineEnabled(): boolean {
  return process.env.TRANSCRIPT_ENGINE === "gemini" && isGeminiEngineConfigured();
}

const GEMINI_MODEL = () =>
  process.env.TRANSCRIPT_GEMINI_MODEL || "gemini-3.6-flash";

/** Frames per second Gemini samples from the video. Screens change slowly; 1 is plenty. */
const GEMINI_FPS = () => {
  const raw = Number(process.env.TRANSCRIPT_GEMINI_FPS);
  return Number.isFinite(raw) && raw > 0 && raw <= 24 ? raw : 1;
};

/** Dense on-screen text needs HIGH (280 tok/frame); LOW/MEDIUM are 70 tok/frame. */
const GEMINI_MEDIA_RESOLUTION = (): MediaResolution => {
  switch ((process.env.TRANSCRIPT_GEMINI_MEDIA_RESOLUTION || "high").toLowerCase()) {
    case "low":
      return MediaResolution.MEDIA_RESOLUTION_LOW;
    case "medium":
      return MediaResolution.MEDIA_RESOLUTION_MEDIUM;
    default:
      return MediaResolution.MEDIA_RESOLUTION_HIGH;
  }
};

/** Window length per request. Long single requests drift timestamps and hit output caps. */
const CHUNK_MINUTES = () => {
  const raw = Number(process.env.TRANSCRIPT_GEMINI_CHUNK_MINUTES);
  return Number.isFinite(raw) && raw >= 1 ? raw : 20;
};

/** Overlap between windows; segments starting inside the overlap belong to the earlier window. */
const CHUNK_OVERLAP_SEC = () => {
  const raw = Number(process.env.TRANSCRIPT_GEMINI_CHUNK_OVERLAP_SEC);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30;
};

const FILE_ACTIVE_TIMEOUT_MS = 5 * 60 * 1000;
const FILE_POLL_INTERVAL_MS = 3000;

// ---------------------------------------------------------------------------
// Prompt + response schema
// ---------------------------------------------------------------------------

/**
 * Video-native variant of PROMPT_TRANSCRIPT_SYSTEM. Same region priorities and
 * verbatim rules, but the model sees motion, so it segments by activity period
 * instead of per-frame, and reports offsets relative to the video start.
 */
const GEMINI_TRANSCRIPT_PROMPT = `You are a screen activity transcription system. The video is a recording of a candidate's screen during a take-home coding assessment. Produce a transcript used to evaluate what the candidate did.

Watch the whole clip and divide it into activity segments. A segment is a contiguous period where one region of the screen shows one coherent activity (a chat exchange, a command being run, a block of code being edited, a page being read). Report every segment as an object in the "segments" array.

REGION PRIORITY RULES:
1. ai_chat (HIGHEST): AI assistant panels and tools — Claude Code, Cursor chat, Copilot chat, ChatGPT, Claude.ai, agent output. Transcribe EVERY message VERBATIM, character-for-character, with sender labels (Human/Assistant). Never summarize. If an AI tool is open in a browser, it is region "ai_chat", not "browser".
2. terminal (HIGH): transcribe commands, prompts, output, errors, and test results verbatim.
3. editor (MEDIUM): always name the file and language. If code is being actively typed or edited, transcribe the changed code verbatim. If code is only being viewed, give a 1-2 sentence summary of what is visible instead.
4. browser (MEDIUM): always include the URL. For documentation, give the heading and the key content being read. For searches, give the query and visible results.
5. file_tree (LOW): only expanded folders and the selected file.
6. other (LOW): one short line, or omit.

SKIP entirely: bookmark bars, window chrome, status bars, "sharing your screen" banners, notification popups, and windows unrelated to the coding task (email, music, social) — for unrelated windows emit at most one segment saying "[unrelated window - omitted]".

Also note moments that matter for evaluation: pasting large blocks of code (say where it likely came from if visible), switching apps, long idle periods (report as one segment with region "other", e.g. "[idle - no visible change]").

TIMING: "start" and "end" are offsets from the beginning of THIS video clip, in seconds (numbers, e.g. 372.5). They must reflect when the activity was actually visible.

Be exhaustive: cover the full duration; consecutive segments may share boundaries. Do not invent text you cannot read — if text is too small or blurry to read exactly, say so in the segment instead of guessing.`;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "number", description: "Seconds from start of this clip" },
          end: { type: "number", description: "Seconds from start of this clip" },
          region: {
            type: "string",
            enum: ["ai_chat", "terminal", "editor", "file_tree", "browser", "other"],
          },
          app: { type: "string", description: "Application name, e.g. VS Code, Chrome, Terminal" },
          text_content: { type: "string", description: "Verbatim text or summary per region rules" },
        },
        required: ["start", "end", "region", "text_content"],
      },
    },
  },
  required: ["segments"],
} as const;

// ---------------------------------------------------------------------------
// Video materialization
// ---------------------------------------------------------------------------

/**
 * Get the session's screen-0 recording as a local file.
 * Uses the eager-merged playback.webm when ready, else merges chunks on the fly.
 */
export async function materializeSessionVideo(
  sessionId: string,
): Promise<{ filePath: string; cleanup: () => Promise<void> } | null> {
  const session = await ProctoringSessionModel.findById(sessionId);
  if (!session) return null;
  const storage = getFrameStorage();

  const mv = (session as any).mergedVideo;
  if (mv?.status === "ready" && mv.storageKey) {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `gemini-transcript-${sessionId}-`),
    );
    const filePath = path.join(tmpDir, "playback.webm");
    await pipeline(
      await storage.openReadStream(mv.storageKey),
      createWriteStream(filePath),
    );
    return {
      filePath,
      cleanup: async () => {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      },
    };
  }

  const built = await buildSessionWebmForPlayback(
    sessionId,
    session as any,
    storage,
  );
  if (!built) return null;
  return { filePath: built.filePath, cleanup: built.cleanup };
}

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

export interface GeminiWindow {
  /** Request range sent to the model (includes lead-in overlap). */
  requestStartSec: number;
  requestEndSec: number;
  /** Segments starting before coreStartSec are dropped (covered by the prior window). */
  coreStartSec: number;
}

export function planWindows(
  durationSec: number,
  chunkMinutes: number = CHUNK_MINUTES(),
  overlapSec: number = CHUNK_OVERLAP_SEC(),
): GeminiWindow[] {
  const chunkSec = chunkMinutes * 60;
  const windows: GeminiWindow[] = [];
  for (let core = 0; core < durationSec; core += chunkSec) {
    windows.push({
      requestStartSec: Math.max(0, core - (core > 0 ? overlapSec : 0)),
      requestEndSec: Math.min(durationSec, core + chunkSec),
      coreStartSec: core,
    });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface GeminiTranscriptResult {
  segments: TranscriptSegment[];
  promptTokens: number;
  completionTokens: number;
  videoDurationSec: number;
  windowCount: number;
  model: string;
}

/**
 * Produce transcript segments for a session from its merged video via Gemini.
 * No DB writes — the caller (generator or A/B script) owns persistence.
 */
export async function generateSegmentsWithGemini(
  sessionId: string,
  options?: {
    /** Only transcribe the first N seconds (cost cap for tests). */
    maxDurationSec?: number;
    /** Absolute wall-clock start of the recording; default from session stats. */
    captureStartedAtMs?: number;
  },
): Promise<GeminiTranscriptResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const session = await ProctoringSessionModel.findById(sessionId).lean();
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const captureStartedAtMs =
    options?.captureStartedAtMs ??
    (() => {
      const s: any = session;
      const raw =
        s.stats?.captureStartedAt || s.videoChunks?.[0]?.startTime || s.createdAt;
      return raw ? new Date(raw).getTime() : Date.now();
    })();

  const video = await materializeSessionVideo(sessionId);
  if (!video) throw new Error(`Session ${sessionId} has no video to transcribe`);

  try {
    let durationSec = await getVideoDurationSeconds(video.filePath);
    if (options?.maxDurationSec != null) {
      durationSec = Math.min(durationSec, options.maxDurationSec);
    }
    const stat = await fs.stat(video.filePath);
    logTs(
      "gemini",
      `Session ${sessionId}: video ${(stat.size / 1e6).toFixed(1)}MB, ${durationSec.toFixed(0)}s, model=${GEMINI_MODEL()}, fps=${GEMINI_FPS()}, res=${GEMINI_MEDIA_RESOLUTION()}`,
    );

    const ai = new GoogleGenAI({ apiKey });

    // Upload once; all windows reference the same file via offsets.
    const uploadStart = Date.now();
    let file = await ai.files.upload({
      file: video.filePath,
      config: { mimeType: "video/webm" },
    });
    while (file.state === FileState.PROCESSING) {
      if (Date.now() - uploadStart > FILE_ACTIVE_TIMEOUT_MS) {
        throw new Error("Gemini file processing timed out");
      }
      await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
      file = await ai.files.get({ name: file.name! });
    }
    if (file.state !== FileState.ACTIVE) {
      throw new Error(`Gemini file entered state ${file.state}`);
    }
    logTs("gemini", `Uploaded + processed in ${Date.now() - uploadStart}ms`);

    const windows = planWindows(durationSec);
    const allSegments: TranscriptSegment[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      for (let w = 0; w < windows.length; w++) {
        const win = windows[w];
        const videoPart: Part = {
          fileData: { fileUri: file.uri!, mimeType: file.mimeType ?? "video/webm" },
          videoMetadata: {
            startOffset: `${win.requestStartSec}s`,
            endOffset: `${win.requestEndSec}s`,
            fps: GEMINI_FPS(),
          },
        };

        const windowNote = `This clip is the portion of the recording from ${win.requestStartSec}s to ${win.requestEndSec}s (offsets in your output are relative to ${win.requestStartSec}s into the full recording — but report them relative to THIS clip's start; the caller re-bases them).`;

        const callStart = Date.now();
        const res = await ai.models.generateContent({
          model: GEMINI_MODEL(),
          contents: [
            {
              role: "user",
              parts: [videoPart, { text: `${GEMINI_TRANSCRIPT_PROMPT}\n\n${windowNote}` }],
            },
          ],
          config: {
            mediaResolution: GEMINI_MEDIA_RESOLUTION(),
            responseMimeType: "application/json",
            responseJsonSchema: RESPONSE_JSON_SCHEMA,
            temperature: 0,
          },
        });

        const usage = res.usageMetadata;
        promptTokens += usage?.promptTokenCount ?? 0;
        completionTokens += usage?.candidatesTokenCount ?? 0;

        const parsed = parseWindowResponse(res.text ?? "");
        const kept = parsed.filter(
          (s) =>
            w === 0 ||
            win.requestStartSec + s.start >= win.coreStartSec,
        );
        for (const s of kept) {
          const absStartMs = captureStartedAtMs + (win.requestStartSec + s.start) * 1000;
          const absEndMs = captureStartedAtMs + (win.requestStartSec + s.end) * 1000;
          allSegments.push({
            ts: new Date(absStartMs).toISOString(),
            ts_end: new Date(absEndMs).toISOString(),
            screen: 0,
            region: s.region,
            app: s.app || undefined,
            text_content: s.text_content,
          });
        }
        logTs(
          "gemini",
          `Window ${w + 1}/${windows.length} [${win.requestStartSec}-${win.requestEndSec}s]: ${parsed.length} segments (${kept.length} kept), ${usage?.promptTokenCount ?? 0}p + ${usage?.candidatesTokenCount ?? 0}c tokens`,
          Date.now() - callStart,
        );
      }
    } finally {
      // Uploaded files auto-expire after 48h; delete eagerly anyway.
      await ai.files.delete({ name: file.name! }).catch(() => {});
    }

    allSegments.sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );

    return {
      segments: allSegments,
      promptTokens,
      completionTokens,
      videoDurationSec: durationSec,
      windowCount: windows.length,
      model: GEMINI_MODEL(),
    };
  } finally {
    await video.cleanup().catch(() => {});
  }
}

interface RawWindowSegment {
  start: number;
  end: number;
  region: string;
  app?: string;
  text_content: string;
}

function parseWindowResponse(text: string): RawWindowSegment[] {
  if (!text.trim()) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Tolerate accidental markdown fences even with responseMimeType set.
    const stripped = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "");
    try {
      parsed = JSON.parse(stripped);
    } catch {
      logTs("gemini", `WARNING: unparseable window response (${text.length} chars)`);
      return [];
    }
  }
  const items = Array.isArray(parsed?.segments) ? parsed.segments : [];
  return items
    .filter(
      (s: any) =>
        typeof s?.start === "number" &&
        typeof s?.end === "number" &&
        typeof s?.text_content === "string" &&
        s.text_content.trim(),
    )
    .map((s: any) => ({
      start: s.start,
      end: Math.max(s.end, s.start),
      region: typeof s.region === "string" ? s.region : "other",
      app: typeof s.app === "string" ? s.app : undefined,
      text_content: s.text_content,
    }));
}
