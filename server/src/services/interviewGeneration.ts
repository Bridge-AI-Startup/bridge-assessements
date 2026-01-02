import { searchCodeChunks } from "./repoRetrieval.js";
import { PROMPT_GENERATE_INTERVIEW_QUESTIONS_RETRIEVAL } from "../prompts/index.js";
import {
  createChatCompletion,
  initializeLangChainAI,
  type ChatMessage,
} from "./langchainAI.js";

/**
 * Interface for anchor (validated)
 */
export interface Anchor {
  path: string;
  startLine: number;
  endLine: number;
}

/**
 * Interface for validated question
 */
export interface ValidatedQuestion {
  prompt: string;
  anchors: Anchor[];
}

// Initialize LangChain AI on module load
initializeLangChainAI();

/**
 * Format code chunks for LLM context with clear anchor information
 */
function formatChunksForLLM(
  chunks: Array<{
    path: string;
    startLine: number;
    endLine: number;
    content: string;
  }>
): string {
  return chunks
    .map((chunk, index) => {
      return `[Snippet ${index + 1}]
path: ${chunk.path}
startLine: ${chunk.startLine}
endLine: ${chunk.endLine}

${chunk.content}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Generates interview questions using Pinecone retrieval (new method)
 */
export async function generateInterviewQuestionsFromRetrieval(
  submissionId: string,
  assessmentDescription: string,
  numQuestions: number = 2,
  customInstructions?: string
): Promise<{
  questions: ValidatedQuestion[];
  retrievedChunkCount: number;
  chunkPaths: string[];
}> {
  // Validate description
  const trimmedDescription = assessmentDescription?.trim();
  if (!trimmedDescription) {
    throw new Error("Assessment description is required and cannot be empty");
  }

  // Retrieve code chunks from Pinecone
  console.log(
    `🔍 [generateInterviewQuestionsFromRetrieval] Retrieving code chunks for submission ${submissionId}...`
  );
  const retrievalResult = await searchCodeChunks(
    submissionId,
    trimmedDescription,
    {
      topK: 8,
      maxChunks: 8,
      maxTotalChars: 30000, // Context budget
      maxChunkChars: 4000,
    }
  );

  if (retrievalResult.chunks.length === 0) {
    throw new Error("Repo indexed but no relevant code chunks found");
  }

  console.log(
    `✅ [generateInterviewQuestionsFromRetrieval] Retrieved ${retrievalResult.chunks.length} code chunks`
  );

  // Format code chunks for LLM with clear anchor information
  const codeContext = formatChunksForLLM(retrievalResult.chunks);
  const chunkPaths = retrievalResult.chunks.map((chunk) => chunk.path);

  // Build list of available anchors for reference
  const availableAnchors = retrievalResult.chunks.map((chunk) => ({
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
  }));

  // Validate and clamp numQuestions (max 4)
  const validNumQuestions = Math.max(1, Math.min(4, Math.round(numQuestions)));

  // Build list of available anchors in a clear format for LLM
  const availableAnchorsList = availableAnchors
    .map(
      (anchor, idx) =>
        `${idx + 1}. path: "${anchor.path}", startLine: ${
          anchor.startLine
        }, endLine: ${anchor.endLine}`
    )
    .join("\n");

  // Build prompts from centralized prompts file
  const systemPrompt =
    PROMPT_GENERATE_INTERVIEW_QUESTIONS_RETRIEVAL.systemTemplate(
      validNumQuestions,
      customInstructions
    );
  const userPrompt = PROMPT_GENERATE_INTERVIEW_QUESTIONS_RETRIEVAL.userTemplate(
    trimmedDescription,
    codeContext,
    availableAnchorsList
  );

  // Generate interview questions
  console.log(
    "🤖 [generateInterviewQuestionsFromRetrieval] Generating interview questions..."
  );
  
  const messages: ChatMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
  ];

  const response = await createChatCompletion("interview_questions", messages, {
    temperature: 0.3, // Lower temperature for consistency
    maxTokens: 1500,
    responseFormat: { type: "json_object" },
    // Use provider/model from prompt config if specified
    provider: PROMPT_GENERATE_INTERVIEW_QUESTIONS_RETRIEVAL.provider,
    model: PROMPT_GENERATE_INTERVIEW_QUESTIONS_RETRIEVAL.model,
  });

  const content = response.content.trim();
  if (!content) {
    throw new Error("No content in AI response");
  }

  try {
    const result = JSON.parse(content);

    // Extract questions array
    if (!result.questions || !Array.isArray(result.questions)) {
      throw new Error("Could not find questions array in response");
    }

    // Debug: Log what LLM returned
    console.log(
      `🔍 [generateInterviewQuestionsFromRetrieval] LLM returned ${result.questions.length} questions`
    );
    result.questions.forEach((q: any, idx: number) => {
      console.log(
        `   Question ${idx + 1}: prompt="${q.prompt?.substring(
          0,
          50
        )}...", anchors=${JSON.stringify(q.anchors)}`
      );
    });

    // Log available chunks for comparison
    console.log(
      `🔍 [generateInterviewQuestionsFromRetrieval] Available chunks for grounding:`
    );
    retrievalResult.chunks.forEach((chunk, idx) => {
      console.log(
        `   Chunk ${idx + 1}: path="${chunk.path}", lines ${chunk.startLine}-${
          chunk.endLine
        }`
      );
    });

    // Validate and normalize questions with anchors
    const validatedQuestions = validateAndGroundQuestions(
      result.questions,
      retrievalResult.chunks
    );

    // Debug: Log validation results
    console.log(
      `🔍 [generateInterviewQuestionsFromRetrieval] After validation: ${validatedQuestions.length} questions`
    );
    validatedQuestions.forEach((q, idx) => {
      console.log(
        `   Question ${idx + 1}: ${q.anchors.length} anchors validated`
      );
      if (q.anchors.length > 0) {
        q.anchors.forEach((a, aIdx) => {
          console.log(
            `      Anchor ${aIdx + 1}: ${a.path}:${a.startLine}-${a.endLine}`
          );
        });
      }
    });

    if (validatedQuestions.length === 0) {
      throw new Error("No valid questions generated after validation");
    }

    console.log(
      `✅ [generateInterviewQuestionsFromRetrieval] Generated ${validatedQuestions.length} validated interview questions`
    );

    return {
      questions: validatedQuestions,
      retrievedChunkCount: retrievalResult.chunks.length,
      chunkPaths,
    };
  } catch (error) {
    console.error("Failed to parse interview questions:", error);
    console.error("Raw response:", content);
    throw new Error("Failed to parse interview questions from AI response");
  }
}

/**
 * Validate and ground anchors against retrieved chunks
 */
function validateAndGroundQuestions(
  questions: any[],
  retrievedChunks: Array<{
    path: string;
    startLine: number;
    endLine: number;
    content: string;
  }>
): ValidatedQuestion[] {
  // Create a Set of valid anchor keys for fast lookup (exact match on path, startLine, endLine)
  const validAnchorKeys = new Set<string>();
  retrievedChunks.forEach((chunk) => {
    const key = `${chunk.path}:${chunk.startLine}:${chunk.endLine}`;
    validAnchorKeys.add(key);
  });

  const validated: ValidatedQuestion[] = [];

  for (const question of questions) {
    // Validate prompt
    if (!question || typeof question !== "object") {
      console.warn("Skipping invalid question (not an object):", question);
      continue;
    }

    const prompt = question.prompt;
    if (!prompt || typeof prompt !== "string") {
      console.warn("Skipping question with invalid prompt:", question);
      continue;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      console.warn("Skipping question with empty prompt:", question);
      continue;
    }

    // Validate and ground anchors
    let validAnchors: Anchor[] = [];

    if (question.anchors && Array.isArray(question.anchors)) {
      for (const anchor of question.anchors) {
        if (!anchor || typeof anchor !== "object") {
          continue;
        }

        // Validate anchor fields
        const path = anchor.path;
        const startLine = anchor.startLine;
        const endLine = anchor.endLine;

        if (!path || typeof path !== "string" || !path.trim()) {
          console.warn("Skipping anchor with invalid path:", anchor);
          continue;
        }

        if (
          typeof startLine !== "number" ||
          typeof endLine !== "number" ||
          !Number.isInteger(startLine) ||
          !Number.isInteger(endLine) ||
          startLine < 1 ||
          endLine < 1 ||
          endLine < startLine
        ) {
          console.warn("Skipping anchor with invalid line numbers:", anchor);
          continue;
        }

        // Ground anchor against retrieved chunks (exact match)
        const anchorKey = `${path.trim()}:${startLine}:${endLine}`;
        if (validAnchorKeys.has(anchorKey)) {
          validAnchors.push({
            path: path.trim(),
            startLine,
            endLine,
          });
          console.log(
            `✅ [validateAndGroundQuestions] Anchor matched: ${anchorKey}`
          );
        } else {
          // Debug: Show why anchor didn't match
          console.warn(
            `⚠️ [validateAndGroundQuestions] Anchor not found: ${anchorKey}`
          );
          console.warn(
            `   Available anchors: ${Array.from(validAnchorKeys)
              .slice(0, 5)
              .join(", ")}...`
          );
        }
      }
    }

    // Keep question even if it has no anchors
    validated.push({
      prompt: trimmedPrompt,
      anchors: validAnchors,
    });
  }

  return validated;
}
