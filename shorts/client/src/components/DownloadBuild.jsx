import { useEffect, useRef, useState } from "react";
import { downloadSubmissionArchive } from "@/api/submissions";

const ERROR_RESET_MS = 2500;

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
    </svg>
  );
}

/**
 * Client-side fallback name when the browser hides Content-Disposition:
 * mirrors the server's slug, with the extension guessed from fileCount
 * (a single-file build is the self-contained serverless index.html).
 */
function fallbackFilename(displayName, fileCount) {
  const slug =
    String(displayName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shorts-build";
  return fileCount === 1 ? `${slug}.html` : `${slug}.zip`;
}

/**
 * Download a build's files to the visitor's machine — a lone self-contained
 * HTML file as itself (double-click to play), multi-file builds as a zip.
 * Fetch-then-save instead of a plain link so a failure shows on the button
 * rather than navigating to a JSON error page.
 */
export default function DownloadBuild({
  submissionId,
  displayName,
  fileCount = null,
  className = "",
}) {
  const [state, setState] = useState("idle"); // idle | busy | failed
  const errorTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(errorTimerRef.current), []);

  async function handleClick() {
    if (state === "busy") return;
    setState("busy");
    try {
      const { blob, filename } = await downloadSubmissionArchive(submissionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || fallbackFilename(displayName, fileCount);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a beat to start the save before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState("idle");
    } catch {
      setState("failed");
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(
        () => setState("idle"),
        ERROR_RESET_MS,
      );
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={state === "busy"}
      className={`btn-pill-secondary gap-1.5 ${className}`}
    >
      <DownloadIcon />
      {state === "busy"
        ? "Preparing…"
        : state === "failed"
          ? "Download failed"
          : "Download"}
    </button>
  );
}
