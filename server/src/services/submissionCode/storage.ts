import fs from "fs/promises";
import path from "path";
import {
  MISSING_SUBMISSION_ARCHIVE_MESSAGE,
  S3SubmissionCodeStorage,
} from "./s3Storage.js";

export { MISSING_SUBMISSION_ARCHIVE_MESSAGE };

export interface ISubmissionCodeStorage {
  storeArchive(key: string, buffer: Buffer): Promise<void>;
  readArchive(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export class LocalSubmissionCodeStorage implements ISubmissionCodeStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ||
      process.env.SUBMISSION_UPLOAD_STORAGE_DIR ||
      path.join(process.cwd(), "storage", "submissions");
  }

  private resolvePath(key: string): string {
    const normalizedKey = key.replace(/^\/+/, "");
    const fullPath = path.resolve(this.baseDir, normalizedKey);
    const basePath = path.resolve(this.baseDir);
    if (!fullPath.startsWith(basePath)) {
      throw new Error("Invalid storage key");
    }
    return fullPath;
  }

  async storeArchive(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async readArchive(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolvePath(key));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        throw new Error(MISSING_SUBMISSION_ARCHIVE_MESSAGE);
      }
      throw err;
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
      // Ignore missing files
    }
  }
}

export function shouldUseS3SubmissionStorage(): boolean {
  const backend = process.env.SUBMISSION_UPLOAD_STORAGE_BACKEND?.trim().toLowerCase();
  if (backend === "local") return false;
  if (backend === "s3") return true;
  return Boolean(
    process.env.SUBMISSION_S3_BUCKET?.trim() ||
      process.env.PROCTORING_S3_BUCKET?.trim() ||
      process.env.AWS_S3_BUCKET?.trim()
  );
}

let storageInstance: ISubmissionCodeStorage | null = null;

export function getSubmissionCodeStorage(): ISubmissionCodeStorage {
  if (!storageInstance) {
    if (shouldUseS3SubmissionStorage()) {
      storageInstance = new S3SubmissionCodeStorage();
      console.log(
        `[${new Date().toISOString()}] Submission archive storage: S3 bucket=${
          process.env.SUBMISSION_S3_BUCKET ||
          process.env.PROCTORING_S3_BUCKET ||
          process.env.AWS_S3_BUCKET
        }`
      );
    } else {
      storageInstance = new LocalSubmissionCodeStorage();
    }
  }
  return storageInstance;
}

export function resetSubmissionCodeStorageForTests(): void {
  storageInstance = null;
}
