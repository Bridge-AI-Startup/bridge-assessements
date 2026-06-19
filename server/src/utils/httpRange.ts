export type ByteRange = {
  start: number;
  end: number;
};

/**
 * Parse a single HTTP Range header value (e.g. "bytes=0-1023") against a file size.
 * Returns null when the header is absent, malformed, or unsatisfiable.
 */
export function parseRangeHeader(
  rangeHeader: string | undefined,
  totalSize: number
): ByteRange | null {
  if (!rangeHeader || totalSize <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;

  const [, startStr, endStr] = match;
  let start: number;
  let end: number;

  if (startStr === "" && endStr !== "") {
    // Suffix range: bytes=-500
    const suffixLen = Number(endStr);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    start = Math.max(0, totalSize - suffixLen);
    end = totalSize - 1;
  } else if (startStr !== "" && endStr === "") {
    // Open-ended: bytes=500-
    start = Number(startStr);
    end = totalSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    start = Number(startStr);
    end = Number(endStr);
  } else {
    return null;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= totalSize
  ) {
    return null;
  }

  end = Math.min(end, totalSize - 1);
  return { start, end };
}

export function buildContentRangeHeader(
  start: number,
  end: number,
  totalSize: number
): string {
  return `bytes ${start}-${end}/${totalSize}`;
}

export function rangeContentLength(range: ByteRange): number {
  return range.end - range.start + 1;
}
