import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const KEY_PREFIX = "submissions/";

function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return Promise.resolve(body);
  if (body instanceof Uint8Array) return Promise.resolve(Buffer.from(body));
  if (typeof body === "string") return Promise.resolve(Buffer.from(body, "utf-8"));
  const stream = body as AsyncIterable<Uint8Array> | undefined;
  if (stream && Symbol.asyncIterator in stream) {
    return (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    })();
  }
  return Promise.reject(new Error("S3 GetObject: unsupported body type"));
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

export const MISSING_SUBMISSION_ARCHIVE_MESSAGE =
  "Submitted archive is missing from storage. Re-upload the project folder.";

/**
 * S3 implementation of submission zip storage. Object keys are
 * `submissions/{mongoKey}` so they stay namespaced from proctoring blobs
 * in the same bucket. Mongo `codeUpload.storageKey` stays `{id}/archives/…`.
 */
export class S3SubmissionCodeStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options?: { bucket?: string; region?: string }) {
    const bucket =
      options?.bucket?.trim() ||
      process.env.SUBMISSION_S3_BUCKET?.trim() ||
      process.env.PROCTORING_S3_BUCKET?.trim() ||
      process.env.AWS_S3_BUCKET?.trim();
    if (!bucket) {
      throw new Error(
        "S3SubmissionCodeStorage: set SUBMISSION_S3_BUCKET, PROCTORING_S3_BUCKET, or AWS_S3_BUCKET"
      );
    }
    const region =
      options?.region?.trim() ||
      process.env.AWS_REGION?.trim() ||
      process.env.AWS_DEFAULT_REGION?.trim();
    if (!region) {
      throw new Error(
        "S3SubmissionCodeStorage: set AWS_REGION (or AWS_DEFAULT_REGION)"
      );
    }
    this.bucket = bucket;
    this.client = new S3Client({ region });
  }

  private objectKey(key: string): string {
    const normalized = key.replace(/^\/+/, "");
    if (!normalized || normalized.includes("..")) {
      throw new Error("Invalid storage key");
    }
    return `${KEY_PREFIX}${normalized}`;
  }

  async storeArchive(key: string, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: buffer,
        ContentType: "application/zip",
      })
    );
  }

  async readArchive(key: string): Promise<Buffer> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
        })
      );
      return bodyToBuffer(out.Body);
    } catch (err) {
      if (isNotFound(err)) {
        throw new Error(MISSING_SUBMISSION_ARCHIVE_MESSAGE);
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
        })
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
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
        })
      );
    } catch {
      // Ignore missing objects
    }
  }
}
