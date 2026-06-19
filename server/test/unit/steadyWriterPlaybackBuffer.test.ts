import { describe, expect, it, vi, beforeEach } from "vitest";
import { Readable, Writable } from "stream";

import {
  STEADY_WRITER_DEMO,
  steadyWriterProctoringSession,
} from "../fixtures/steadyWriterDemo.js";
import { streamVideoResponse } from "../../src/utils/streamVideoResponse.js";
import {
  createPlaybackToken,
  verifyPlaybackToken,
} from "../../src/utils/playbackToken.js";

const { mockBuildSessionWebm, mockFsStat } = vi.hoisted(() => ({
  mockBuildSessionWebm: vi.fn(),
  mockFsStat: vi.fn(async () => ({ size: 524_288_000 })),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  const mod = {
    ...actual,
    stat: mockFsStat,
  };
  return {
    ...mod,
    default: mod,
  };
});

vi.mock("../../src/services/capture/sessionVideoMerge.js", () => ({
  buildSessionWebmForPlayback: (...args: unknown[]) =>
    mockBuildSessionWebm(...args),
}));

function createMockRes() {
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as Writable & {
    statusCode: number;
    headers: Record<string, string | number>;
    status: (code: number) => typeof res;
    setHeader: (k: string, v: string | number) => typeof res;
    getBody: () => Buffer;
  };

  res.statusCode = 200;
  res.headers = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (k: string, v: string | number) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.getBody = () => Buffer.concat(chunks);
  return res;
}

describe("Steady writer demo — playback buffer loading", () => {
  beforeEach(() => {
    vi.resetModules();
    mockBuildSessionWebm.mockReset();
    mockFsStat.mockClear();
    mockFsStat.mockResolvedValue({
      size: STEADY_WRITER_DEMO.estimatedPlaybackBytes,
    } as never);
    process.env.AGENT_SECRET = "steady-writer-test-secret";
  });

  it("issues playback token for steady writer session and employer", () => {
    const { token } = createPlaybackToken(
      STEADY_WRITER_DEMO.sessionId,
      STEADY_WRITER_DEMO.employerUserId,
      3600
    );
    const payload = verifyPlaybackToken(token, STEADY_WRITER_DEMO.sessionId);
    expect(payload).toMatchObject({
      sessionId: STEADY_WRITER_DEMO.sessionId,
      userId: STEADY_WRITER_DEMO.employerUserId,
    });
  });

  it("resolves steady writer merged S3 playback for range streaming", async () => {
    const { resolvePlaybackSource } = await import(
      "../../src/services/capture/playbackFileCache.js"
    );
    const session = steadyWriterProctoringSession();
    const storage = {
      exists: vi.fn(async () => true),
      getObjectSize: vi.fn(async () => STEADY_WRITER_DEMO.estimatedPlaybackBytes),
      openReadStream: vi.fn(),
    };

    const source = await resolvePlaybackSource(
      STEADY_WRITER_DEMO.sessionId,
      session as never,
      storage as never
    );

    expect(source).toEqual({
      type: "storage",
      storage,
      key: STEADY_WRITER_DEMO.playbackStorageKey,
      size: STEADY_WRITER_DEMO.estimatedPlaybackBytes,
    });
    expect(mockBuildSessionWebm).not.toHaveBeenCalled();
  });

  it("caches on-demand merge across steady writer range requests", async () => {
    const { resolvePlaybackSource } = await import(
      "../../src/services/capture/playbackFileCache.js"
    );
    const session = {
      ...steadyWriterProctoringSession(),
      mergedVideo: { status: "merging" },
    };
    const cleanup = vi.fn(async () => undefined);
    mockBuildSessionWebm.mockResolvedValue({
      filePath: "/tmp/steady-writer-playback.webm",
      cleanup,
      remuxed: true,
    });

    const storage = {
      exists: vi.fn(async () => false),
      getObjectSize: vi.fn(),
      openReadStream: vi.fn(),
    };

    const first = await resolvePlaybackSource(
      STEADY_WRITER_DEMO.sessionId,
      session as never,
      storage as never
    );
    const second = await resolvePlaybackSource(
      STEADY_WRITER_DEMO.sessionId,
      session as never,
      storage as never
    );

    expect(mockBuildSessionWebm).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      type: "file",
      filePath: "/tmp/steady-writer-playback.webm",
      size: STEADY_WRITER_DEMO.estimatedPlaybackBytes,
    });
    expect(second).toEqual(first);
  });

  it("serves initial byte range (206) without streaming full 31-minute steady writer file", async () => {
    const totalSize = STEADY_WRITER_DEMO.estimatedPlaybackBytes;
    const firstChunk = Buffer.alloc(1024 * 1024, 0x1a);
    const req = { headers: { range: "bytes=0-1048575" } } as never;
    const res = createMockRes();

    await streamVideoResponse(req, res as never, {
      totalSize,
      openStream: async (range) => {
        expect(range).toEqual({ start: 0, end: 1048575 });
        return Readable.from(firstChunk);
      },
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-1048575/${totalSize}`);
    expect(res.headers["content-length"]).toBe("1048576");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.getBody().length).toBe(1024 * 1024);
    expect(res.getBody().length).toBeLessThan(totalSize);
  });

  it("serves metadata-only range for steady writer duration probe", async () => {
    const totalSize = STEADY_WRITER_DEMO.estimatedPlaybackBytes;
    const metadataChunk = Buffer.from("webm-metadata-stub");
    const req = { headers: { range: "bytes=0-65535" } } as never;
    const res = createMockRes();

    await streamVideoResponse(req, res as never, {
      totalSize,
      openStream: async (range) => {
        expect(range).toEqual({ start: 0, end: 65535 });
        return Readable.from(metadataChunk);
      },
    });

    expect(res.statusCode).toBe(206);
    expect(Number(res.headers["content-length"])).toBe(65536);
    expect(res.getBody().equals(metadataChunk)).toBe(true);
  });
});
