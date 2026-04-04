/**
 * Pure capture utilities — no React, no side effects.
 * Used by proctoring hooks for frame capture, dedup, and size enforcement.
 */

/**
 * Captures a single frame from a MediaStream as a PNG Blob.
 * Uses an offscreen canvas at native stream resolution.
 *
 * @param {MediaStream} stream
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function captureFrameFromStream(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") {
    throw new Error("No active video track on stream");
  }

  const settings = track.getSettings();
  const width = settings.width || 1920;
  const height = settings.height || 1080;

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  await video.play();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);

  video.pause();
  video.srcObject = null;

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return { blob, width, height };
}

/**
 * Computes pixel difference ratio between two ImageData objects.
 * Downscales both to a small thumbnail for fast comparison.
 * Returns 0.0 (identical) to 1.0 (completely different).
 *
 * @param {ImageData} imgDataA
 * @param {ImageData} imgDataB
 * @param {number} thumbSize - Thumbnail size for comparison (default 64)
 * @returns {number}
 */
export function computePixelDiff(imgDataA, imgDataB, thumbSize = 64) {
  const thumbA = downsampleImageData(imgDataA, thumbSize);
  const thumbB = downsampleImageData(imgDataB, thumbSize);

  const pixels = thumbA.length / 4;
  let diffPixels = 0;
  const channelThreshold = 30; // per-channel difference threshold

  for (let i = 0; i < thumbA.length; i += 4) {
    const dr = Math.abs(thumbA[i] - thumbB[i]);
    const dg = Math.abs(thumbA[i + 1] - thumbB[i + 1]);
    const db = Math.abs(thumbA[i + 2] - thumbB[i + 2]);
    if (dr > channelThreshold || dg > channelThreshold || db > channelThreshold) {
      diffPixels++;
    }
  }

  return diffPixels / pixels;
}

/**
 * Downsample ImageData to a fixed-size thumbnail pixel array.
 * Returns a Uint8ClampedArray of RGBA values.
 *
 * @param {ImageData} imageData
 * @param {number} size
 * @returns {Uint8ClampedArray}
 */
function downsampleImageData(imageData, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Create a temporary canvas with the original image data
  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.putImageData(imageData, 0, 0);

  // Draw downscaled
  ctx.drawImage(srcCanvas, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

/**
 * If blob exceeds 20MB, re-encode at reduced quality.
 * Otherwise returns the original blob unchanged.
 *
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
export async function enforceMaxSize(blob) {
  const MAX_SIZE = 20 * 1024 * 1024; // 20MB
  if (blob.size <= MAX_SIZE) return blob;

  // Re-encode as JPEG at 0.85 quality to reduce size
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}

/**
 * Convert a Blob to ImageData for comparison.
 *
 * @param {Blob} blob
 * @returns {Promise<ImageData>}
 */
export async function blobToImageData(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Start a MediaRecorder on a stream. Returns control handles.
 *
 * @param {MediaStream} stream
 * @param {number} timesliceMs - Chunk interval (default 30000ms = 30s)
 * @param {function} [onChunk] - Optional callback invoked with each Blob chunk
 * @returns {{ recorder: MediaRecorder, chunks: Blob[], stop: () => Promise<void> }}
 */
export function createVideoRecorder(stream, timesliceMs = 30000, onChunk) {
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 1_000_000,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
      if (onChunk) onChunk(e.data);
    }
  };

  recorder.start(timesliceMs);

  const stop = () =>
    new Promise((resolve) => {
      if (recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.onstop = () => resolve();
      recorder.stop();
    });

  return { recorder, chunks, stop };
}
