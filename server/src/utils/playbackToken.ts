import crypto from "crypto";

const DEFAULT_TTL_SEC = 60 * 60; // 1 hour

function getPlaybackSecret(): string {
  const secret =
    process.env.PLAYBACK_TOKEN_SECRET?.trim() ||
    process.env.AGENT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "PLAYBACK_TOKEN_SECRET or AGENT_SECRET must be set for video playback tokens"
    );
  }
  return secret;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(pad), "base64");
}

export type PlaybackTokenPayload = {
  sessionId: string;
  userId: string;
  exp: number;
};

export function createPlaybackToken(
  sessionId: string,
  userId: string,
  ttlSec: number = DEFAULT_TTL_SEC
): { token: string; expiresAt: Date } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload: PlaybackTokenPayload = {
    sessionId,
    userId,
    exp,
  };
  const payloadB64 = base64UrlEncode(
    Buffer.from(JSON.stringify(payload), "utf-8")
  );
  const sig = crypto
    .createHmac("sha256", getPlaybackSecret())
    .update(payloadB64)
    .digest();
  const sigB64 = base64UrlEncode(sig);
  return {
    token: `${payloadB64}.${sigB64}`,
    expiresAt: new Date(exp * 1000),
  };
}

export function verifyPlaybackToken(
  token: string,
  expectedSessionId: string
): PlaybackTokenPayload | null {
  if (!token || typeof token !== "string") return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let expectedSig: Buffer;
  try {
    expectedSig = crypto
      .createHmac("sha256", getPlaybackSecret())
      .update(payloadB64)
      .digest();
    const actualSig = base64UrlDecode(sigB64);
    if (
      actualSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(actualSig, expectedSig)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  let payload: PlaybackTokenPayload;
  try {
    payload = JSON.parse(
      base64UrlDecode(payloadB64).toString("utf-8")
    ) as PlaybackTokenPayload;
  } catch {
    return null;
  }

  if (
    !payload.sessionId ||
    !payload.userId ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.sessionId !== expectedSessionId) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

export function getPlaybackTokenTtlSec(): number {
  const raw = process.env.PLAYBACK_TOKEN_TTL_SEC?.trim();
  if (!raw) return DEFAULT_TTL_SEC;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
}
