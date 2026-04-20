import fs from "fs/promises";
import path from "path";

export interface IGradingEvidenceStorage {
  storeArtifact(key: string, buffer: Buffer): Promise<void>;
  storeText(key: string, content: string): Promise<void>;
  readArtifact(key: string): Promise<Buffer>;
  readText(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export class LocalGradingEvidenceStorage implements IGradingEvidenceStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ||
      process.env.GRADING_STORAGE_DIR ||
      path.join(process.cwd(), "storage", "grading");
  }

  private resolvePath(key: string): string {
    return path.join(this.baseDir, key);
  }

  async storeArtifact(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async storeText(key: string, content: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  async readArtifact(key: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(key));
  }

  async readText(key: string): Promise<string> {
    return fs.readFile(this.resolvePath(key), "utf-8");
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }
}

let gradingEvidenceStorageInstance: IGradingEvidenceStorage | null = null;

export function getGradingEvidenceStorage(): IGradingEvidenceStorage {
  if (!gradingEvidenceStorageInstance) {
    gradingEvidenceStorageInstance = new LocalGradingEvidenceStorage();
  }
  return gradingEvidenceStorageInstance;
}
