/**
 * Serverless "make" path for Shorts — generate a single self-contained HTML file
 * via a direct Anthropic Messages call (no E2B sandbox). Selected per-session when
 * SHORTS_MAKE_MODE=serverless. The E2B path (sandbox.ts / claudeProvision.ts /
 * llmProxy.runClaudePrintPrompt) is untouched.
 *
 * The generated file is stored on the session's `workspaceSnapshot` as
 * `[{ path: "index.html", content }]` — the same shape as PlaySubmission.files —
 * so submit / gallery / vote / preview all work downstream with no changes.
 */
import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getPlayBuildSessionModel } from "../../models/shorts/buildSession.js";
import type { PublicChallenge } from "./challenges.js";
import { getChallengeBySlug } from "./challenges.js";
import { filterPlayPublicFiles } from "./sandbox.js";
import { getShortsPublicApiUrl } from "../../utils/shortsEnv.js";
import {
  STARTER_FILES,
  isIndexHtmlStarterLike,
} from "./starterDetection.js";
import type { SnapshotFile } from "./sessionPersist.js";
import { appendSessionChatMessages } from "./sessionPersist.js";
import {
  beginPlayClaudeRun,
  endPlayClaudeRun,
  getAnthropicApiKeyOrThrow,
  getPlayLlmProxyPublicBase,
  incrementSessionUsage,
  isPlayClaudeRunInFlight,
  parseUsageFromAnthropicBody,
} from "./llmProxy.js";
import {
  resolvePlayEffort,
  resolvePlayModel,
  type PlayEffortLevel,
} from "./models.js";
import { SHORTS_VOICE, toPlainChatText } from "./voice.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/**
 * Claude Fable 5 runs safety classifiers that can decline a request (HTTP 200 +
 * `stop_reason: "refusal"`). `fallbacks: "default"` lets the API re-run the
 * declined request on Anthropic's recommended substitute inside the same call,
 * routed by refusal category, so a false positive still returns a build.
 */
const REFUSAL_FALLBACK_MODELS = new Set(["claude-fable-5"]);
const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SERVERLESS_MAX_TOKENS = 16384;
const SERVERLESS_MAX_FILE_BYTES = 500 * 1024; // 500 KB per file
const SERVERLESS_MAX_TOTAL_BYTES = 1.5 * 1024 * 1024; // 1.5 MB total
const SERVERLESS_MAX_REPLY_CHARS = 4000; // chat text stored/returned per turn
const GENERATE_TIMEOUT_MS = 120_000;

export const SERVERLESS_SYSTEM_PROMPT = [
  "You are the build partner for a phone-first daily challenge where people make small, fun, self-contained web creations.",
  "",
  SHORTS_VOICE,
  "",
  "Every turn is one of two shapes. The voice above applies to all of it — the line before a build, the answer to a question, everything.",
  "",
  "1. BUILD — when the user wants the app created, changed, fixed, styled, or extended.",
  "   Open with ONE short friendly line about what you're making them (under about 12 words), then the document.",
  "   If they also asked something, answer it first in at most two short plain-text sentences instead, then the document.",
  "   Return exactly ONE complete HTML document, starting with `<!DOCTYPE html>` and ending with `</html>`.",
  "   - Inline ALL CSS in a <style> tag and ALL JavaScript in a <script> tag. Do NOT reference separate .css/.js files.",
  "   - You MAY load libraries from a CDN via <script src> / <link href>, and you MAY call public, keyless, CORS-enabled APIs (e.g. open-meteo). Never require an API key.",
  "   - No build step, no bundlers, no frameworks that need compilation. Vanilla JS or CDN builds only.",
  "   - Make it work on a phone: responsive, touch-friendly, no horizontal scroll.",
  "   - No markdown fences around the document, and nothing at all after `</html>`.",
  "   - Do not narrate or explain the code — the user sees the running preview, not the source.",
  "",
  "2. TALK — when the user is brainstorming, asking a question, asking for ideas or an explanation, or otherwise not asking for a code change.",
  "   Reply in short plain text. No HTML document, no code fences, no full-file dumps.",
  "   Hard limit: 80 words, and at most THREE ideas — one short line each. This is a chat bubble on a phone, not an article. Cutting the fourth idea is the right call every time.",
  "   Offer concrete things they can then ask you to build, and stop. No recap or sign-off at the end.",
  "",
  "A turn that asks something AND requests a change is a BUILD: answer briefly, then build. Never drop half the message.",
  "If the request is ambiguous and implies no change, prefer TALK and ask one short clarifying question.",
].join("\n");

/**
 * Fallback chat line for a BUILD turn where the model sent the document with no
 * prose in front of it. The system prompt asks for an opening line every time,
 * so this is the backstop — rotated so a run of builds doesn't repeat one
 * robotic sentence back at the builder.
 */
const BUILD_CONFIRMATIONS = [
  "Done — have a look.",
  "There you go, take a look.",
  "Built it. See what you think.",
  "That's up now — check it out.",
  "Fresh version's ready for you.",
];

function pickBuildConfirmation(): string {
  return BUILD_CONFIRMATIONS[
    Math.floor(Math.random() * BUILD_CONFIRMATIONS.length)
  ];
}

/** How many prior chat turns to replay so TALK mode has conversational memory. */
const HISTORY_MAX_MESSAGES = 8;
const HISTORY_MAX_CHARS_PER_MESSAGE = 1500;

/**
 * Browser-facing base for serverless preview iframes.
 *
 * This only has to be reachable from the user's browser — unlike the LLM proxy
 * base, which must be reachable from inside an E2B sandbox. Locally that means
 * this server's own origin: a stale or dead tunnel in
 * SHORTS_LLM_PROXY_PUBLIC_URL (serverless mode never uses E2B) must not leave
 * the preview pointing at an offline host. Override with SHORTS_PUBLIC_API_URL
 * when the browser is not on this machine.
 */
export function getShortsPublicApiBase(): string {
  const explicit = getShortsPublicApiUrl();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    return getPlayLlmProxyPublicBase();
  }
  return `http://localhost:${process.env.PORT || 5050}`;
}

/** Absolute preview URL the browser iframe loads for a serverless session. */
export function buildSessionPreviewUrl(
  sessionId: string,
  anonymousId: string,
): string {
  const base = getShortsPublicApiBase();
  const q = new URLSearchParams({ anonymousId }).toString();
  return `${base}/api/shorts/session/${sessionId}/preview?${q}`;
}

/** Files to seed a fresh serverless session so the preview isn't blank pre-turn. */
function serverlessStarterFiles(): SnapshotFile[] {
  return [
    { path: "index.html", content: STARTER_FILES["index.html"] },
    { path: "style.css", content: STARTER_FILES["style.css"] },
    { path: "main.js", content: STARTER_FILES["main.js"] },
  ];
}

function readIndexHtml(files: SnapshotFile[] | undefined): string | null {
  if (!files?.length) return null;
  const found = files.find(
    (f) => f.path === "index.html" || f.path === "index.htm",
  );
  return found && typeof found.content === "string" ? found.content : null;
}

function extractTextFromMessage(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text"
        ? String((block as { text?: string }).text || "")
        : "",
    )
    .join("");
}

/** Strip a single leading/trailing markdown code fence if the model added one. */
function stripCodeFences(raw: string): string {
  let s = String(raw || "").trim();
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/;
  const m = fence.exec(s);
  if (m) s = m[1].trim();
  return s;
}

/**
 * Classify a serverless turn's response: a full HTML document means "rebuild the
 * app", anything else is a plain chat reply (brainstorming, questions, ideas).
 *
 * A document is only accepted when it is a complete `<html>…</html>` — a stray
 * tag mentioned inside prose must not overwrite the user's build. Any prose that
 * came alongside the document is kept as the chat message: a turn that both asks
 * something and requests a change answers in that prose and rebuilds, so neither
 * half of the message is silently dropped.
 */
type MakeResponse =
  | { kind: "html"; html: string; note: string }
  | { kind: "text"; text: string };

const HTML_DOC_RE = /<!doctype\s+html[\s\S]*?<\/html\s*>/i;
const HTML_TAG_DOC_RE = /<html[\s>][\s\S]*?<\/html\s*>/i;
const MIN_HTML_DOC_CHARS = 200;

export function classifyMakeResponse(raw: string): MakeResponse {
  const text = stripCodeFences(raw).trim();
  if (!text) return { kind: "text", text: "" };

  const match = HTML_DOC_RE.exec(text) || HTML_TAG_DOC_RE.exec(text);
  if (match && match[0].length >= MIN_HTML_DOC_CHARS) {
    const html = match[0].trim();
    const note = (
      text.slice(0, match.index) + text.slice(match.index + match[0].length)
    )
      .replace(/```[a-zA-Z]*/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { kind: "html", html, note };
  }

  return { kind: "text", text };
}

function buildUserMessage(input: {
  challengeTitle: string;
  challengePrompt: string;
  currentHtml: string | null;
  request: string;
}): string {
  const parts: string[] = [
    `Challenge: ${input.challengeTitle}`,
    "",
    input.challengePrompt ? `Brief:\n${input.challengePrompt}` : "",
    "",
  ];
  // Only include the current file when it's real work — the starter shell wastes
  // tokens and can anchor the model to boilerplate.
  if (input.currentHtml && !isIndexHtmlStarterLike(input.currentHtml)) {
    parts.push(
      "Here is the current index.html. If this turn is a BUILD, modify it to satisfy the request and return the full updated file:",
      "",
      input.currentHtml,
      "",
    );
  } else {
    parts.push(
      "There is no meaningful file yet — if this turn is a BUILD, build it from scratch.",
      "",
    );
  }
  parts.push(`Request: ${input.request}`);
  return parts.filter((p) => p !== null).join("\n");
}

/**
 * Replay recent chat turns so TALK mode can hold a conversation. Consecutive
 * same-role messages are merged — the Messages API requires alternating roles.
 */
function buildHistoryMessages(
  chatMessages: Array<{ role?: string; text?: string }> | undefined,
): Array<{ role: "user" | "assistant"; content: string }> {
  const recent = (chatMessages || [])
    .filter(
      (m) => (m?.role === "user" || m?.role === "assistant") && m?.text?.trim(),
    )
    .slice(-HISTORY_MAX_MESSAGES);

  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of recent) {
    const role = m.role as "user" | "assistant";
    const content = String(m.text).slice(0, HISTORY_MAX_CHARS_PER_MESSAGE);
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role, content });
  }
  // The turn's own message is appended by the caller as a user message.
  while (out.length && out[0].role === "assistant") out.shift();
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

/** Which "make" path owns this session. Absent (legacy) → "e2b". */
export async function getSessionMakeMode(
  sessionId: string,
): Promise<"e2b" | "serverless"> {
  if (!Types.ObjectId.isValid(sessionId)) return "e2b";
  const BuildSession = getPlayBuildSessionModel();
  const doc = (await BuildSession.findById(sessionId)
    .select("makeMode")
    .lean()) as { makeMode?: string } | null;
  return doc?.makeMode === "serverless" ? "serverless" : "e2b";
}

/**
 * Create a new serverless build session document (no sandbox). Marked active
 * immediately, seeded with the starter files, and given an absolute previewUrl.
 */
export async function provisionServerlessSession(input: {
  anonymousId: string;
  challenge: PublicChallenge;
  startedAt: Date;
  expiresAt: Date;
}) {
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.create({
    anonymousId: input.anonymousId,
    challengeSlug: input.challenge.slug,
    challengeDate: input.challenge.challengeDate,
    status: "active",
    makeMode: "serverless",
    tokenBudget: input.challenge.tokenBudget,
    tokensUsed: 0,
    llmCalls: 0,
    startedAt: input.startedAt,
    expiresAt: input.expiresAt,
    chatMessages: [],
    workspaceSnapshot: serverlessStarterFiles(),
    workspaceSnapshotAt: new Date(),
  });
  doc.previewUrl = buildSessionPreviewUrl(doc._id.toString(), input.anonymousId);
  await doc.save();
  return doc;
}

/**
 * One serverless "make" turn: call Anthropic once, store the returned single-file
 * HTML on the session, meter tokens, and append a short chat confirmation.
 * Mirrors runClaudePrintPrompt's return shape so the controller/UI are identical.
 */
export async function runServerlessMakeTurn(input: {
  sessionId: string;
  anonymousId: string;
  prompt: string;
  model?: string;
  effort?: string;
}): Promise<{
  output: string;
  exitCode: number;
  model: string;
  effort: PlayEffortLevel | null;
  /** True when this turn rewrote the build (vs. a plain chat reply). */
  workspaceChanged: boolean;
}> {
  const prompt = input.prompt.trim();
  if (!prompt) throw createHttpError(400, "prompt is required");
  if (prompt.length > 20_000) throw createHttpError(400, "prompt too long");
  if (!Types.ObjectId.isValid(input.sessionId)) {
    throw createHttpError(400, "invalid session id");
  }

  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(input.sessionId);
  if (!doc) throw createHttpError(404, "session_not_found");
  if (doc.anonymousId !== input.anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  if (doc.status !== "active") {
    throw createHttpError(400, "session_not_active");
  }
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    doc.status = "expired";
    await doc.save();
    throw createHttpError(400, "session_expired");
  }
  if ((doc.tokensUsed ?? 0) >= doc.tokenBudget) {
    throw createHttpError(429, "token_budget_exceeded");
  }

  // Serialize turns for a session so overlapping requests can't clobber the snapshot.
  if (isPlayClaudeRunInFlight(input.sessionId)) {
    throw createHttpError(409, "A build is already running for this session");
  }

  const apiKey = getAnthropicApiKeyOrThrow();
  const model = resolvePlayModel(input.model, { serverless: true });
  // The Messages API does take effort (`output_config.effort`), but this path
  // doesn't send it — resolve it only so the response shape matches the E2B
  // path for the UI. Every serverless model runs at the API default.
  const effort = resolvePlayEffort(model, input.effort);

  const challengeDoc = await getChallengeBySlug(doc.challengeSlug);
  const challengeTitle =
    (challengeDoc as { title?: string } | null)?.title || doc.challengeSlug;
  const challengePrompt =
    (challengeDoc as { prompt?: string } | null)?.prompt || "";
  const currentHtml = readIndexHtml(doc.workspaceSnapshot as SnapshotFile[]);

  beginPlayClaudeRun(input.sessionId);
  try {
    const wantsRefusalFallback = REFUSAL_FALLBACK_MODELS.has(model);
    const requestBody = {
      model,
      ...(wantsRefusalFallback ? { fallbacks: "default" as const } : {}),
      max_tokens: SERVERLESS_MAX_TOKENS,
      system: SERVERLESS_SYSTEM_PROMPT,
      messages: [
        ...buildHistoryMessages(
          doc.chatMessages as Array<{ role?: string; text?: string }>,
        ),
        {
          role: "user",
          content: buildUserMessage({
            challengeTitle,
            challengePrompt,
            currentHtml,
            request: prompt,
          }),
        },
      ],
    };

    let upstream: Awaited<ReturnType<typeof fetch>>;
    try {
      upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          ...(wantsRefusalFallback
            ? { "anthropic-beta": REFUSAL_FALLBACK_BETA }
            : {}),
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "generation request failed";
      throw createHttpError(502, `Generation request failed: ${message}`);
    }

    const text = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave null
    }

    if (!upstream.ok) {
      const apiMessage =
        (parsed as { error?: { message?: string } } | null)?.error?.message ||
        `Anthropic API error ${upstream.status}`;
      throw createHttpError(upstream.status === 429 ? 429 : 502, apiMessage);
    }

    // Meter what was consumed BEFORE any post-checks (tokens were spent regardless).
    await incrementSessionUsage(
      input.sessionId,
      parseUsageFromAnthropicBody(parsed),
    );

    const stopReason = (parsed as { stop_reason?: string } | null)?.stop_reason;

    if (stopReason === "max_tokens") {
      throw createHttpError(
        502,
        "Ran out of room on that one — it got too big. Ask for something a bit simpler and I'll give it another go.",
      );
    }

    // Safety classifiers declined (HTTP 200, empty or partial content). Without
    // this branch it falls through to the empty-response error, which reads as a
    // model glitch rather than a declined request.
    if (stopReason === "refusal") {
      throw createHttpError(
        400,
        "I can't build that one, sorry. Throw me a different idea and we'll keep going.",
      );
    }

    const response = classifyMakeResponse(extractTextFromMessage(parsed));

    // Not a build — a brainstorm / question / explanation. Keep the workspace as
    // it is and just read the model's text back into the chat.
    if (response.kind === "text") {
      const reply = response.text.trim();
      if (!reply) {
        throw createHttpError(
          502,
          "That came back blank on my end. Try saying it a different way?",
        );
      }
      const output = toPlainChatText(reply).slice(0, SERVERLESS_MAX_REPLY_CHARS);
      await appendSessionChatMessages(input.sessionId, [
        { role: "user", text: prompt, createdAt: new Date() },
        { role: "assistant", text: output, createdAt: new Date() },
      ]);
      return { output, exitCode: 0, model, effort, workspaceChanged: false };
    }

    const html = response.html;
    if (Buffer.byteLength(html, "utf8") > SERVERLESS_MAX_FILE_BYTES) {
      throw createHttpError(
        413,
        "That build came out way too big to save. Let's try a smaller version.",
      );
    }

    // Overwrite the single-file snapshot atomically (do not doc.save() the stale
    // doc — its tokensUsed predates incrementSessionUsage).
    await BuildSession.updateOne(
      { _id: input.sessionId },
      {
        $set: {
          workspaceSnapshot: [{ path: "index.html", content: html }],
          workspaceSnapshotAt: new Date(),
        },
      },
    );

    // Store a short human-readable confirmation, never the raw HTML blob.
    const note = toPlainChatText(response.note).slice(
      0,
      SERVERLESS_MAX_REPLY_CHARS,
    );
    const output = note || pickBuildConfirmation();
    await appendSessionChatMessages(input.sessionId, [
      { role: "user", text: prompt, createdAt: new Date() },
      { role: "assistant", text: output, createdAt: new Date() },
    ]);

    return { output, exitCode: 0, model, effort, workspaceChanged: true };
  } finally {
    endPlayClaudeRun(input.sessionId);
  }
}

/**
 * Build submission files from the session's stored snapshot (serverless submit).
 * Mirrors the guards snapshotProjectFiles gives the E2B path for free.
 */
export function snapshotServerlessSubmission(session: {
  workspaceSnapshot?: SnapshotFile[];
}): { files: SnapshotFile[]; totalBytes: number } {
  const files = filterPlayPublicFiles(
    (session.workspaceSnapshot || []) as SnapshotFile[],
  ).filter((f) => f?.path && typeof f.content === "string");

  if (files.length === 0) {
    throw createHttpError(400, "Project snapshot is empty");
  }

  let totalBytes = 0;
  for (const f of files) {
    const bytes = Buffer.byteLength(f.content, "utf8");
    if (bytes > SERVERLESS_MAX_FILE_BYTES) {
      throw createHttpError(413, `File ${f.path} exceeds the size limit`);
    }
    totalBytes += bytes;
  }
  if (totalBytes > SERVERLESS_MAX_TOTAL_BYTES) {
    throw createHttpError(413, "Project snapshot is too large");
  }

  return { files, totalBytes };
}
