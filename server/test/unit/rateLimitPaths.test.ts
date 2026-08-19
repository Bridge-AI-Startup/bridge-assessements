import { describe, expect, it } from "vitest";
import {
  isProctoringPath,
  isShortsApiPath,
  isShortsPreviewPath,
  skipGeneralApiLimit,
} from "../../src/utils/rateLimitPaths.js";

describe("rateLimitPaths", () => {
  it("keeps assessment CRUD on the general API bucket", () => {
    expect(skipGeneralApiLimit("/api/assessments")).toBe(false);
    expect(skipGeneralApiLimit("/api/submissions/token/abc")).toBe(false);
    expect(skipGeneralApiLimit("/api/users/whoami")).toBe(false);
  });

  it("takes Shorts Build traffic off the general 100/15min bucket", () => {
    const shortsHotPaths = [
      "/api/shorts/session/abc",
      "/api/shorts/session/abc/usage",
      "/api/shorts/session/abc/workspace-revision",
      "/api/shorts/session/abc/claude/message",
      "/api/shorts/session/abc/llm/v1/messages",
      "/api/shorts/session/abc/preview",
      "/api/shorts/session/abc/preview/index.html",
      "/api/shorts/vote/next",
      "/api/shorts/today",
      "/api/play/session/abc/usage",
    ];
    for (const path of shortsHotPaths) {
      expect(isShortsApiPath(path), path).toBe(true);
      expect(skipGeneralApiLimit(path), path).toBe(true);
    }
  });

  it("still classifies gallery preview assets separately", () => {
    expect(isShortsPreviewPath("/api/shorts/preview/id/rev/index.html")).toBe(
      true,
    );
    expect(isShortsPreviewPath("/api/shorts/session/abc/preview")).toBe(false);
    expect(isShortsPreviewPath("/api/shorts/session/abc/usage")).toBe(false);
  });

  it("strips query strings before matching", () => {
    expect(skipGeneralApiLimit("/api/shorts/session/abc?anonymousId=x")).toBe(
      true,
    );
    expect(isShortsPreviewPath("/api/shorts/preview/id/rev?x=1")).toBe(true);
    expect(isProctoringPath("/api/proctoring/sessions/x/frames?n=1")).toBe(
      true,
    );
  });
});
