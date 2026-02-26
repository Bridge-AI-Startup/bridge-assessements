import { PROMPT_GENERATE_INTERVIEW_SUMMARY } from "../prompts/index.js";
import {
  createChatCompletion,
  initializeLangChainAI,
  type ChatMessage,
} from "./langchainAI.js";
import { generateAssessmentComponents as generateAssessmentComponentsFromChain } from "./assessmentGeneration.js";
import type { GenerateAssessmentOptions } from "../types/assessmentGeneration.js";

// Initialize LangChain AI on module load
initializeLangChainAI();

/**
 * Generate all assessment components via the two-step assessment generation chain
 * (extract requirements → generate assessment). Delegates to assessmentGeneration service.
 * Optional stack/level override the inferred values when provided.
 */
export async function generateAssessmentComponents(
  jobDescription: string,
  options?: GenerateAssessmentOptions
): Promise<{
  title: string;
  description: string;
  timeLimit: number;
  reviewFeedback?: string;
}> {
  return generateAssessmentComponentsFromChain(jobDescription, options);
}

/**
 * Generate interview summary from transcript
 */
export async function generateInterviewSummary(
  transcript: Array<{ role: "agent" | "candidate"; text: string }>
): Promise<string> {
  try {
    // Format transcript for LLM
    const transcriptText = transcript
      .map((turn) => {
        const speaker = turn.role === "agent" ? "Interviewer" : "Candidate";
        return `${speaker}: ${turn.text}`;
      })
      .join("\n\n");

    console.log("🤖 [AI] Generating interview summary...");

    const messages: ChatMessage[] = [
        {
          role: "system",
          content: PROMPT_GENERATE_INTERVIEW_SUMMARY.system,
        },
        {
          role: "user",
          content:
            PROMPT_GENERATE_INTERVIEW_SUMMARY.userTemplate(transcriptText),
        },
    ];

    const response = await createChatCompletion(
      "interview_summary",
      messages,
      {
      temperature: 0.5,
        maxTokens: 600, // Enough for 200-400 word summary
        // Use provider/model from prompt config if specified
        provider: PROMPT_GENERATE_INTERVIEW_SUMMARY.provider,
        model: PROMPT_GENERATE_INTERVIEW_SUMMARY.model,
      }
    );

    const summary = response.content.trim();
    if (!summary) {
      throw new Error("No content in AI response");
    }

    console.log("✅ [AI] Generated interview summary");
    return summary;
  } catch (error) {
    console.error("❌ [AI] Error generating interview summary:", error);
    // Fallback: return a simple summary
    const totalTurns = transcript.length;
    const candidateTurns = transcript.filter(
      (t) => t.role === "candidate"
    ).length;
    return `Interview completed with ${totalTurns} total turns. Candidate participated in ${candidateTurns} turns.`;
  }
}
