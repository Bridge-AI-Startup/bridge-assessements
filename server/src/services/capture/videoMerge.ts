/**
 * Stream-merge video chunks to disk without holding the full recording in RAM.
 */

import { createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";
import { finished, pipeline } from "stream/promises";

/**
 * Binary-concatenate local files (e.g. WebM chunk files) into destPath.
 * Only one source file is read at a time; writes go through a single stream.
 */
export async function mergeLocalFilesSequential(
  srcPaths: string[],
  destPath: string
): Promise<void> {
  const out = createWriteStream(destPath);
  try {
    for (const p of srcPaths) {
      await pipeline(createReadStream(p), out, { end: false });
    }
    out.end();
    await finished(out);
  } catch (err) {
    out.destroy();
    throw err;
  }
}

/**
 * Append each chunk buffer to destPath as it arrives (one buffer resident at a time).
 */
export async function appendBuffersSequential(
  buffers: AsyncIterable<Buffer> | Iterable<Buffer>,
  destPath: string
): Promise<void> {
  const out = createWriteStream(destPath);
  try {
    for await (const buf of buffers) {
      await pipeline(Readable.from(buf), out, { end: false });
    }
    out.end();
    await finished(out);
  } catch (err) {
    out.destroy();
    throw err;
  }
}
