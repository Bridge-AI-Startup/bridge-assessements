import fs from "fs/promises";
import path from "path";

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
    return fs.readFile(this.resolvePath(key));
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

let storageInstance: ISubmissionCodeStorage | null = null;

export function getSubmissionCodeStorage(): ISubmissionCodeStorage {
  if (!storageInstance) {
    storageInstance = new LocalSubmissionCodeStorage();
  }
  return storageInstance;
}
