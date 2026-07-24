import { useEffect, useRef, useState } from "react";
import { getSubmission } from "@/api/submissions";
import {
  shouldFetchSubmissionFiles,
  usesApiSubmissionPreviews,
} from "@/config/submissionPreview";
import { useSubmissionPreview } from "@/lib/useSubmissionPreview";

/**
 * Lazy-load a scaled live preview of index.html for a gallery card.
 */
export default function CardPreview({ submissionId, previewRevision }) {
  const hostRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState("idle");
  const [blobFiles, setBlobFiles] = useState(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;

    if (usesApiSubmissionPreviews) {
      setStatus(
        submissionId && previewRevision != null && previewRevision !== ""
          ? "ready"
          : "empty",
      );
      return undefined;
    }

    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const detail = await getSubmission(submissionId, {
          includeFiles: true,
        });
        if (cancelled) return;
        const files = detail.files || [];
        if (!files.length) {
          setBlobFiles(null);
          setStatus("empty");
          return;
        }
        setBlobFiles(files);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setBlobFiles(null);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, submissionId, previewRevision]);

  const preview = useSubmissionPreview({
    submissionId: visible ? submissionId : null,
    previewRevision: visible ? previewRevision : null,
    files: shouldFetchSubmissionFiles ? blobFiles : null,
  });

  const showIframe = status === "ready" && Boolean(preview?.url);
  const showEmpty =
    status === "empty" ||
    status === "error" ||
    (status === "ready" && !preview?.url);

  return (
    <div
      ref={hostRef}
      className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-cream"
    >
      {status === "loading" || status === "idle" ? (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-mist to-line" />
      ) : null}
      {showEmpty ? (
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center font-mono text-[11px] text-fog-light">
          {status === "error" ? "Preview unavailable" : "No index.html"}
        </div>
      ) : null}
      {showIframe ? (
        <iframe
          title="Build preview"
          src={preview.url}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{
            width: "250%",
            height: "250%",
            transform: "scale(0.4)",
          }}
          sandbox="allow-scripts allow-same-origin"
          tabIndex={-1}
          loading="lazy"
        />
      ) : null}
    </div>
  );
}
