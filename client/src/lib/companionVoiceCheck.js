/**
 * Pre-start probe for the in-session voice companion.
 *
 * Does not open a conversation — that would speak the opener before the timer.
 * It only checks the two things that otherwise fail after Start: the mic, and
 * whether the browser can reach ElevenLabs (ad blockers typically surface that
 * as TypeError: Failed to fetch).
 */

import { COMPANION_AGENT_ID } from "@/config/companion";

const TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token";

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function probeCompanionVoice(agentId = COMPANION_AGENT_ID) {
  if (!agentId) {
    return { ok: false, reason: "unconfigured" };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "mic_unavailable" };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "NotAllowedError" ? "mic_denied" : "mic_unavailable",
    };
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
