export function isClientStreamAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return (
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    code === "ERR_STREAM_UNABLE_TO_PIPE" ||
    code === "ABORT_ERR"
  );
}
