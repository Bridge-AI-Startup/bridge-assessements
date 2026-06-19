import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createPlaybackToken,
  verifyPlaybackToken,
} from "../../src/utils/playbackToken.js";

describe("playbackToken", () => {
  const prevSecret = process.env.AGENT_SECRET;

  beforeEach(() => {
    process.env.AGENT_SECRET = "test-playback-secret";
  });

  afterEach(() => {
    if (prevSecret === undefined) {
      delete process.env.AGENT_SECRET;
    } else {
      process.env.AGENT_SECRET = prevSecret;
    }
  });

  it("creates and verifies a valid token", () => {
    const { token } = createPlaybackToken("sess123", "user456", 3600);
    const payload = verifyPlaybackToken(token, "sess123");
    expect(payload).toMatchObject({
      sessionId: "sess123",
      userId: "user456",
    });
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects expired tokens", () => {
    const { token } = createPlaybackToken("sess123", "user456", -10);
    expect(verifyPlaybackToken(token, "sess123")).toBeNull();
  });

  it("rejects session id mismatch", () => {
    const { token } = createPlaybackToken("sess123", "user456", 3600);
    expect(verifyPlaybackToken(token, "other")).toBeNull();
  });

  it("rejects tampered tokens", () => {
    const { token } = createPlaybackToken("sess123", "user456", 3600);
    const tampered = token.slice(0, -4) + "xxxx";
    expect(verifyPlaybackToken(tampered, "sess123")).toBeNull();
  });
});
