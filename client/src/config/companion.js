/**
 * The in-session ElevenLabs voice companion is only available when an agent id
 * is configured. Both the overlay and the consent copy read this flag, so a
 * deployment without an agent never asks for the microphone and never claims to.
 */
export const COMPANION_AGENT_ID = import.meta.env?.VITE_ELEVENLABS_AGENT_ID || "";

export const COMPANION_ENABLED = Boolean(COMPANION_AGENT_ID);
