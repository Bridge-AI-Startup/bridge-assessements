import { describe, expect, it, vi } from "vitest";

// download.ts reaches the Shorts submission model, and shortsConnection.ts
// throws at import time without ATLAS_URI. Only pure helpers are tested here.
vi.hoisted(() => {
  process.env.ATLAS_URI ||= "mongodb://127.0.0.1:27017/shorts-download-test";
});

import {
  playDownloadBaseName,
  renderPlayDownloadAbout,
  resolvePlayDownloadFileName,
} from "../../src/services/shorts/download.js";

describe("playDownloadBaseName", () => {
  it("slugs a free-form display name", () => {
    expect(playDownloadBaseName("Sam's Maze Runner!!")).toBe("sams-maze-runner");
    expect(playDownloadBaseName("  Word Clock  ")).toBe("word-clock");
  });

  it("strips accents", () => {
    expect(playDownloadBaseName("Café Défense")).toBe("cafe-defense");
  });

  it("falls back for names that slug to nothing", () => {
    expect(playDownloadBaseName("🎮🎮🎮")).toBe("shorts-build");
    expect(playDownloadBaseName("")).toBe("shorts-build");
    expect(playDownloadBaseName(null)).toBe("shorts-build");
  });

  it("caps length without leaving a trailing dash", () => {
    const name = playDownloadBaseName(`${"a".repeat(39)} trailing words here`);
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.endsWith("-")).toBe(false);
  });
});

describe("resolvePlayDownloadFileName", () => {
  it("downloads a lone file as itself with its extension", () => {
    expect(
      resolvePlayDownloadFileName("word-clock", [
        { path: "index.html", content: "<!DOCTYPE html>" },
      ]),
    ).toEqual({ kind: "file", fileName: "word-clock.html" });
  });

  it("keeps a lone extensionless file bare", () => {
    expect(
      resolvePlayDownloadFileName("thing", [{ path: "README", content: "x" }]),
    ).toEqual({ kind: "file", fileName: "thing" });
  });

  it("zips multi-file builds", () => {
    expect(
      resolvePlayDownloadFileName("word-clock", [
        { path: "index.html", content: "a" },
        { path: "app.js", content: "b" },
      ]),
    ).toEqual({ kind: "zip", fileName: "word-clock.zip" });
  });
});

describe("renderPlayDownloadAbout", () => {
  it("names the build, round, and submission page", () => {
    const text = renderPlayDownloadAbout({
      baseName: "word-clock",
      displayName: "Word Clock",
      challengeSlug: "make-time-visible",
      challengeDate: "2026-08-17",
      submissionUrl: "https://shorts.bridge-jobs.com/Submission?id=abc",
      files: [],
    });
    expect(text).toContain("Word Clock");
    expect(text).toContain("2026-08-17");
    expect(text).toContain("https://shorts.bridge-jobs.com/Submission?id=abc");
    expect(text).toContain("index.html");
  });
});
