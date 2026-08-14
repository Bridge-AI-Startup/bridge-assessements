import {
  type EvidenceMode,
  shouldCaptureScreen,
  shouldCaptureWorkflow,
} from "../../utils/evidenceMode.js";

export type CompanionSetupFacts = {
  evidenceMode: EvidenceMode;
  hasStarterZip: boolean;
  hasStarterRepo: boolean;
  /** Assessment title only — never pass the description. */
  title?: string | null;
  /** Refresh / remount after the companion has already spoken once. */
  isResume?: boolean;
};

const GREETING =
  "You're in. I'm here as a quick check-in so you can talk through what you're doing as you code — it helps capture your thinking. No pressure, and I won't give hints or answers.";

const RESUME_MESSAGE =
  "Welcome back. I'm still here if you want to talk through what you're working on. No hints or answers from me — just think out loud when it helps.";

const TITLE_SPEAK_MAX = 120;

/**
 * Light project intro from the title only. Never include a description,
 * requirements, or a URL that snuck into the title field.
 */
export function companionTitleSentence(title?: string | null): string | null {
  const cleaned = (title ?? "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const spoken =
    cleaned.length > TITLE_SPEAK_MAX
      ? `${cleaned.slice(0, TITLE_SPEAK_MAX - 1).trimEnd()}…`
      : cleaned;
  return `You're working on ${spoken}. The assignment is on the page — work from what's written there.`;
}

/**
 * Spoken post-start setup: unzip / starter repo, capture-kit command, then a
 * keep-sharing one-liner if the screen is already being recorded. Does not
 * re-brief "share your entire screen" as if they haven't — that was the
 * pre-timer gate.
 */
export function companionSetupSentences(facts: CompanionSetupFacts): string[] {
  const screen = shouldCaptureScreen(facts.evidenceMode);
  const workflow = shouldCaptureWorkflow(facts.evidenceMode);
  const sentences: string[] = [];

  if (facts.hasStarterZip) {
    sentences.push(
      "To start, unzip the starter files that just downloaded and work in that folder, not a blank project."
    );
  } else if (facts.hasStarterRepo) {
    sentences.push(
      "To start, open the starter repository linked on the page and work from those files, not a blank project."
    );
  }

  if (workflow) {
    const fromFolder =
      facts.hasStarterZip || facts.hasStarterRepo
        ? "from that folder"
        : "from your project folder";
    const lead =
      sentences.length === 0
        ? `To start, run the Node command shown on the page ${fromFolder}.`
        : `Then run the Node command shown on the page ${fromFolder}.`;
    sentences.push(
      `${lead} It will tell you exactly what's recorded and ask you to type agree. After that, start your AI assistant in the same folder.`
    );
  }

  if (screen) {
    sentences.push("Keep sharing your entire screen while you work.");
  }

  return sentences;
}

/** First thing the companion says after Start. Resume stays a short welcome-back. */
export function buildCompanionFirstMessage(facts: CompanionSetupFacts): string {
  if (facts.isResume) return RESUME_MESSAGE;

  const parts = [GREETING];
  const titleSentence = companionTitleSentence(facts.title);
  if (titleSentence) parts.push(titleSentence);
  const setup = companionSetupSentences(facts);
  if (setup.length > 0) {
    parts.push(...setup);
  } else {
    parts.push("Ready when you are.");
  }
  return parts.join(" ");
}

/**
 * Notes spliced into the system prompt so a "what do I do first?" recap
 * matches the opener and never invents extra steps.
 */
export function companionSetupPromptNotes(facts: CompanionSetupFacts): string {
  const screen = shouldCaptureScreen(facts.evidenceMode);
  const workflow = shouldCaptureWorkflow(facts.evidenceMode);
  const steps: string[] = [];

  if (screen) {
    steps.push(
      "- They already shared their entire screen to start. Remind them only to keep sharing the full display (not a window or tab). Do not brief them to share as if they haven't."
    );
  }
  if (facts.hasStarterZip) {
    steps.push(
      "- Unzip starter-code.zip and work in that folder — not a blank project."
    );
  } else if (facts.hasStarterRepo) {
    steps.push(
      "- Open the starter GitHub repo linked on the page and work from those files."
    );
  }
  if (workflow) {
    steps.push(
      "- Run the Node setup command shown on the page from that folder, type agree, then start their AI assistant in the same folder. Never read the command, token, or API URL out loud — point them at the page."
    );
  }

  if (steps.length === 0) {
    return "";
  }

  const lostShare =
    screen
      ? `\n\nIf their screen share drops during the assessment, tell them immediately to reshare their entire screen (full display), not a window or tab. They cannot continue without sharing. Do not offer to continue without recording.`
      : "";

  return `## Post-start setup

Screen share (when this assessment records the screen) already happened on the previous screen, before the timer. After Start they still need to unzip or open the starter and run the Node command — help with those if they ask, matching the steps below. Never invent extras, never read the assignment description, and never read out tokens, URLs, or the full command.

${steps.join("\n")}${lostShare}`;
}
