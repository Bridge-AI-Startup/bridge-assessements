import crypto from "crypto";

/**
 * Shared check for the `X-Agent-Secret` header used by every ElevenLabs
 * agent-facing route (/api/agent-tools/*, /api/workflow-capture/agent-context).
 *
 * Fail-closed: a deployment with no AGENT_SECRET refuses agent requests instead
 * of serving candidate prompts, code, and transcripts unauthenticated.
 */
export function agentSecretConfigured(): boolean {
  return Boolean(process.env.AGENT_SECRET);
}

/** Timing-safe comparison; hashing first avoids leaking length. */
export function agentSecretMatches(provided: unknown): boolean {
  const secret = process.env.AGENT_SECRET;
  if (!secret || typeof provided !== "string") return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}
