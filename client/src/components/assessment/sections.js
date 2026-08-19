/**
 * Section ids shared by the assessment editor, its "add to context" chips, and
 * the Bridge Assistant.
 *
 * These strings are a contract with the server: `allowedSections` is sent using
 * them, and `changedSections` comes back using them. They must stay in lockstep
 * with `CHAT_EDITABLE_SECTIONS` in `server/src/services/assessmentChat.ts` —
 * a name only one side knows is silently ignored by the other.
 */
export const SECTION_LABELS = {
  projectDescription: "Project Description",
  title: "Title",
  timeLimit: "Time Limit",
  behavioralChecks: "Product Checks",
  evaluationCriteria: "Evaluation Criteria",
  // Editable in the UI, but not by the assistant — pinning it scopes the
  // assistant to nothing, which it will say rather than guess.
  starterFiles: "Starter Files",
};

/** Sections the assistant is allowed to write. Mirrors the server's list. */
export const ASSISTANT_EDITABLE_SECTIONS = [
  "projectDescription",
  "title",
  "timeLimit",
  "behavioralChecks",
  "evaluationCriteria",
];

export function sectionLabel(section) {
  return SECTION_LABELS[section] || section;
}
