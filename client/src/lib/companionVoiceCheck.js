/**
 * Pre-start probe for the in-session voice companion.
 *
 * Does not open a conversation — that would speak the opener before the timer.
 * It checks three things that otherwise fail after Start: the browser will
 * give us a mic, sound is actually arriving (mute switch / wrong input), and
 * ElevenLabs is reachable (ad blockers typically surface that as
 * TypeError: Failed to fetch).
 */

import { COMPANION_AGENT_ID } from "@/config/companion";
import {
  advanceSpeechHold,
  rmsFromTimeDomain,
  speechHoldReached,
} from "@/lib/micLevel";

export {
  METER_RMS_FULL,
  SPEECH_HOLD_MS,
  SPEECH_RMS_THRESHOLD,
  advanceSpeechHold,
  rmsFromTimeDomain,
  speechHoldReached,
} from "@/lib/micLevel";

const TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token";

export function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  });
}

/**
 * @returns {Promise<{ ok: true, stream: MediaStream } | { ok: false, reason: string }>}
 */
export async function acquireCompanionMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "mic_unavailable" };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { ok: true, stream };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "NotAllowedError" ? "mic_denied" : "mic_unavailable",
    };
  }
}

/**
 * Listen until we hear speech-level audio, or the signal aborts.
 * Does not stop the stream — the caller owns that.
 *
 * @param {MediaStream} stream
 * @param {{ signal?: AbortSignal, onLevel?: (rms: number) => void }} [opts]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function listenForMicrophoneAudio(stream, opts = {}) {
  const { signal, onLevel } = opts;
  if (signal?.aborted) {
    return { ok: false, reason: "cancelled" };
  }

  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    return { ok: false, reason: "mic_unavailable" };
  }

  const ctx = new Context();
  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (ctx.state !== "running") {
      await ctx.close().catch(() => {});
      return { ok: false, reason: "needs_gesture" };
    }

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    return await new Promise((resolve) => {
      let heardMs = 0;
      let last = performance.now();
      let raf = 0;
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(raf);
        signal?.removeEventListener("abort", onAbort);
        try {
          source.disconnect();
        } catch {
          // already disconnected
        }
        void ctx.close().catch(() => {});
        resolve(result);
      };

      const onAbort = () => finish({ ok: false, reason: "cancelled" });
      signal?.addEventListener("abort", onAbort, { once: true });

      const tick = () => {
        if (settled) return;
        analyser.getByteTimeDomainData(data);
        const rms = rmsFromTimeDomain(data);
        onLevel?.(rms);

        const now = performance.now();
        const dt = Math.min(now - last, 100);
        last = now;

        heardMs = advanceSpeechHold(heardMs, rms, dt);
        if (speechHoldReached(heardMs)) {
          finish({ ok: true });
          return;
        }
        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
    });
  } catch {
    await ctx.close().catch(() => {});
    return { ok: false, reason: "mic_unavailable" };
  }
}

/**
 * @param {string} [agentId]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function probeElevenLabsReachability(agentId = COMPANION_AGENT_ID) {
  if (!agentId) {
    return { ok: false, reason: "unconfigured" };
  }

  try {
    const url = `${TOKEN_URL}?agent_id=${encodeURIComponent(agentId)}&source=js_sdk`;
    const response = await fetch(url);
    // 401 means the domain is reachable (agent wants a signed URL). Connectivity
    // is what this probe is for; a public agent returns 200.
    if (response.ok || response.status === 401) {
      return { ok: true };
    }
    return { ok: false, reason: "elevenlabs_http" };
  } catch {
    return { ok: false, reason: "blocked" };
  }
}

export function voiceCheckCopy(reason) {
  switch (reason) {
    case "mic_denied":
      return {
        title: "Allow the microphone",
        body: "The voice check-in needs the mic so you can talk through your work. Allow it in the browser prompt, then try again.",
      };
    case "mic_unavailable":
      return {
        title: "No microphone available",
        body: "Plug in a microphone or pick one in your browser settings, then try again.",
      };
    case "no_audio":
      return {
        title: "We couldn't hear you",
        body: "Unmute the microphone, pick the right input in your browser settings, then try again and say something.",
      };
    case "blocked":
      return {
        title: "Voice check-in is blocked",
        body: "Something on this browser — usually an ad blocker or privacy extension — is blocking the voice check-in. Pause it for this page, then try again.",
      };
    default:
      return {
        title: "Voice check-in couldn't connect",
        body: "Check your connection, pause any ad blocker for this page, then try again.",
      };
  }
}
