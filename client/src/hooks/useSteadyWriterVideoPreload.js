import { useState, useEffect } from "react";
import { API_BASE_URL } from "@/config/api";
import {
  getSessionBySubmission,
  getProctoringVideoStreamUrl,
} from "@/api/proctoring";
import { isHardcodedDemoAssessment } from "@/lib/hardcodedBehavioralDemo";
import {
  STEADY_WRITER_DEMO,
  isSteadyWriterSubmission,
  steadyWriterPreloadCache,
} from "@/lib/steadyWriterDemo";
import { buildVideoStreamSrc } from "@/lib/proctoringRecordingLoader";

/**
 * Eagerly resolve the Steady writer playback stream URL and keep a hidden
 * <video preload="auto"> buffering bytes before the Recording tab opens.
 */
export function useSteadyWriterVideoPreload({ assessmentId, currentUser }) {
  const [videoUrl, setVideoUrl] = useState(steadyWriterPreloadCache.videoUrl);
  const enabled =
    isHardcodedDemoAssessment(assessmentId) && Boolean(currentUser);

  useEffect(() => {
    if (!enabled) return;

    if (steadyWriterPreloadCache.videoUrl) {
      setVideoUrl(steadyWriterPreloadCache.videoUrl);
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (!steadyWriterPreloadCache.inFlight) {
        steadyWriterPreloadCache.inFlight = (async () => {
          const token = await currentUser.getIdToken();
          const sessionResult = await getSessionBySubmission(
            STEADY_WRITER_DEMO.submissionId,
            token
          );
          if (!sessionResult.success || !sessionResult.data) {
            throw new Error(sessionResult.error ?? "Session not found");
          }

          const sessionId =
            sessionResult.data._id?.toString?.() ??
            String(sessionResult.data._id);
          const videoResult = await getProctoringVideoStreamUrl(
            sessionId,
            token
          );
          if (!videoResult.success || !videoResult.data) {
            throw new Error(videoResult.error ?? "Playback URL unavailable");
          }

          const streamUrl = buildVideoStreamSrc(
            videoResult.data,
            API_BASE_URL
          );
          steadyWriterPreloadCache.videoUrl = streamUrl;
          return streamUrl;
        })().finally(() => {
          steadyWriterPreloadCache.inFlight = null;
        });
      }

      try {
        const url = await steadyWriterPreloadCache.inFlight;
        if (!cancelled && url) setVideoUrl(url);
      } catch {
        // best-effort preload; Recording tab loader will retry
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [enabled, currentUser]);

  return { videoUrl, enabled };
}
