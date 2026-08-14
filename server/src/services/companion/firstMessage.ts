import {
  type EvidenceMode,
  shouldCaptureScreen,
  shouldCaptureWorkflow,
} from "../../utils/evidenceMode.js";

export type CompanionSetupFacts = {
  evidenceMode: EvidenceMode;
  hasStarterZip: boolean;
  hasStarterRepo: boolean;
  /** Refresh / remount after the companion has already spoken once. */
  isResume?: boolean;
};

const GREETING =
  "You're about to start a coding problem as part of this assessment. I'm here as a quick check-in so you can talk through what you're doing as you code — it helps capture your thinking. No pressure, and I won't give hints or answers.";

const RESUME_MESSAGE =
  "Welcome back. I'm still here if you want to talk through what you're working on. No hints or answers from me — just think out loud when it helps.";

/**
 * Spoken sentences that match the on-screen "Do this first" / capture-kit
 * instructions. Never includes tokens, URLs, or the full command — those are
 * unspeakable and already on the page.
 */
export function companionSetupSentences(facts: CompanionSetupFacts): string[] {
  const screen = shouldCaptureScreen(facts.evidenceMode);
  const workflow = shouldCaptureWorkflow(facts.evidenceMode);
  const sentences: string[] = [];

  if (screen) {
    sentences.push(
      "To start, make sure you shared your entire screen — not just a window or a tab."
    );
  }

  if (facts.hasStarterZip) {
    sentences.push(
      screen
        ? "Unzip the starter files that just downloaded and work in that folder, not a blank project."
        : "To start, unzip the starter files that just downloaded and work in that folder, not a blank project."
    );
  } else if (facts.hasStarterRepo) {
    sentences.push(
      screen
        ? "Open the starter repository linked on the page and work from those files, not a blank project."
        : "To start, open the starter repository linked on the page and work from those files, not a blank project."
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

  return sentences;
}

/** First thing the companion says. Setup-aware on a fresh start; short on resume. */
export function buildCompanionFirstMessage(facts: CompanionSetupFacts): string {
  if (facts.isResume) return RESUME_MESSAGE;

  const setup = companionSetupSentences(facts);
  if (setup.length === 0) {
    return `${GREETING} Ready when you are.`;
  }
  return `${GREETING} ${setup.join(" ")} Ready when you are.`;
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
      "- Share the entire screen (full display), not a single window or browser tab."
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

  return `## Setup they were walked through

You already said this in your first message. Do not repeat that briefing unless they ask what to do first. If they ask, recap only the steps below — never invent extras, and never read out tokens, URLs, or the full command.

${steps.join("\n")}`;
}
