import type { Request, Response } from "express";
import { pipeline } from "stream/promises";
import type { Readable } from "stream";

import {
  buildContentRangeHeader,
  parseRangeHeader,
  rangeContentLength,
  type ByteRange,
} from "./httpRange.js";
import { isClientStreamAbortError } from "./streamErrors.js";

export type StreamVideoOptions = {
  totalSize: number;
  contentType?: string;
  disposition?: "inline" | "attachment";
  filename?: string;
  openStream: (range: ByteRange | null) => Promise<Readable>;
};

/**
 * Stream a video file with HTTP Range support (206 Partial Content).
 * Sets Accept-Ranges, Content-Length, and Content-Range as appropriate.
 */
export async function streamVideoResponse(
  req: Request,
  res: Response,
  options: StreamVideoOptions
): Promise<void> {
  const {
    totalSize,
    contentType = "video/webm",
    disposition = "inline",
    filename,
    openStream,
  } = options;

  if (totalSize <= 0) {
    res.status(404).json({ error: "Video file is empty" });
    return;
  }

  const range = parseRangeHeader(
    typeof req.headers.range === "string" ? req.headers.range : undefined,
    totalSize
  );

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);

  if (disposition === "attachment" && filename) {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
  } else {
    res.setHeader("Content-Disposition", "inline");
  }

  if (range) {
    const length = rangeContentLength(range);
    res.status(206);
    res.setHeader("Content-Length", String(length));
    res.setHeader(
      "Content-Range",
      buildContentRangeHeader(range.start, range.end, totalSize)
    );
    const stream = await openStream(range);
    try {
      await pipeline(stream, res);
    } catch (err) {
      if (isClientStreamAbortError(err)) return;
      throw err;
    }
    return;
  }

  res.status(200);
  res.setHeader("Content-Length", String(totalSize));
  const stream = await openStream(null);
  try {
    await pipeline(stream, res);
  } catch (err) {
    if (isClientStreamAbortError(err)) return;
    throw err;
  }
}
