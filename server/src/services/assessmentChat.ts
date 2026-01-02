import { PROMPT_ASSESSMENT_CHAT } from "../prompts/index.js";
import {
  createChatCompletion,
  initializeLangChainAI,
  type ChatMessage,
} from "./langchainAI.js";

// Initialize LangChain AI on module load
initializeLangChainAI();

export type AssessmentContext = {
  title: string;
  description: string;
  timeLimit: number;
  // Frontend-only fields (not in DB but part of assessment UI)
  testCases?: Array<{ name: string; type: string; points: number }>;
};

export type ChatRequest = {
  message: string;
  assessmentContext: AssessmentContext;
  allowedSections?: string[]; // Which sections can be modified
};

export type ChatResponse = {
  updates: {
    description?: string;
    title?: string;
    timeLimit?: number;
    testCases?: Array<{ name: string; type: string; points: number }>;
  };
  changedSections: string[];
  changesSummary: string[];
  responseMessage: string; // Friendly message to show user
  model?: string; // Model name used for this response
  provider?: string; // Provider used for this response
};

/**
 * Process chat message and generate assessment updates
 */
export async function processAssessmentChat(
  request: ChatRequest
): Promise<ChatResponse> {
  const { message, assessmentContext, allowedSections = [] } = request;

  // Determine which sections can be modified
  const canModifyDescription =
    !allowedSections.length || allowedSections.includes("projectDescription");
  const canModifyTestCases =
    !allowedSections.length || allowedSections.includes("testCases");

  const sectionRestriction =
    allowedSections.length > 0
      ? `IMPORTANT: You may ONLY modify the following sections: ${allowedSections
          .map((s) => {
            if (s === "projectDescription") return "Project Description";
            if (s === "testCases") return "Test Cases";
            return s;
          })
          .join(", ")}. Do NOT change any other sections.`
      : "You may update any sections as needed.";

  const testCasesSection = assessmentContext.testCases
    ? `- Test Cases: ${JSON.stringify(assessmentContext.testCases)}`
    : "";

  try {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: PROMPT_ASSESSMENT_CHAT.systemTemplate(
          assessmentContext.title,
          assessmentContext.description,
          assessmentContext.timeLimit,
          testCasesSection,
          sectionRestriction
        ),
      },
      {
        role: "user",
        content: PROMPT_ASSESSMENT_CHAT.userTemplate(message),
      },
    ];

    const response = await createChatCompletion("assessment_chat", messages, {
      temperature: 0.7,
      maxTokens: 1000,
      responseFormat: { type: "json_object" },
      // Use provider/model from prompt config if specified
      provider: PROMPT_ASSESSMENT_CHAT.provider,
      model: PROMPT_ASSESSMENT_CHAT.model,
    });

    const content = response.content.trim();
    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("📥 [assessmentChat] Raw response:", content);
    console.log(
      "🤖 [assessmentChat] Model used:",
      response.model,
      "Provider:",
      response.provider
    );

    const result = JSON.parse(content) as ChatResponse;

    // Add model and provider info to the response
    result.model = response.model;
    result.provider = response.provider;

    // Validate response structure
    if (!result.updates || !result.changedSections || !result.changesSummary) {
      throw new Error("Invalid response format from AI provider");
    }

    // Normalize section names to match frontend expectations
    const sectionNameMap: Record<string, string> = {
      description: "projectDescription",
      Description: "projectDescription",
      "Project Description": "projectDescription",
      "project description": "projectDescription",
      "Test Cases": "testCases",
      "test cases": "testCases",
      TestCases: "testCases",
      Title: "title",
      title: "title",
      "Time Limit": "timeLimit",
      "time limit": "timeLimit",
      TimeLimit: "timeLimit",
    };

    // Normalize changed sections
    const normalizedSections = result.changedSections.map((section) => {
      return sectionNameMap[section] || section;
    });

    // Ensure projectDescription is included if description was updated
    if (
      result.updates.description &&
      !normalizedSections.includes("projectDescription")
    ) {
      normalizedSections.push("projectDescription");
    }

    result.changedSections = normalizedSections;

    // Ensure responseMessage exists - generate fallback if missing
    if (!result.responseMessage || result.responseMessage.trim() === "") {
      // Generate a friendly message based on what was changed
      const changes = result.changesSummary || [];
      if (changes.length > 0) {
        result.responseMessage = `I've updated your assessment. ${changes.join(
          " "
        )}`;
      } else if (normalizedSections.length > 0) {
        result.responseMessage = `I've updated the ${normalizedSections.join(
          ", "
        )} section${
          normalizedSections.length > 1 ? "s" : ""
        } of your assessment.`;
      } else {
        result.responseMessage =
          "I've processed your request and updated the assessment.";
      }
    }

    console.log("✅ [assessmentChat] Processed updates:", {
      changedSections: result.changedSections,
      hasDescription: !!result.updates.description,
      hasTitle: !!result.updates.title,
      hasTimeLimit: !!result.updates.timeLimit,
      hasResponseMessage: !!result.responseMessage,
    });

    return result;
  } catch (error) {
    console.error("❌ [assessmentChat] Error:", error);
    throw error;
  }
}
