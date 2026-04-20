/**
 * Default max .zip size for `POST /api/submissions/token/:token/upload` when
 * `SUBMISSION_UPLOAD_MAX_BYTES` is unset. Override in config.env for your host.
 */
export const DEFAULT_SUBMISSION_UPLOAD_MAX_BYTES = 500 * 1024 * 1024; // 500 MiB
