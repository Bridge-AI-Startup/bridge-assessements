import { CustomError } from "./errors.ts";

export class ProctoringError extends CustomError {
  static SESSION_NOT_FOUND = new ProctoringError(
    0,
    404,
    "Proctoring session not found"
  );
  static SESSION_ALREADY_EXISTS = new ProctoringError(
    1,
    409,
    "Proctoring session already exists for this submission"
  );
  static CONSENT_NOT_GRANTED = new ProctoringError(
    2,
    403,
    "Screen capture consent has not been granted"
  );
  static SESSION_NOT_ACTIVE = new ProctoringError(
    3,
    400,
    "Proctoring session is not active"
  );
  static INVALID_FRAME_DATA = new ProctoringError(
    4,
    400,
    "Invalid frame data"
  );
  static STORAGE_ERROR = new ProctoringError(
    5,
    500,
    "Failed to store capture data"
  );
  static TRANSCRIPT_GENERATION_DISABLED = new ProctoringError(
    6,
    503,
    "Transcript generation is disabled"
  );
  static TRANSCRIPT_ALREADY_GENERATING = new ProctoringError(
    7,
    409,
    "Transcript is already being generated"
  );
}
