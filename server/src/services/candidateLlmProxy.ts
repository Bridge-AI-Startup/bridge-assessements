/**
 * Candidate LLM proxy — Bridge-provided AI credits for assessment candidates.
 *
 * The capture kit points the candidate's Claude Code at this server
 * (ANTHROPIC_BASE_URL in .claude/settings.json) with a per-submission bearer
 * token. Every model call is forwarded to Anthropic with the org key, metered
 * against the assessment's `candidateLlmCredits` budget, and logged as an
 * LlmProxyCall receipt. The org key never reaches the candidate's machine.
 *
 * Mirrors services/shorts/llmProxy.ts (the battle-tested Shorts gateway), with
 * three differences: auth is a hashed token on the Submission (the raw token
 * is returned exactly once, at capture-session creation), the budget is read
 * live from the assessment so an employer can top up a struggling candidate
 * mid-attempt, and every call writes a tamper-proof receipt row.
 *
 * Grading semantics are unchanged: the hook stream stays the gradable record;
 * these receipts exist for integrity cross-checks and exact token accounting.
 */

import crypto from "crypto";
import type { Request, Response } from "express";
import SubmissionModel from "../models/submission.js";
import AssessmentModel from "../models/assessment.js";
import LlmProxyCallModel from "../models/llmProxyCall.js";

const ANTHROPIC_API = "https://api.anthropic.com";

/** Base path candidates' tools use: `${apiBase}${PATH}/v1/messages`. */
export const CANDIDATE_LLM_PROXY_PATH = "/api/workflow-capture/llm";

const MAX_LOGGED_USER_TEXT = 2_000;
const MAX_LOGGED_RESPONSE_TEXT = 4_000;

/**
 * Kill switch. The real gate is per-assessment (`candidateLlmCredits` > 0,
 * default off), so this defaults ON and exists only to stop all proxy spend
 * at once without editing every assessment.
 */
export function candidateLlmProxyEnabled(): boolean {
  return process.env.CANDIDATE_LLM_PROXY_ENABLED !== "false";
}

export function generateCandidateLlmToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Only the hash is stored; a leaked Mongo dump cannot mint model calls. */
export function hashCandidateLlmToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Tokens one call consumed, split by direction. */
export type TokenSplit = { input: number; output: number };

export function parseAnthropicUsage(body: unknown): TokenSplit {
  if (!body || typeof body !== "object") return { input: 0, output: 0 };
  const usage = (
    body as { usage?: { input_tokens?: number; output_tokens?: number } }
  ).usage;
  if (!usage) return { input: 0, output: 0 };
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
  };
}

/**
 * True for user-role text Claude Code injects itself (system reminders,
 * command wrappers) — present in the wire traffic but not typed by anyone.
 */
function isInjectedUserText(text: string): boolean {
  return text.startsWith("<system-reminder>") || text.startsWith("<command-");
}

/**
 * Newest user-role text in a Messages request — the "new" turn, for the
 * receipt. Claude Code interleaves its own user-role blocks (system
 * reminders, tool results); the candidate's typed prompt is preferred, with
 * injected text kept only as a fallback so the receipt is never empty.
 */
export function extractLastUserText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  let injectedFallback: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg?.role !== "user") continue;
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content.trim();
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter(
          (b: any) => b && b.type === "text" && typeof b.text === "string",
        )
        .map((b: any) => b.text)
        .join("\n")
        .trim();
    }
    // Tool results also arrive role:user; keep scanning for typed text.
    if (!text) continue;
    if (isInjectedUserText(text)) {
      injectedFallback ||= text.slice(0, MAX_LOGGED_USER_TEXT);
      continue;
    }
    return text.slice(0, MAX_LOGGED_USER_TEXT);
  }
  return injectedFallback;
}

/** Assistant text of a non-streaming Messages response, for the receipt. */
export function extractResponseText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  return text ? text.slice(0, MAX_LOGGED_RESPONSE_TEXT) : null;
}

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

/**
 * Issue (or rotate) the proxy credential for a submission. Usage counters are
 * deliberately left alone — re-running setup must not refill spent credits.
 * Returns the raw token; only its hash is persisted.
 */
export async function issueCandidateLlmToken(
  submissionId: string,
): Promise<string> {
  const raw = generateCandidateLlmToken();
  await SubmissionModel.updateOne(
    { _id: submissionId },
    {
      $set: {
        "llmProxy.tokenHash": hashCandidateLlmToken(raw),
        "llmProxy.issuedAt": new Date(),
      },
    },
  );
  return raw;
}

type ProxyContext = {
  submissionId: string;
  budget: number;
  tokensUsed: number;
};

type ProxyRefusal = { status: number; error: string };

/**
 * Resolve a bearer token to a live, in-budget submission — or a refusal.
 * Budget is read from the assessment on every call, so raising
 * `candidateLlmCredits` in the editor takes effect immediately.
 */
async function loadProxyContext(
  req: Request,
): Promise<ProxyContext | ProxyRefusal> {
  if (!candidateLlmProxyEnabled()) {
    return { status: 503, error: "candidate_llm_proxy_disabled" };
  }
  const bearer = extractBearer(req);
  if (!bearer) return { status: 401, error: "missing_bearer_token" };

  const submission: any = await SubmissionModel.findOne({
    "llmProxy.tokenHash": hashCandidateLlmToken(bearer),
  })
    .select("_id status assessmentId llmProxy")
    .lean();
  if (!submission) return { status: 403, error: "invalid_proxy_token" };

  if (
    submission.status === "submitted" ||
    submission.status === "expired" ||
    submission.status === "opted-out"
  ) {
    return { status: 403, error: "attempt_closed" };
  }

  const assessment: any = await AssessmentModel.findById(
    submission.assessmentId,
  )
    .select("candidateLlmCredits")
    .lean();
  const budget = Number(assessment?.candidateLlmCredits) || 0;
  if (budget <= 0) return { status: 403, error: "credits_disabled" };

  const tokensUsed = Number(submission.llmProxy?.tokensUsed) || 0;
  if (tokensUsed >= budget) {
    return { status: 429, error: "credit_budget_exceeded" };
  }

  return { submissionId: String(submission._id), budget, tokensUsed };
}

function isRefusal(x: ProxyContext | ProxyRefusal): x is ProxyRefusal {
  return (x as ProxyRefusal).error !== undefined;
}

async function incrementUsage(
  submissionId: string,
  usage: TokenSplit,
): Promise<void> {
  const input = Math.max(0, usage.input || 0);
  const output = Math.max(0, usage.output || 0);
  const total = input + output;
  if (total <= 0) return;
  await SubmissionModel.updateOne(
    { _id: submissionId },
    {
      $inc: {
        "llmProxy.tokensUsed": total,
        "llmProxy.inputTokensUsed": input,
        "llmProxy.outputTokensUsed": output,
        "llmProxy.calls": 1,
      },
      $set: { "llmProxy.lastCallAt": new Date() },
    },
  );
}

function logCall(doc: {
  submissionId: string;
  at: Date;
  model: string;
  stream: boolean;
  status: number;
  durationMs: number;
  usage: TokenSplit;
  requestBytes: number;
  responseBytes: number;
  requestSha256: string;
  responseSha256: string | null;
  lastUserText: string | null;
  responseText: string | null;
  stopReason: string | null;
}): void {
  // Fire-and-forget: the receipt must never delay or fail the model call.
  LlmProxyCallModel.create(doc).catch((err: unknown) => {
    console.error(
      "[candidate-llm] receipt write failed:",
      err instanceof Error ? err.message : err,
    );
  });
}

/**
 * POST {PATH}/v1/messages — the Anthropic Messages passthrough.
 * Streaming and non-streaming, exactly like the Shorts gateway, plus the
 * receipt row and per-submission metering.
 */
export async function handleCandidateMessagesProxy(
  req: Request,
  res: Response,
): Promise<void> {
  const ctx = await loadProxyContext(req);
  if (isRefusal(ctx)) {
    res.status(ctx.status).json({ error: ctx.error });
    return;
  }
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    res.status(503).json({ error: "anthropic_key_unconfigured" });
    return;
  }

  const startedAt = Date.now();
  const body =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : {};
  const wantStream = Boolean((body as { stream?: boolean }).stream);
  const model = typeof body.model === "string" ? body.model : "";
  const requestJson = JSON.stringify(body);
  const requestSha256 = crypto
    .createHash("sha256")
    .update(requestJson)
    .digest("hex");
  const lastUserText = extractLastUserText(body);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version":
      (req.headers["anthropic-version"] as string) || "2023-06-01",
  };
  if (req.headers["anthropic-beta"]) {
    headers["anthropic-beta"] = String(req.headers["anthropic-beta"]);
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${ANTHROPIC_API}/v1/messages`, {
      method: "POST",
      headers,
      body: requestJson,
    });
  } catch (err) {
    res.status(502).json({
      error: "upstream_unreachable",
      message: err instanceof Error ? err.message : "fetch failed",
    });
    return;
  }

  if (!wantStream) {
    const text = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave null
    }
    const usage = parseAnthropicUsage(parsed);
    await incrementUsage(ctx.submissionId, usage);
    logCall({
      submissionId: ctx.submissionId,
      at: new Date(startedAt),
      model,
      stream: false,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
      usage,
      requestBytes: Buffer.byteLength(requestJson),
      responseBytes: Buffer.byteLength(text),
      requestSha256,
      responseSha256: crypto.createHash("sha256").update(text).digest("hex"),
      lastUserText,
      responseText: extractResponseText(parsed),
      stopReason:
        parsed && typeof parsed === "object"
          ? ((parsed as any).stop_reason ?? null)
          : null,
    });

    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
    return;
  }

  // Streaming SSE passthrough. Usage and the receipt are accumulated from the
  // stream itself — hash and text capture add O(chunk) work, no buffering.
  res.status(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) res.setHeader("content-type", ct);
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const responseHash = crypto.createHash("sha256");
  let responseBytes = 0;
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let responseText = "";
  let stopReason: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      responseHash.update(value);
      responseBytes += value.byteLength;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const evt = JSON.parse(raw) as {
            type?: string;
            message?: {
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            usage?: { input_tokens?: number; output_tokens?: number };
            delta?: { type?: string; text?: string; stop_reason?: string };
          };
          if (evt.type === "message_start" && evt.message?.usage) {
            inputTokens = evt.message.usage.input_tokens || inputTokens;
            outputTokens = evt.message.usage.output_tokens || outputTokens;
          }
          if (evt.type === "message_delta" && evt.usage) {
            if (evt.usage.output_tokens != null) {
              outputTokens = evt.usage.output_tokens;
            }
            if (evt.usage.input_tokens != null) {
              inputTokens = evt.usage.input_tokens;
            }
          }
          if (
            evt.type === "content_block_delta" &&
            evt.delta?.type === "text_delta" &&
            typeof evt.delta.text === "string" &&
            responseText.length < MAX_LOGGED_RESPONSE_TEXT
          ) {
            responseText += evt.delta.text;
          }
          if (evt.type === "message_delta" && evt.delta?.stop_reason) {
            stopReason = evt.delta.stop_reason;
          }
        } catch {
          // ignore unparseable SSE lines
        }
      }
    }
  } finally {
    await incrementUsage(ctx.submissionId, {
      input: inputTokens,
      output: outputTokens,
    });
    logCall({
      submissionId: ctx.submissionId,
      at: new Date(startedAt),
      model,
      stream: true,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
      usage: { input: inputTokens, output: outputTokens },
      requestBytes: Buffer.byteLength(requestJson),
      responseBytes,
      requestSha256,
      responseSha256: responseHash.digest("hex"),
      lastUserText,
      responseText: responseText
        ? responseText.slice(0, MAX_LOGGED_RESPONSE_TEXT)
        : null,
      stopReason,
    });
    res.end();
  }
}

/**
 * POST {PATH}/v1/messages/count_tokens — unmetered passthrough. Claude Code
 * uses it for context-window management; refusing it degrades the tool.
 */
export async function handleCandidateCountTokensProxy(
  req: Request,
  res: Response,
): Promise<void> {
  const ctx = await loadProxyContext(req);
  // An exhausted budget must not break token counting — only real auth
  // failures refuse here, so context management keeps working while the
  // candidate decides what to do about credits.
  if (isRefusal(ctx) && ctx.status !== 429) {
    res.status(ctx.status).json({ error: ctx.error });
    return;
  }
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    res.status(503).json({ error: "anthropic_key_unconfigured" });
    return;
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version":
      (req.headers["anthropic-version"] as string) || "2023-06-01",
  };
  if (req.headers["anthropic-beta"]) {
    headers["anthropic-beta"] = String(req.headers["anthropic-beta"]);
  }

  try {
    const upstream = await fetch(`${ANTHROPIC_API}/v1/messages/count_tokens`, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
  } catch (err) {
    res.status(502).json({
      error: "upstream_unreachable",
      message: err instanceof Error ? err.message : "fetch failed",
    });
  }
}

/**
 * GET {PATH}/usage — the candidate's own credit meter (Bearer proxy token).
 */
export async function handleCandidateLlmUsage(
  req: Request,
  res: Response,
): Promise<void> {
  if (!candidateLlmProxyEnabled()) {
    res.status(503).json({ error: "candidate_llm_proxy_disabled" });
    return;
  }
  const bearer = extractBearer(req);
  if (!bearer) {
    res.status(401).json({ error: "missing_bearer_token" });
    return;
  }
  const submission: any = await SubmissionModel.findOne({
    "llmProxy.tokenHash": hashCandidateLlmToken(bearer),
  })
    .select("assessmentId llmProxy")
    .lean();
  if (!submission) {
    res.status(403).json({ error: "invalid_proxy_token" });
    return;
  }
  const assessment: any = await AssessmentModel.findById(
    submission.assessmentId,
  )
    .select("candidateLlmCredits")
    .lean();
  const budget = Number(assessment?.candidateLlmCredits) || 0;
  const used = Number(submission.llmProxy?.tokensUsed) || 0;
  res.status(200).json({
    creditBudget: budget,
    tokensUsed: used,
    inputTokens: Number(submission.llmProxy?.inputTokensUsed) || 0,
    outputTokens: Number(submission.llmProxy?.outputTokensUsed) || 0,
    calls: Number(submission.llmProxy?.calls) || 0,
    remaining: Math.max(0, budget - used),
    exhausted: budget > 0 && used >= budget,
  });
}
