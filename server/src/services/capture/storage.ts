import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import type { Readable } from "stream";
import { pipeline } from "stream/promises";

import { S3FrameStorage } from "./s3FrameStorage.js";

/** Byte range for partial reads; end is inclusive (HTTP Range semantics). */
export interface ByteRange {
  start: number;
  end?: number;
}

/**
 * Interface for frame/transcript storage.
 * Keys follow S3-like paths: {sessionId}/frames/{ts}-{screenIndex}.png
 * Implementations can be swapped (local FS → S3) without changing consumers.
 */
export interface IFrameStorage {
  storeFrame(key: string, buffer: Buffer): Promise<void>;
  getFrame(key: string): Promise<Buffer>;
  storeTranscript(key: string, content: string): Promise<void>;
  getTranscript(key: string): Promise<string>;
  storeVideoChunk(key: string, buffer: Buffer): Promise<void>;
  getVideoChunk(key: string): Promise<Buffer>;
  /** Store a large blob by streaming from a local file (never fully in RAM). */
  storeBlobFromFile(key: string, filePath: string): Promise<void>;
  /** Stream large blobs (e.g. merged playback.webm) without loading fully into RAM. */
  openReadStream(key: string, range?: ByteRange): Promise<Readable>;
  /** Object size in bytes, or null if it doesn't exist. */
  sizeOf(key: string): Promise<number | null>;
  /**
   * Short-lived direct-download URL for the blob (S3 presigned GET), or null when
   * the backend can't serve blobs directly (local FS) and the API must stream it.
   */
  getSignedDownloadUrl(
    key: string,
    options?: { expiresSeconds?: number; downloadFilename?: string }
  ): Promise<string | null>;
  listKeys(prefix: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/**
 * Local filesystem implementation of IFrameStorage.
 * Stores files under a configurable base directory.
 */
export class LocalFrameStorage implements IFrameStorage {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ||
      process.env.PROCTORING_STORAGE_DIR ||
      path.join(process.cwd(), "storage", "proctoring");
  }

  private resolvePath(key: string): string {
    return path.join(this.baseDir, key);
  }

  async storeFrame(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async getFrame(key: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(key));
  }

  async storeTranscript(key: string, content: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  async getTranscript(key: string): Promise<string> {
    return fs.readFile(this.resolvePath(key), "utf-8");
  }

  async storeVideoChunk(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async getVideoChunk(key: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(key));
  }

  async storeBlobFromFile(key: string, filePath: string): Promise<void> {
    const destPath = this.resolvePath(key);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await pipeline(createReadStream(filePath), createWriteStream(destPath));
  }

  async openReadStream(key: string, range?: ByteRange): Promise<Readable> {
    return createReadStream(
      this.resolvePath(key),
      range ? { start: range.start, end: range.end } : undefined
    );
  }

  async sizeOf(key: string): Promise<number | null> {
    try {
      const st = await fs.stat(this.resolvePath(key));
      return st.size;
    } catch {
      return null;
    }
  }

  async getSignedDownloadUrl(): Promise<string | null> {
    return null;
  }

  async listKeys(prefix: string): Promise<string[]> {
    const dirPath = this.resolvePath(prefix);
    try {
      const entries = await fs.readdir(dirPath);
      return entries.map((e) => path.join(prefix, e));
    } catch {
      return [];
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolvePath(key));
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

// Singleton instance
let storageInstance: IFrameStorage | null = null;

function shouldUseS3ProctoringStorage(): boolean {
  const backend = process.env.PROCTORING_STORAGE_BACKEND?.trim().toLowerCase();
  if (backend === "s3") return true;
  if (
    process.env.PROCTORING_S3_BUCKET?.trim() ||
    process.env.AWS_S3_BUCKET?.trim()
  ) {
    return true;
  }
  return false;
}

/**
 * Proctoring blob storage (frames, transcripts, video chunks).
 * Set `PROCTORING_STORAGE_BACKEND=s3` and `PROCTORING_S3_BUCKET` + `AWS_REGION` (+ credentials) for S3;
 * otherwise uses local filesystem under `PROCTORING_STORAGE_DIR`.
 */
export function getFrameStorage(): IFrameStorage {
  if (!storageInstance) {
    if (shouldUseS3ProctoringStorage()) {
      storageInstance = new S3FrameStorage();
      console.log(
        `[${new Date().toISOString()}] Proctoring storage: S3 bucket=${process.env.PROCTORING_S3_BUCKET || process.env.AWS_S3_BUCKET}`
      );
    } else {
      storageInstance = new LocalFrameStorage();
    }
  }
  return storageInstance;
}
