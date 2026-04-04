import { Monitor, Upload, AlertCircle, CheckCircle } from "lucide-react";

/**
 * Panel displaying upload stats for the proctoring session.
 * Shown in the bottom-right during an active recording.
 */
export default function StreamStatusPanel({
  frameCount = 0,
  uploadedCount = 0,
  failedCount = 0,
  duplicatesSkipped = 0,
  isUploading = false,
}) {
  const pending = frameCount - uploadedCount - failedCount;

  return (
    <div className="fixed bottom-4 right-4 z-40 bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1.5 min-w-[180px]">
      <div className="flex items-center gap-2 text-gray-700 font-medium border-b border-gray-100 pb-1.5">
        <Monitor className="w-3.5 h-3.5" />
        Recording Stats
      </div>

      <div className="flex items-center justify-between text-gray-600">
        <span>Captured</span>
        <span className="font-mono">{frameCount}</span>
      </div>

      <div className="flex items-center justify-between text-gray-600">
        <span className="flex items-center gap-1">
          <Upload className="w-3 h-3" />
          Uploaded
        </span>
        <span className="font-mono">{uploadedCount}</span>
      </div>

      {failedCount > 0 && (
        <div className="flex items-center justify-between text-red-600">
          <span className="flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Failed
          </span>
          <span className="font-mono">{failedCount}</span>
        </div>
      )}

      {duplicatesSkipped > 0 && (
        <div className="flex items-center justify-between text-gray-400">
          <span className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            Deduped
          </span>
          <span className="font-mono">{duplicatesSkipped}</span>
        </div>
      )}

      {isUploading && (
        <div className="text-blue-600 flex items-center gap-1 pt-1 border-t border-gray-100">
          <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
          Uploading...
        </div>
      )}
    </div>
  );
}
