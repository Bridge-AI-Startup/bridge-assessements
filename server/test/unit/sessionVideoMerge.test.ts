import { describe, expect, it } from "vitest";

import {
  mergeLockIsLive,
  resolveSessionVideoChunkKeys,
} from "../../src/services/capture/sessionVideoMerge.js";

const fakeStorage = {
  listKeys: async (prefix: string) => fakeStorage._keys.filter((k) => k.startsWith(prefix)),
  getVideoChunk: async () => Buffer.from(""),
  _keys: [] as string[],
};

describe("sessionVideoMerge.resolveSessionVideoChunkKeys", () => {
  it("orders screen-0 chunks from the session by startTime", async () => {
    const session = {
      videoChunks: [
        { storageKey: "s/video/2.webm", startTime: new Date(2000), screenIndex: 0 },
        { storageKey: "s/video/1.webm", startTime: new Date(1000), screenIndex: 0 },
        { storageKey: "s/video/x.webm", startTime: new Date(500), screenIndex: 1 },
      ],
    };
    const out = await resolveSessionVideoChunkKeys("s", session as any, fakeStorage as any);
    expect(out.map((c) => c.storageKey)).toEqual(["s/video/1.webm", "s/video/2.webm"]);
  });

  it("falls back to listing storage keys (screen 0, sorted by ts) when no chunks on session", async () => {
    fakeStorage._keys = [
      "sess/video/200-0.webm",
      "sess/video/100-0.webm",
      "sess/video/150-1.webm",
      "sess/video/ignore.txt",
    ];
    const out = await resolveSessionVideoChunkKeys("sess", { videoChunks: [] } as any, fakeStorage as any);
    expect(out.map((c) => c.storageKey)).toEqual([
      "sess/video/100-0.webm",
      "sess/video/200-0.webm",
    ]);
  });

  it("returns [] when there are no chunks anywhere", async () => {
    fakeStorage._keys = [];
    const out = await resolveSessionVideoChunkKeys("none", null, fakeStorage as any);
    expect(out).toEqual([]);
  });
});

describe("sessionVideoMerge.mergeLockIsLive", () => {
  const now = Date.parse("2026-08-13T21:35:00.000Z");

  it("is live when this process is merging the session", () => {
    expect(
      mergeLockIsLive(
        { status: "merging", mergingStartedAt: new Date(now - 60_000) },
        "s1",
        now,
        new Set(["s1"]),
      ),
    ).toBe(true);
  });

  it("is dead after a restart (not in-process, lock older than grace)", () => {
    expect(
      mergeLockIsLive(
        { status: "merging", mergingStartedAt: new Date(now - 60_000) },
        "s1",
        now,
        new Set(),
      ),
    ).toBe(false);
  });

  it("is live for a brand-new claim from another instance", () => {
    expect(
      mergeLockIsLive(
        { status: "merging", mergingStartedAt: new Date(now - 5_000) },
        "s1",
        now,
        new Set(),
      ),
    ).toBe(true);
  });

  it("is not a lock when status is not merging", () => {
    expect(
      mergeLockIsLive({ status: "ready" }, "s1", now, new Set()),
    ).toBe(false);
  });
});
