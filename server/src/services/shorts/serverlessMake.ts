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

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const SERVERLESS_MAX_TOKENS = 16384;
const SERVERLESS_MAX_FILE_BYTES = 500 * 1024; // 500 KB per file
const SERVERLESS_MAX_TOTAL_BYTES = 1.5 * 1024 * 1024; // 1.5 MB total
const GENERATE_TIMEOUT_MS = 120_000;

const SERVERLESS_SYSTEM_PROMPT = [
  "You are building a small, fun, self-contained web creation for a phone-first daily challenge.",
  "",
  "Output rules (strict):",
  "- Return exactly ONE complete HTML document, starting with `<!DOCTYPE html>` and ending with `</html>`.",
  "- Inline ALL CSS in a <style> tag and ALL JavaScript in a <script> tag. Do NOT reference separate .css/.js files.",
  "- You MAY load libraries from a CDN via <script src> / <link href>, and you MAY call public, keyless, CORS-enabled APIs (e.g. open-meteo). Never require an API key.",
  "- No build step, no bundlers, no frameworks that need compilation. Vanilla JS or CDN builds only.",
  "- Make it work on a phone: responsive, touch-friendly, no horizontal scroll.",
  "- Return ONLY the HTML. No markdown fences, no explanation, no prose before or after.",
].join("\n");

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

function looksLikeHtml(html: string): boolean {
  const lower = html.slice(0, 4000).toLowerCase();
  return (
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("<body")
  );
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
      "Here is the current index.html — modify it to satisfy the request, and return the full updated file:",
      "",
      input.currentHtml,
      "",
    );
  } else {
    parts.push("There is no meaningful file yet — build it from scratch.", "");
  }
  parts.push(`Request: ${input.request}`);
  return parts.filter((p) => p !== null).join("\n");
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
  const model = resolvePlayModel(input.model);
  // `effort` has no Anthropic Messages equivalent (it's a Claude Code CLI concept);
  // resolve it only so the response shape matches the E2B path for the UI.
  const effort = resolvePlayEffort(model, input.effort);

  const challengeDoc = await getChallengeBySlug(doc.challengeSlug);
  const challengeTitle =
    (challengeDoc as { title?: string } | null)?.title || doc.challengeSlug;
  const challengePrompt =
    (challengeDoc as { prompt?: string } | null)?.prompt || "";
  const currentHtml = readIndexHtml(doc.workspaceSnapshot as SnapshotFile[]);

  beginPlayClaudeRun(input.sessionId);
  try {
    const requestBody = {
      model,
      max_tokens: SERVERLESS_MAX_TOKENS,
      system: SERVERLESS_SYSTEM_PROMPT,
      messages: [
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
    const tokens = parseUsageFromAnthropicBody(parsed);
    await incrementSessionUsage(input.sessionId, tokens);

    if ((parsed as { stop_reason?: string } | null)?.stop_reason === "max_tokens") {
      throw createHttpError(
        502,
        "The build got cut off (too large). Try a simpler request.",
      );
    }

    const html = stripCodeFences(extractTextFromMessage(parsed));
    if (!html || !looksLikeHtml(html)) {
      throw createHttpError(
        502,
        "The model did not return a valid HTML file. Try rephrasing your request.",
      );
    }
    if (Buffer.byteLength(html, "utf8") > SERVERLESS_MAX_FILE_BYTES) {
      throw createHttpError(413, "The generated file is too large.");
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
    await appendSessionChatMessages(input.sessionId, [
      { role: "user", text: prompt, createdAt: new Date() },
      { role: "assistant", text: "Updated your build.", createdAt: new Date() },
    ]);

    return { output: "Updated your build.", exitCode: 0, model, effort };
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
