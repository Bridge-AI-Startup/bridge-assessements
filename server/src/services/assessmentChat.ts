import { PROMPT_ASSESSMENT_CHAT } from "../prompts/index.js";
import {
  createChatCompletion,
  initializeLangChainAI,
  type ChatMessage,
} from "./langchainAI.js";

// Initialize LangChain AI on module load
initializeLangChainAI();

/**
 * Sections the assistant is allowed to touch. These ids are the contract between
 * the prompt, the editor's "add to context" chips, and the persistence layer —
 * a name that is not in here reaches the model as a restriction it cannot honour.
 */
export const CHAT_EDITABLE_SECTIONS = [
  "projectDescription",
  "title",
  "timeLimit",
  "behavioralChecks",
  "evaluationCriteria",
] as const;

export type ChatEditableSection = (typeof CHAT_EDITABLE_SECTIONS)[number];

const SECTION_LABELS: Record<ChatEditableSection, string> = {
  projectDescription: "Project Description",
  title: "Title",
  timeLimit: "Time Limit",
  behavioralChecks: "Product Checks",
  evaluationCriteria: "Evaluation Criteria",
};

/**
 * How many prior turns of the conversation are replayed to the model. The chat
 * lives beside a full assessment brief in the same context window, so this is
 * kept short deliberately — enough for "make that a bit shorter" to resolve,
 * not enough to crowd out the assessment itself.
 */
const MAX_HISTORY_TURNS = 8;

/** A description rewrite plus reasoning tokens does not fit in the old 1000. */
const CHAT_MAX_TOKENS = 4000;

export type AssessmentContext = {
  title: string;
  description: string;
  timeLimit: number;
  behavioralChecks?: string[];
  evaluationCriteria?: string[];
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  message: string;
  assessmentContext: AssessmentContext;
  allowedSections?: string[]; // Which sections can be modified
  history?: ChatTurn[]; // Prior turns, oldest first
};

export type ChatUpdates = {
  description?: string;
  title?: string;
  timeLimit?: number;
  behavioralChecks?: string[];
  evaluationCriteria?: string[];
};

export type ChatResponse = {
  updates: ChatUpdates;
  changedSections: string[];
  changesSummary: string[];
  responseMessage: string; // Friendly message to show user
  model?: string; // Model name used for this response
  provider?: string; // Provider used for this response
};

/**
 * A failure the employer can act on, as opposed to an unexpected crash. The
 * controller turns these into a 502 with the message intact; everything else
 * falls through to the generic 500 handler.
 */
export class AssessmentChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentChatError";
  }
}

/** Loose model output ("Description", "project description") → our exact ids. */
const SECTION_NAME_MAP: Record<string, ChatEditableSection> = {
  description: "projectDescription",
  projectdescription: "projectDescription",
  "project description": "projectDescription",
  brief: "projectDescription",
  title: "title",
  name: "title",
  timelimit: "timeLimit",
  "time limit": "timeLimit",
  duration: "timeLimit",
  behavioralchecks: "behavioralChecks",
  "behavioral checks": "behavioralChecks",
  "product checks": "behavioralChecks",
  checks: "behavioralChecks",
  evaluationcriteria: "evaluationCriteria",
  "evaluation criteria": "evaluationCriteria",
  criteria: "evaluationCriteria",
  rubric: "evaluationCriteria",
};

function normalizeSectionName(raw: string): string {
  const key = String(raw ?? "").trim().toLowerCase();
  return SECTION_NAME_MAP[key] ?? String(raw ?? "").trim();
}

/** Keep only non-empty strings; used for both replacement list fields. */
function cleanStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return cleaned;
}

function buildSectionRestriction(allowedSections: string[]): string {
  if (allowedSections.length === 0) {
    return "You may update any section as needed.";
  }
  const labels = allowedSections.map(
    (s) => SECTION_LABELS[s as ChatEditableSection] ?? s
  );
  return `IMPORTANT: You may ONLY modify these sections: ${labels.join(
    ", "
  )} (ids: ${allowedSections.join(
    ", "
  )}). Leave every other section exactly as it is. If the user's request needs a section outside this list, explain that in "responseMessage" and return no updates.`;
}

/**
 * Drop updates for sections the user scoped out. The prompt asks the model to
 * respect the restriction, but a scoping rule the employer set explicitly is not
 * something to leave to the model's discretion.
 */
function enforceAllowedSections(
  updates: ChatUpdates,
  allowedSections: string[]
): { updates: ChatUpdates; dropped: string[] } {
  if (allowedSections.length === 0) return { updates, dropped: [] };
  const allowed = new Set(allowedSections);
  const dropped: string[] = [];
  const next: ChatUpdates = {};

  const keep = (
    section: ChatEditableSection,
    apply: (target: ChatUpdates) => void,
    present: boolean
  ) => {
    if (!present) return;
    if (allowed.has(section)) apply(next);
    else dropped.push(section);
  };

  keep(
    "projectDescription",
    (t) => (t.description = updates.description),
    updates.description !== undefined
  );
  keep("title", (t) => (t.title = updates.title), updates.title !== undefined);
  keep(
    "timeLimit",
    (t) => (t.timeLimit = updates.timeLimit),
    updates.timeLimit !== undefined
  );
  keep(
    "behavioralChecks",
    (t) => (t.behavioralChecks = updates.behavioralChecks),
    updates.behavioralChecks !== undefined
  );
  keep(
    "evaluationCriteria",
    (t) => (t.evaluationCriteria = updates.evaluationCriteria),
    updates.evaluationCriteria !== undefined
  );

  return { updates: next, dropped };
}

/**
 * Normalize a raw model response into a ChatResponse. Exported for tests — this
 * is where every shape the model can plausibly return gets flattened, so it is
 * the part worth pinning down without an API call.
 */
export function normalizeChatResult(
  raw: unknown,
  allowedSections: string[] = []
): ChatResponse {
  if (!raw || typeof raw !== "object") {
    throw new AssessmentChatError(
      "The assistant returned an unreadable response. Try rephrasing your request."
    );
  }

  const parsed = raw as Record<string, unknown>;
  const rawUpdates =
    parsed.updates && typeof parsed.updates === "object"
      ? (parsed.updates as Record<string, unknown>)
      : {};

  const updates: ChatUpdates = {};
  if (typeof rawUpdates.description === "string" && rawUpdates.description.trim()) {
    updates.description = rawUpdates.description.trim();
  }
  if (typeof rawUpdates.title === "string" && rawUpdates.title.trim()) {
    updates.title = rawUpdates.title.trim();
  }
  const timeLimit = Number(rawUpdates.timeLimit);
  if (Number.isFinite(timeLimit) && timeLimit > 0) {
    updates.timeLimit = Math.round(timeLimit);
  }
  // Empty replacement lists are ignored on purpose. These lists drive grading,
  // the chat has no undo, and a model that emits `"behavioralChecks": []` by
  // accident is more likely than an employer clearing the list by conversation —
  // so an accidental wipe is the expensive failure. Clearing is a UI action.
  const checks = cleanStringList(rawUpdates.behavioralChecks);
  if (checks && checks.length > 0) updates.behavioralChecks = checks;
  const criteria = cleanStringList(rawUpdates.evaluationCriteria);
  if (criteria && criteria.length > 0) updates.evaluationCriteria = criteria;

  const enforced = enforceAllowedSections(updates, allowedSections);

  // Derive changedSections from what actually survived rather than trusting the
  // model's own list — the two used to drift, and the editor highlights off it.
  const changedSections: string[] = [];
  if (enforced.updates.description !== undefined)
    changedSections.push("projectDescription");
  if (enforced.updates.title !== undefined) changedSections.push("title");
  if (enforced.updates.timeLimit !== undefined) changedSections.push("timeLimit");
  if (enforced.updates.behavioralChecks !== undefined)
    changedSections.push("behavioralChecks");
  if (enforced.updates.evaluationCriteria !== undefined)
    changedSections.push("evaluationCriteria");

  const rawSummary = Array.isArray(parsed.changesSummary)
    ? parsed.changesSummary
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  let responseMessage =
    typeof parsed.responseMessage === "string"
      ? parsed.responseMessage.trim()
      : "";

  if (!responseMessage) {
    if (rawSummary.length > 0) {
      responseMessage = `I've updated your assessment. ${rawSummary.join(" ")}`;
    } else if (changedSections.length > 0) {
      responseMessage = `I've updated the ${changedSections
        .map((s) => SECTION_LABELS[s as ChatEditableSection] ?? s)
        .join(", ")} section${changedSections.length > 1 ? "s" : ""}.`;
    } else {
      responseMessage = "I didn't change anything for that request.";
    }
  }

  if (enforced.dropped.length > 0) {
    const labels = enforced.dropped.map(
      (s) => SECTION_LABELS[s as ChatEditableSection] ?? s
    );
    responseMessage += ` (I left ${labels.join(
      " and "
    )} alone — editing is currently scoped to the sections you pinned.)`;
  }

  // Keep the model's own bullets when it changed something; when nothing landed,
  // a leftover summary would describe edits that were never applied.
  const changesSummary = changedSections.length > 0 ? rawSummary : [];

  return {
    updates: enforced.updates,
    changedSections,
    changesSummary,
    responseMessage,
  };
}

/**
 * Process chat message and generate assessment updates
 */
export async function processAssessmentChat(
  request: ChatRequest
): Promise<ChatResponse> {
  const {
    message,
    assessmentContext,
    allowedSections = [],
    history = [],
  } = request;

  // Ignore section names we have no contract for rather than passing them to the
  // model as a restriction it cannot act on.
  const scopedSections = allowedSections.filter((s): s is ChatEditableSection =>
    (CHAT_EDITABLE_SECTIONS as readonly string[]).includes(s)
  );

  const behavioralChecksSection = assessmentContext.behavioralChecks?.length
    ? `- Product Checks (behavioralChecks):\n${assessmentContext.behavioralChecks
        .map((c) => `  ${c}`)
        .join("\n")}`
    : "- Product Checks (behavioralChecks): none yet";

  const evaluationCriteriaSection = assessmentContext.evaluationCriteria?.length
    ? `- Evaluation Criteria (evaluationCriteria):\n${assessmentContext.evaluationCriteria
        .map((c) => `  ${c}`)
        .join("\n")}`
    : "- Evaluation Criteria (evaluationCriteria): none yet";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: PROMPT_ASSESSMENT_CHAT.systemTemplate(
        assessmentContext.title,
        assessmentContext.description,
        assessmentContext.timeLimit,
        behavioralChecksSection,
        evaluationCriteriaSection,
        buildSectionRestriction(scopedSections)
      ),
    },
    // Prior turns so follow-ups ("shorter than that") have a referent. The
    // assessment block above is always current, so replayed turns are context,
    // never the source of truth for what the assessment says now.
    ...history
      .slice(-MAX_HISTORY_TURNS)
      .filter((t) => t && typeof t.content === "string" && t.content.trim())
      .map<ChatMessage>((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: t.content.trim().slice(0, 4000),
      })),
    {
      role: "user",
      content: PROMPT_ASSESSMENT_CHAT.userTemplate(message),
    },
  ];

  const response = await createChatCompletion("assessment_chat", messages, {
    temperature: 0.7,
    maxTokens: CHAT_MAX_TOKENS,
    responseFormat: { type: "json_object" },
    provider: PROMPT_ASSESSMENT_CHAT.provider,
    model: PROMPT_ASSESSMENT_CHAT.model,
  });

  const content = response.content.trim();
  if (!content) {
    // Reasoning models spend the completion budget before emitting anything, so
    // an empty body is a budget symptom, not a transport error. Say so.
    throw new AssessmentChatError(
      "The assistant ran out of room before it could answer. Try a narrower request, or pin the section you want changed."
    );
  }

  console.log(
    "🤖 [assessmentChat] Model:",
    response.model,
    "Provider:",
    response.provider,
    "Chars:",
    content.length
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Almost always a mid-object cutoff. The old code surfaced this as
    // "Unknown Error. Try Again", which sent employers looking in the wrong place.
    console.error(
      "❌ [assessmentChat] Unparseable response (first 500 chars):",
      content.slice(0, 500)
    );
    throw new AssessmentChatError(
      "The assistant's reply was cut off before it finished. Try a smaller change, or ask again."
    );
  }

  const result = normalizeChatResult(parsed, scopedSections);
  result.model = response.model;
  result.provider = response.provider;

  console.log("✅ [assessmentChat] Applied:", {
    changedSections: result.changedSections,
    scopedTo: scopedSections,
  });

  return result;
}
