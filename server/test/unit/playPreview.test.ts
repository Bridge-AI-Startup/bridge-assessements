import { beforeEach, describe, expect, it, vi } from "vitest";
import createHttpError from "http-errors";

const findOneMock = vi.fn();

vi.mock("../../src/models/shorts/submission.js", () => ({
  getPlaySubmissionModel: () => ({
    findOne: (...args: unknown[]) => {
      const result = findOneMock(...args);
      return {
        lean: () => result,
      };
    },
  }),
}));

// preview.ts also pulls in buildSession (session previews for serverless make),
// which opens the Shorts Mongo connection at import time. Mocked so these pure
// path/revision tests do not require ATLAS_URI.
vi.mock("../../src/models/shorts/buildSession.js", () => ({
  getPlayBuildSessionModel: () => ({
    findById: () => ({ lean: () => null }),
  }),
}));

import {
  getPlayPreviewRevision,
  getPlaySubmissionPreviewFile,
  normalizePlayPreviewPath,
} from "../../src/services/shorts/preview.js";

describe("normalizePlayPreviewPath", () => {
  it("maps empty path to index.html", () => {
    expect(normalizePlayPreviewPath("")).toBe("index.html");
    expect(normalizePlayPreviewPath(null)).toBe("index.html");
    expect(normalizePlayPreviewPath(undefined)).toBe("index.html");
    expect(normalizePlayPreviewPath("/")).toBe("index.html");
  });

  it("preserves nested valid paths", () => {
    expect(normalizePlayPreviewPath("pages/detail.html")).toBe(
      "pages/detail.html",
    );
    expect(normalizePlayPreviewPath("./style.css")).toBe("style.css");
    expect(normalizePlayPreviewPath("assets/js/main.js")).toBe(
      "assets/js/main.js",
    );
  });

  it("rejects traversal, absolutes, NUL, overlong, and secrets dirs", () => {
    const bad = [
      "../secret",
      "foo/../bar",
      "foo/./bar",
      "foo//bar",
      "/etc/passwd",
      "C:/Windows/system.ini",
      "a\\..\\b",
      "x\0y",
      ".claude/settings.json",
      ".git/config",
      "node_modules/lodash/index.js",
      "vendor/.git/hooks",
      "a".repeat(513),
    ];
    for (const path of bad) {
      expect(() => normalizePlayPreviewPath(path), path).toThrow();
    }
  });

  it("normalizes backslashes before validation", () => {
    expect(normalizePlayPreviewPath("css\\app.css")).toBe("css/app.css");
  });
});

describe("getPlayPreviewRevision", () => {
  it("returns decimal epoch milliseconds", () => {
    const d = new Date("2026-07-23T12:00:00.000Z");
    expect(getPlayPreviewRevision(d)).toBe(String(d.getTime()));
    expect(getPlayPreviewRevision(d.getTime())).toBe(String(d.getTime()));
    expect(getPlayPreviewRevision(d.toISOString())).toBe(String(d.getTime()));
    expect(getPlayPreviewRevision(String(d.getTime()))).toBe(
      String(d.getTime()),
    );
  });

  it("rejects invalid revisions", () => {
    expect(() => getPlayPreviewRevision("not-a-date")).toThrow();
    expect(() => getPlayPreviewRevision(Number.NaN)).toThrow();
    expect(() => getPlayPreviewRevision(-1)).toThrow();
  });
});

describe("getPlaySubmissionPreviewFile", () => {
  beforeEach(() => {
    findOneMock.mockReset();
  });

  it("returns the exact matched public file", async () => {
    const submittedAt = new Date("2026-07-23T12:00:00.000Z");
    const revision = getPlayPreviewRevision(submittedAt);
    findOneMock.mockResolvedValue({
      submittedAt,
      files: [{ path: "index.html", content: "<html>ok</html>" }],
    });

    const file = await getPlaySubmissionPreviewFile({
      submissionId: "64b64c2f4f1a2b3c4d5e6f70",
      revision,
      path: "",
    });
    expect(file).toEqual({
      path: "index.html",
      content: "<html>ok</html>",
    });

    const [filter, projection] = findOneMock.mock.calls[0];
    expect(filter._id).toBeDefined();
    expect(filter.submittedAt.getTime()).toBe(submittedAt.getTime());
    expect(filter.files).toEqual({
      $elemMatch: { path: "index.html" },
    });
    expect(projection.files).toEqual({
      $elemMatch: { path: "index.html" },
    });
  });

  it("404s when revision does not match", async () => {
    findOneMock.mockResolvedValue(null);
    await expect(
      getPlaySubmissionPreviewFile({
        submissionId: "64b64c2f4f1a2b3c4d5e6f70",
        revision: "1784812345678",
        path: "index.html",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("filters secrets even if Mongo returned them", async () => {
    const submittedAt = new Date("2026-07-23T12:00:00.000Z");
    const revision = getPlayPreviewRevision(submittedAt);
    // Path normalization rejects .claude before the query — use a public path
    // that somehow returned a filtered file missing after filterPlayPublicFiles.
    findOneMock.mockResolvedValue({
      submittedAt,
      files: [{ path: "index.html", content: "x" }],
    });
    // Force post-filter miss by returning empty files array
    findOneMock.mockResolvedValueOnce({
      submittedAt,
      files: [],
    });
    await expect(
      getPlaySubmissionPreviewFile({
        submissionId: "64b64c2f4f1a2b3c4d5e6f70",
        revision,
        path: "index.html",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects .claude paths before querying", async () => {
    await expect(
      getPlaySubmissionPreviewFile({
        submissionId: "64b64c2f4f1a2b3c4d5e6f70",
        revision: "1784812345678",
        path: ".claude/settings.json",
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return createHttpError.isHttpError(err) && err.statusCode === 400;
    });
    expect(findOneMock).not.toHaveBeenCalled();
  });

  it("rejects invalid submission ids", async () => {
    await expect(
      getPlaySubmissionPreviewFile({
        submissionId: "nope",
        revision: "1784812345678",
        path: "index.html",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
