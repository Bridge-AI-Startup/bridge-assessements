import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalSubmissionCodeStorage,
  MISSING_SUBMISSION_ARCHIVE_MESSAGE,
  resetSubmissionCodeStorageForTests,
  shouldUseS3SubmissionStorage,
} from "../../src/services/submissionCode/storage.js";

describe("LocalSubmissionCodeStorage", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("round-trips an archive and rejects path traversal", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sub-code-"));
    const storage = new LocalSubmissionCodeStorage(dir);
    const key = "abc123/archives/file.zip";
    const body = Buffer.from("PK\u0003\u0004zip");
    await storage.storeArchive(key, body);
    expect(await storage.exists(key)).toBe(true);
    expect(await storage.readArchive(key)).toEqual(body);
    await expect(storage.storeArchive("../etc/passwd", body)).rejects.toThrow(
      "Invalid storage key"
    );
  });

  it("throws a stable message when the zip is missing", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sub-code-"));
    const storage = new LocalSubmissionCodeStorage(dir);
    await expect(
      storage.readArchive("missing/archives/gone.zip")
    ).rejects.toThrow(MISSING_SUBMISSION_ARCHIVE_MESSAGE);
  });
});

describe("shouldUseS3SubmissionStorage", () => {
  const keys = [
    "SUBMISSION_UPLOAD_STORAGE_BACKEND",
    "SUBMISSION_S3_BUCKET",
    "PROCTORING_S3_BUCKET",
    "AWS_S3_BUCKET",
  ] as const;
  const prior = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );

  afterEach(() => {
    for (const key of keys) {
      if (prior[key] == null) delete process.env[key];
      else process.env[key] = prior[key];
    }
    resetSubmissionCodeStorageForTests();
  });

  it("uses local when no bucket is configured", () => {
    for (const key of keys) delete process.env[key];
    expect(shouldUseS3SubmissionStorage()).toBe(false);
  });

  it("uses S3 when a bucket is set, unless backend=local", () => {
    for (const key of keys) delete process.env[key];
    process.env.PROCTORING_S3_BUCKET = "bridge-proctoring";
    expect(shouldUseS3SubmissionStorage()).toBe(true);
    process.env.SUBMISSION_UPLOAD_STORAGE_BACKEND = "local";
    expect(shouldUseS3SubmissionStorage()).toBe(false);
  });
});
