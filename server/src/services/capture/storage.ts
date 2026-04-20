import fs from "fs/promises";
import path from "path";

import { S3FrameStorage } from "./s3FrameStorage.js";

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
