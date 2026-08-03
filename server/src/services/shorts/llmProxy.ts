/**
 * Play Anthropic Messages proxy — meters challenge tokenBudget per build session.
 * Claude Code in E2B points ANTHROPIC_BASE_URL here; org key never leaves the server.
 */
import crypto from "crypto";
import type { Request, Response } from "express";
import createHttpError from "http-errors";
import { Types } from "mongoose";
import { getShortsLlmProxyPublicUrl } from "../../utils/shortsEnv.js";
import { getPlayBuildSessionModel } from "../../models/shorts/buildSession.js";
import type { Sandbox } from "e2b";
import { runPlayCommand, connectPlaySandbox } from "./sandbox.js";

/** Prefixed onto every `claude -p` turn so first builds edit index.html. */
export const PLAY_CLAUDE_PROMPT_PREAMBLE = [
  "[Bridge Play — required context]",
  "- Workspace: /home/user/project",
  "- Preview opens index.html first — put the home UI there (plus style.css / main.js).",
  "- Extra HTML pages are OK for multi-page apps if linked from index.html.",
  "- Do not leave index.html as the untouched starter while the real app lives only elsewhere.",
  "- You cannot see Preview or DevTools. Never ask the user to open the console or report logs — fix the code yourself.",
  "- Prefer a minimal working app. Watch for missing preventDefault on forms and DOM-ready issues.",
  "- Read CHALLENGE.md for the brief. No Vite/npm/bundlers.",
  "",
  "[User request]",
  "",
].join("\n");

/**
 * Wrap the user chat prompt with workspace rules for Claude Code CLI.
 */
export function wrapPlayClaudePrompt(userPrompt: string): string {
  const trimmed = String(userPrompt || "").trim();
  if (!trimmed) return PLAY_CLAUDE_PROMPT_PREAMBLE;
  // Avoid double-wrapping if a client already sent the preamble.
  if (trimmed.startsWith("[Bridge Play — required context]")) return trimmed;
  return `${PLAY_CLAUDE_PROMPT_PREAMBLE}${trimmed}\n`;
}

import {
  resolvePlayCliModel,
  resolvePlayEffort,
  resolvePlayModel,
  type PlayEffortLevel,
} from "./models.js";
import {
  appendSessionChatMessages,
  refreshSessionWorkspaceSnapshot,
} from "./sessionPersist.js";

const ANTHROPIC_API = "https://api.anthropic.com";

/**
 * Base URL that E2B sandboxes use to reach this server's Play LLM proxy.
 * Must NOT fall back to APP_URL / FRONTEND_URL (those are the React apps).
 * Prefer PLAY_LLM_PROXY_PUBLIC_URL (Render or a tunnel); localhost only works
 * for local unit tests — E2B cannot reach the host's localhost.
 */
export function getPlayLlmProxyPublicBase(): string {
  const raw =
    getShortsLlmProxyPublicUrl() ||
    `http://localhost:${process.env.PORT || 5050}`;
  return raw.replace(/\/$/, "");
}

export function isPlayLlmProxyLikelyUnreachableFromE2b(baseUrl?: string): boolean {
  const base = (baseUrl || getPlayLlmProxyPublicBase()).toLowerCase();
  return (
    base.includes("localhost") ||
    base.includes("127.0.0.1") ||
    base.includes("0.0.0.0")
  );
}

export function generateLlmProxyToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function buildSessionLlmBaseUrl(sessionId: string): string {
  return `${getPlayLlmProxyPublicBase()}/api/shorts/session/${sessionId}/llm`;
}

let proxyHealthCache: { baseUrl: string; checkedAt: number } | null = null;

/** In-flight `claude -p` runs — pause must not kill these (E2B "terminated"). */
const claudeRunsInFlight = new Set<string>();

export function isPlayClaudeRunInFlight(sessionId: string): boolean {
  return claudeRunsInFlight.has(sessionId);
}

export function beginPlayClaudeRun(sessionId: string): void {
  claudeRunsInFlight.add(sessionId);
}

export function endPlayClaudeRun(sessionId: string): void {
  claudeRunsInFlight.delete(sessionId);
}

function formatClaudeRunFailure(err: unknown): string {
  const message =
    err instanceof Error ? err.message : "claude command failed in sandbox";
  // E2B SandboxError when the box is paused/killed mid-stream.
  if (
    /terminated/i.test(message) ||
    /sandbox.*(kill|pause|end of life)/i.test(message)
  ) {
    return (
      "Claude was interrupted because the sandbox paused or disconnected mid-run. " +
      "Keep this tab open while Claude works, then try again."
    );
  }
  return `Claude run failed: ${message}`;
}

async function assertPlayLlmProxyReachable(): Promise<void> {
  const baseUrl = getPlayLlmProxyPublicBase();
  if (isPlayLlmProxyLikelyUnreachableFromE2b(baseUrl)) {
    throw createHttpError(
      503,
      "PLAY_LLM_PROXY_PUBLIC_URL must be a public URL reachable from E2B",
    );
  }

  if (
    proxyHealthCache?.baseUrl === baseUrl &&
    Date.now() - proxyHealthCache.checkedAt < 30_000
  ) {
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/api/shorts/health`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    proxyHealthCache = { baseUrl, checkedAt: Date.now() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "request failed";
    throw createHttpError(
      502,
      `Play LLM proxy is offline at ${baseUrl}. Start or refresh the tunnel (${detail}).`,
    );
  }
}

export function getAnthropicApiKeyOrThrow(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw createHttpError(
      503,
      "ANTHROPIC_API_KEY is not configured on the server",
    );
  }
  return key;
}

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

async function loadActiveSessionForProxy(
  sessionId: string,
  bearerToken: string | null,
) {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw createHttpError(400, "invalid session id");
  }
  if (!bearerToken) {
    throw createHttpError(401, "missing_bearer_token");
  }

  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) {
    throw createHttpError(404, "session_not_found");
  }
  if (!doc.llmProxyToken || doc.llmProxyToken !== bearerToken) {
    throw createHttpError(403, "invalid_proxy_token");
  }
  if (doc.status !== "active") {
    throw createHttpError(400, `session_not_active:${doc.status}`);
  }
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    doc.status = "expired";
    await doc.save();
    throw createHttpError(400, "session_expired");
  }

  const used = doc.tokensUsed ?? 0;
  const budget = doc.tokenBudget;
  if (used >= budget) {
    throw createHttpError(429, "token_budget_exceeded");
  }

  return doc;
}

export function parseUsageFromAnthropicBody(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const usage = (body as { usage?: { input_tokens?: number; output_tokens?: number } })
    .usage;
  if (!usage) return 0;
  return (usage.input_tokens || 0) + (usage.output_tokens || 0);
}

export async function incrementSessionUsage(
  sessionId: string,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  const BuildSession = getPlayBuildSessionModel();
  await BuildSession.updateOne(
    { _id: sessionId },
    {
      $inc: { tokensUsed: tokens, llmCalls: 1 },
    },
  );
}

/**
 * Proxy Anthropic Messages API for a Play build session.
 */
export async function handlePlayMessagesProxy(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = String(req.params.id);
  const bearer = extractBearer(req);
  const doc = await loadActiveSessionForProxy(sessionId, bearer);
  const apiKey = getAnthropicApiKeyOrThrow();

  const wantStream = Boolean(
    req.body &&
      typeof req.body === "object" &&
      (req.body as { stream?: boolean }).stream,
  );

  // Allow Claude Code / Play UI to pick any allowlisted model; rewrite unknown IDs.
  const incoming =
    req.body && typeof req.body === "object"
      ? { ...(req.body as Record<string, unknown>) }
      : {};
  const requested =
    typeof incoming.model === "string" ? incoming.model.trim() : "";
  const model = resolvePlayModel(requested);
  const forwardBody = { ...incoming, model };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version":
      (req.headers["anthropic-version"] as string) || "2023-06-01",
  };
  if (req.headers["anthropic-beta"]) {
    headers["anthropic-beta"] = String(req.headers["anthropic-beta"]);
  }

  const upstream = await fetch(`${ANTHROPIC_API}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(forwardBody),
  });

  if (!wantStream) {
    const text = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave null
    }
    const tokens = parseUsageFromAnthropicBody(parsed);
    await incrementSessionUsage(sessionId, tokens);

    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
    return;
  }

  // Streaming SSE passthrough
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
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            usage?: { input_tokens?: number; output_tokens?: number };
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
        } catch {
          // ignore
        }
      }
    }
  } finally {
    await incrementSessionUsage(sessionId, inputTokens + outputTokens);
    res.end();
  }
}

export type SessionUsage = {
  tokensUsed: number;
  tokenBudget: number;
  llmCalls: number;
  remaining: number;
  exhausted: boolean;
};

export async function getSessionUsage(
  sessionId: string,
  anonymousId: string,
): Promise<SessionUsage> {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw createHttpError(400, "invalid session id");
  }
  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(sessionId);
  if (!doc) throw createHttpError(404, "session_not_found");
  if (doc.anonymousId !== anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  const tokensUsed = doc.tokensUsed ?? 0;
  const tokenBudget = doc.tokenBudget;
  return {
    tokensUsed,
    tokenBudget,
    llmCalls: doc.llmCalls ?? 0,
    remaining: Math.max(0, tokenBudget - tokensUsed),
    exhausted: tokensUsed >= tokenBudget,
  };
}

/**
 * Run `claude -p` in the sandbox and return combined stdout/stderr.
 */
export async function runClaudePrintPrompt(input: {
  sessionId: string;
  anonymousId: string;
  prompt: string;
  model?: string;
  effort?: string;
}): Promise<{ output: string; exitCode: number; model: string; effort: PlayEffortLevel | null }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw createHttpError(400, "prompt is required");
  if (prompt.length > 20_000) {
    throw createHttpError(400, "prompt too long");
  }

  if (!Types.ObjectId.isValid(input.sessionId)) {
    throw createHttpError(400, "invalid session id");
  }

  const BuildSession = getPlayBuildSessionModel();
  const doc = await BuildSession.findById(input.sessionId);
  if (!doc) throw createHttpError(404, "session_not_found");
  if (doc.anonymousId !== input.anonymousId.trim()) {
    throw createHttpError(403, "session_forbidden");
  }
  if (doc.status !== "active" || !doc.e2bSandboxId) {
    throw createHttpError(400, "session_not_active");
  }
  // Building ends at the buzzer. The submit grace window is for saving work
  // only — without this check it would double as extra build time.
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    throw createHttpError(400, "session_expired");
  }
  if ((doc.tokensUsed ?? 0) >= doc.tokenBudget) {
    throw createHttpError(429, "token_budget_exceeded");
  }

  await assertPlayLlmProxyReachable();

  if (isPlayClaudeRunInFlight(input.sessionId)) {
    throw createHttpError(409, "Claude is already running for this session");
  }

  beginPlayClaudeRun(input.sessionId);
  try {
    let sandbox: Sandbox;
    try {
      sandbox = await connectPlaySandbox(doc.e2bSandboxId, {
        timeoutMs: 60 * 60 * 1000,
      });
    } catch {
      throw createHttpError(502, "Sandbox no longer reachable");
    }

    // Write under /home/user — E2B envd often cannot write /tmp (permission denied).
    const promptDir = "/home/user/.claude";
    const promptPath = `${promptDir}/play-claude-prompt.txt`;
    const errPath = `${promptDir}/play-claude.err`;
    try {
      await runPlayCommand(sandbox, `mkdir -p ${promptDir}`, {
        timeoutMs: 10_000,
      });
      await sandbox.files.write(promptPath, wrapPlayClaudePrompt(prompt));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "failed to write prompt into sandbox";
      throw createHttpError(502, `Sandbox write failed: ${message}`);
    }

    const model = resolvePlayModel(input.model);
    const cliModel = resolvePlayCliModel(model);
    const effort = resolvePlayEffort(model, input.effort);
    const modelQ = JSON.stringify(cliModel);
    const apiModelQ = JSON.stringify(model);
    const effortFlags =
      effort && effort !== "auto"
        ? ` --effort ${JSON.stringify(effort)}`
        : "";
    const effortEnv =
      effort && effort !== "auto"
        ? `export CLAUDE_CODE_EFFORT_LEVEL=${JSON.stringify(effort)}`
        : "unset CLAUDE_CODE_EFFORT_LEVEL 2>/dev/null || true";

    const cmd = [
      "set -e",
      'CLAUDE="$(command -v claude 2>/dev/null || true)"',
      'if [ -z "$CLAUDE" ] && [ -x "$HOME/.local/bin/claude" ]; then CLAUDE="$HOME/.local/bin/claude"; fi',
      'if [ -z "$CLAUDE" ]; then echo "claude CLI not found" >&2; exit 127; fi',
      // API-facing id for anything that reads ANTHROPIC_MODEL from the gateway path
      `export ANTHROPIC_MODEL=${apiModelQ}`,
      effortEnv,
      "cd /home/user/project",
      // One invocation only. The old three-command fallback repeated every real
      // upstream failure three times, hiding the actual error behind noisy output.
      `"$CLAUDE" -p "$(cat ${promptPath})" --model ${modelQ}${effortFlags} --output-format text --permission-mode acceptEdits 2>${errPath}`,
      `cat ${errPath} 2>/dev/null || true`,
    ].join("\n");

    let result: Awaited<ReturnType<typeof runPlayCommand>>;
    try {
      result = await runPlayCommand(sandbox, cmd, {
        timeoutMs: 10 * 60 * 1000,
      });
    } catch (err) {
      throw createHttpError(502, formatClaudeRunFailure(err));
    }

    const output = (result.stdout || result.stderr || "").trim();

    try {
      await appendSessionChatMessages(input.sessionId, [
        { role: "user", text: prompt, createdAt: new Date() },
        {
          role: "assistant",
          text: output || "(No output)",
          createdAt: new Date(),
        },
      ]);
      await refreshSessionWorkspaceSnapshot(input.sessionId, sandbox);
    } catch (err) {
      console.warn(
        "[play/llmProxy] chat/snapshot persist failed:",
        err instanceof Error ? err.message : err,
      );
    }

    return {
      output,
      exitCode: result.exitCode ?? 1,
      model,
      effort,
    };
  } finally {
    endPlayClaudeRun(input.sessionId);
  }
}
