/**
 * Stream-merge video chunks to disk without holding the full recording in RAM.
 */

import { createReadStream, createWriteStream } from "fs";
import type { Writable } from "stream";
import { once } from "events";
import { finished } from "stream/promises";

/**
 * Write one buffer, respecting backpressure.
 *
 * Deliberately NOT `pipeline(src, out, { end: false })` in a loop: pipeline attaches
 * error/close/finish/end listeners to the destination and does not detach them when
 * it is told not to end the stream, so N sources leak ~4N listeners on one WriteStream.
 * A 470-chunk session produced ~1,900 listeners (and a MaxListenersExceededWarning
 * storm) on every playback rebuild. `once(out, "drain")` self-removes and rejects if
 * the stream errors.
 */
async function writeWithBackpressure(out: Writable, chunk: Buffer): Promise<void> {
  if (!out.write(chunk)) {
    await once(out, "drain");
  }
}

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
      for await (const chunk of createReadStream(p)) {
        await writeWithBackpressure(out, chunk as Buffer);
      }
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
      await writeWithBackpressure(out, buf);
    }
    out.end();
    await finished(out);
  } catch (err) {
    out.destroy();
    throw err;
  }
}
