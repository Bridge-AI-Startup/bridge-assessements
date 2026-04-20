import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { IFrameStorage } from "./storage.js";

function contentTypeForKey(key: string): string | undefined {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".jsonl")) return "application/x-ndjson";
  return undefined;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf-8");
  const stream = body as AsyncIterable<Uint8Array> | undefined;
  if (stream && Symbol.asyncIterator in stream) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("S3 GetObject: unsupported body type");
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

/**
 * AWS S3 implementation of IFrameStorage. Object keys match local layout
 * (e.g. `{sessionId}/frames/...`) so MongoDB `storageKey` fields stay valid.
 */
export class S3FrameStorage implements IFrameStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options?: { bucket?: string; region?: string }) {
    const bucket =
      options?.bucket?.trim() ||
      process.env.PROCTORING_S3_BUCKET?.trim() ||
      process.env.AWS_S3_BUCKET?.trim();
    if (!bucket) {
      throw new Error(
        "S3FrameStorage: set PROCTORING_S3_BUCKET (or AWS_S3_BUCKET) when using S3 proctoring storage"
      );
    }
    const region =
      options?.region?.trim() ||
      process.env.AWS_REGION?.trim() ||
      process.env.AWS_DEFAULT_REGION?.trim();
    if (!region) {
      throw new Error(
        "S3FrameStorage: set AWS_REGION (or AWS_DEFAULT_REGION) when using S3 proctoring storage"
      );
    }
    this.bucket = bucket;
    this.client = new S3Client({ region });
  }

  async storeFrame(key: string, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentTypeForKey(key),
      })
    );
  }

  async getFrame(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const buf = await bodyToBuffer(out.Body);
    return buf;
  }

  async storeTranscript(key: string, content: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: Buffer.from(content, "utf-8"),
        ContentType: contentTypeForKey(key) ?? "text/plain; charset=utf-8",
      })
    );
  }

  async getTranscript(key: string): Promise<string> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const buf = await bodyToBuffer(out.Body);
    return buf.toString("utf-8");
  }

  async storeVideoChunk(key: string, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentTypeForKey(key),
      })
    );
  }

  async getVideoChunk(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    return bodyToBuffer(out.Body);
  }

  /**
   * Returns full S3 object keys under the prefix, using forward slashes
   * (same shape as LocalFrameStorage: `{prefix}/{filename}`).
   */
  async listKeys(prefix: string): Promise<string[]> {
    const normalized = prefix.replace(/^\/+/, "");
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: normalized.length > 0 ? normalized : undefined,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
      );
    } catch {
      // Ignore errors (mirror LocalFrameStorage unlink behavior)
    }
  }
}
