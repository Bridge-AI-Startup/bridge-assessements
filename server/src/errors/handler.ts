import { NextFunction, Request, Response } from "express";
import { HttpError } from "http-errors";

import { DEFAULT_SUBMISSION_UPLOAD_MAX_BYTES } from "../config/uploadLimits.js";
import { CustomError } from "./errors";
import { InternalError } from "./internal.ts";

/**
 * Generic Error Handler
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _nxt: NextFunction
) => {
  if (!err) return;
  if (err instanceof CustomError && !(err instanceof InternalError)) {
    console.log(err.displayMessage(true));
    res.status(err.status).send({ error: err.message });
    return;
  }
  if (err instanceof HttpError) {
    console.log("Validation/HTTP Error:", err.message);
    res.status(err.statusCode).send({ error: err.message });
    return;
  }
  const code = (err as { code?: string }).code;
  if (code === "LIMIT_FILE_SIZE") {
    const maxBytes = Number(
      process.env.SUBMISSION_UPLOAD_MAX_BYTES || DEFAULT_SUBMISSION_UPLOAD_MAX_BYTES
    );
    console.log("Upload rejected: archive exceeds limit", maxBytes, "bytes");
    res.status(413).json({
      error: `Archive too large (max ${Math.round(maxBytes / (1024 * 1024))}MB). Zip without node_modules/.git or raise SUBMISSION_UPLOAD_MAX_BYTES in config.`,
      code: "LIMIT_FILE_SIZE",
      maxBytes,
    });
    return;
  }
  console.log("Internal Error", err);
  res.status(500).json({ error: "Unknown Error. Try Again" });
};
