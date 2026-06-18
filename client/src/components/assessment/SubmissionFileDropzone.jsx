import { useCallback, useRef, useState } from "react";
import { Upload, FolderOpen, FileArchive, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildSubmissionArchiveFromDataTransfer,
  buildSubmissionArchiveFromFileList,
  formatBytes,
  MAX_SUBMISSION_ARCHIVE_BYTES,
} from "@/lib/submissionArchive";

export default function SubmissionFileDropzone({
  disabled = false,
  archiveInfo = null,
  onArchiveReady,
  onClear,
  compact = false,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const prepareArchive = useCallback(
    async (promise) => {
      setError(null);
      setIsPreparing(true);
      try {
        const result = await promise;
        onArchiveReady?.(result.archive, result);
      } catch (err) {
        setError(err?.message || "Failed to prepare your project archive.");
        onClear?.();
      } finally {
        setIsPreparing(false);
      }
    },
    [onArchiveReady, onClear]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled || isPreparing) return;
      prepareArchive(buildSubmissionArchiveFromDataTransfer(e.dataTransfer));
    },
    [disabled, isPreparing, prepareArchive]
  );

  const onDragOver = useCallback(
    (e) => {
      e.preventDefault();
      if (disabled || isPreparing) return;
      e.dataTransfer.dropEffect = "copy";
      setIsDragging(true);
    },
    [disabled, isPreparing]
  );

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  }, []);

  const onFileInputChange = useCallback(
    (e) => {
      const files = e.target?.files;
      if (!files?.length) return;
      prepareArchive(buildSubmissionArchiveFromFileList(files));
      e.target.value = "";
    },
    [prepareArchive]
  );

  const handleClear = () => {
    setError(null);
    onClear?.();
  };

  if (archiveInfo) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <FileArchive className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-900 truncate">
                {archiveInfo.label}
              </p>
              <p className="text-xs text-emerald-800 mt-0.5">
                {archiveInfo.fileCount} file{archiveInfo.fileCount !== 1 ? "s" : ""}{" "}
                · {archiveInfo.sizeLabel}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-emerald-800 hover:text-emerald-950 hover:bg-emerald-100"
            onClick={handleClear}
            disabled={disabled || isPreparing}
            aria-label="Remove uploaded files"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          "rounded-lg border-2 border-dashed transition-colors",
          compact ? "p-4" : "p-6",
          disabled || isPreparing
            ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed"
            : isDragging
              ? "border-[#1E3A8A] bg-blue-50"
              : "border-gray-300 bg-gray-50 hover:border-gray-400",
        ].join(" ")}
      >
        <div className="flex flex-col items-center text-center gap-2">
          {isPreparing ? (
            <Loader2 className="w-8 h-8 text-[#1E3A8A] animate-spin" />
          ) : (
            <Upload className="w-8 h-8 text-gray-400" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-900">
              {isPreparing
                ? "Preparing your project archive..."
                : "Drag and drop your project here"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Drop a folder, files, or a .zip (max {formatBytes(MAX_SUBMISSION_ARCHIVE_BYTES)})
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || isPreparing}
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Choose folder
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || isPreparing}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileArchive className="w-4 h-4 mr-2" />
              Choose files
            </Button>
          </div>
        </div>
      </div>

      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        webkitdirectory=""
        onChange={onFileInputChange}
        disabled={disabled || isPreparing}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".zip,application/zip"
        onChange={onFileInputChange}
        disabled={disabled || isPreparing}
      />

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
