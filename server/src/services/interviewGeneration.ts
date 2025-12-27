import { readFile, readdir, stat } from "fs/promises";
import { join, extname } from "path";
import OpenAI from "openai";
import { searchCodeChunks } from "./repoRetrieval.js";

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

// Initialize OpenAI client
let openai: OpenAI | null = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log("✅ OpenAI client initialized for interview generation");
} else {
  console.warn(
    "⚠️  OPENAI_API_KEY not set. Interview generation will not work."
  );
}

/**
 * File extensions to include when reading code
 */
const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".ipynb", // Jupyter notebooks
  ".java",
  ".cpp",
  ".c",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".scala",
  ".clj",
  ".sh",
  ".sql",
  ".html",
  ".css",
  ".scss",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".md",
]);

/**
 * Directories to ignore
 */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  ".vscode",
  ".idea",
  "__pycache__",
  ".pytest_cache",
  "venv",
  "env",
  ".env",
]);

/**
 * Maximum file size to read (1MB)
 */
const MAX_FILE_SIZE = 1024 * 1024;

/**
 * Maximum total code size to send to LLM (100KB)
 */
const MAX_TOTAL_CODE_SIZE = 100 * 1024;

/**
 * Recursively reads code files from a directory
 */
async function readCodeFiles(
  dirPath: string,
  maxSize: number = MAX_TOTAL_CODE_SIZE
): Promise<Map<string, string>> {
  const codeFiles = new Map<string, string>();
  let totalSize = 0;

  async function traverse(currentPath: string, relativePath: string = "") {
    try {
      const entries = await readdir(currentPath);

      for (const entry of entries) {
        // Skip ignored directories
        if (IGNORE_DIRS.has(entry)) {
          continue;
        }

        const fullPath = join(currentPath, entry);
        const relativeFilePath = relativePath
          ? `${relativePath}/${entry}`
          : entry;

        try {
          const stats = await stat(fullPath);

          if (stats.isDirectory()) {
            await traverse(fullPath, relativeFilePath);
          } else if (stats.isFile()) {
            const ext = extname(entry).toLowerCase();
            if (CODE_EXTENSIONS.has(ext) && stats.size <= MAX_FILE_SIZE) {
              // Check if we've exceeded total size limit
              if (totalSize + stats.size > maxSize) {
                console.warn(
                  `Skipping ${relativeFilePath}: would exceed total size limit`
                );
                continue;
              }

              try {
                const content = await readFile(fullPath, "utf-8");
                codeFiles.set(relativeFilePath, content);
                totalSize += stats.size;
              } catch (error) {
                console.warn(`Failed to read ${relativeFilePath}:`, error);
              }
            }
          }
        } catch (error) {
          console.warn(`Error accessing ${relativeFilePath}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${currentPath}:`, error);
    }
  }

  await traverse(dirPath);
  return codeFiles;
}

/**
 * Formats code files into a readable string for LLM
 */
function formatCodeForLLM(codeFiles: Map<string, string>): string {
  let formatted = "";
  for (const [filePath, content] of codeFiles.entries()) {
    formatted += `\n\n=== File: ${filePath} ===\n${content}`;
  }
  return formatted;
}

/**
 * Format scoring map into readable rubric text
 */
function formatRubricText(
  scoring: Map<string, number> | Record<string, number>
): string {
  if (
    !scoring ||
    (scoring instanceof Map && scoring.size === 0) ||
    (typeof scoring === "object" && Object.keys(scoring).length === 0)
  ) {
    return "No specific rubric provided.";
  }

  const entries =
    scoring instanceof Map
      ? Array.from(scoring.entries())
      : Object.entries(scoring);

  if (entries.length === 0) {
    return "No specific rubric provided.";
  }

  return entries
    .map(([criteria, weight]) => {
      const weightStr =
        typeof weight === "number" ? `${weight}%` : String(weight);
      return `- ${criteria}: ${weightStr}`;
    })
    .join("\n");
}

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
  rubric?: Map<string, number> | Record<string, number>
): Promise<{
  questions: ValidatedQuestion[];
  retrievedChunkCount: number;
  chunkPaths: string[];
}> {
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

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

  // Format rubric text
  const rubricText = formatRubricText(rubric || new Map());

  // Format code chunks for LLM with clear anchor information
  const codeContext = formatChunksForLLM(retrievalResult.chunks);
  const chunkPaths = retrievalResult.chunks.map((chunk) => chunk.path);

  // Build list of available anchors for reference
  const availableAnchors = retrievalResult.chunks.map((chunk) => ({
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
  }));

  // Build prompt
  const systemPrompt = `You are a technical interviewer. Generate 5-8 interview questions based on the provided assessment description, rubric, and code snippets from the candidate's submission.

Requirements:
- Generate 5-8 thoughtful, specific questions
- Each question MUST be grounded in the provided code snippets
- Each question should include 1-3 anchors when possible, referencing the specific snippets
- Anchors must be chosen ONLY from the provided snippets' file paths and line ranges
- DO NOT invent file paths or line numbers - only use what is provided
- Questions should probe understanding, design decisions, trade-offs, and potential improvements
- Make questions specific to the candidate's code, not generic

Output strict JSON with a single key "questions" containing an array of objects. Each object must have:
- "prompt": string (the question text)
- "anchors": array of objects with "path", "startLine", "endLine" (1-3 anchors per question, matching the provided snippets)

Example format:
{
  "questions": [
    {
      "prompt": "In your authentication middleware, why did you choose to extract the token from the Authorization header this way?",
      "anchors": [
        {"path": "src/auth/middleware.js", "startLine": 45, "endLine": 67}
      ]
    },
    {
      "prompt": "How does your error handling in the user routes differ from the task routes?",
      "anchors": [
        {"path": "src/routes/users.js", "startLine": 12, "endLine": 34},
        {"path": "src/routes/tasks.js", "startLine": 8, "endLine": 30}
      ]
    }
  ]
}`;

  // Build list of available anchors in a clear format for LLM
  const availableAnchorsList = availableAnchors
    .map(
      (anchor, idx) =>
        `${idx + 1}. path: "${anchor.path}", startLine: ${
          anchor.startLine
        }, endLine: ${anchor.endLine}`
    )
    .join("\n");

  const userPrompt = `Assessment Description:
${trimmedDescription}

Rubric:
${rubricText}

Available Code Snippets:
${codeContext}

Available Anchors (copy these EXACTLY for your anchors - path, startLine, endLine must match exactly):
${availableAnchorsList}

Generate interview questions grounded in these code snippets. For each question, include 1-3 anchors from the "Available Anchors" list above. Copy the path, startLine, and endLine EXACTLY as shown.`;

  // Generate interview questions
  console.log(
    "🤖 [generateInterviewQuestionsFromRetrieval] Generating interview questions..."
  );
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    temperature: 0.3, // Lower temperature for consistency
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("No content in OpenAI response");
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

/**
 * Generates interview questions based on the candidate's code submission (legacy method - reads from disk)
 */
export async function generateInterviewQuestions(
  repoRootPath: string,
  assessmentDescription: string
): Promise<string[]> {
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  // Read code files from the repository
  console.log(`📖 Reading code files from ${repoRootPath}...`);
  const codeFiles = await readCodeFiles(repoRootPath);
  console.log(`📚 Read ${codeFiles.size} code files`);

  if (codeFiles.size === 0) {
    throw new Error("No code files found in repository");
  }

  // Format code for LLM
  const codeContent = formatCodeForLLM(codeFiles);

  // Generate interview questions
  console.log("🤖 Generating interview questions...");
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are an expert technical interviewer. Your task is to generate thoughtful, specific follow-up interview questions based on a candidate's code submission.

The candidate has completed a take-home assessment. Review their code and generate 5-8 interview questions that:
1. Probe their understanding of their own implementation
2. Ask about design decisions and trade-offs
3. Explore edge cases and potential improvements
4. Test their knowledge of the technologies and patterns used
5. Are specific to their code (not generic)

Return ONLY a JSON array of question strings, like:
["Question 1?", "Question 2?", "Question 3?"]

Do not include any other text or explanation.`,
      },
      {
        role: "user",
        content: `Assessment Description:
${assessmentDescription}

Candidate's Code Submission:
${codeContent.substring(0, 50000)}${
          codeContent.length > 50000 ? "\n\n[... truncated for length ...]" : ""
        }

Generate interview questions based on this code submission.`,
      },
    ],
    temperature: 0.7,
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("No content in OpenAI response");
  }

  try {
    const result = JSON.parse(content);

    // Handle both { questions: [...] } and [...] formats
    let questions: string[] = [];
    if (Array.isArray(result)) {
      questions = result;
    } else if (result.questions && Array.isArray(result.questions)) {
      questions = result.questions;
    } else {
      // Try to find any array in the response
      const values = Object.values(result);
      const arrayValue = values.find((v) => Array.isArray(v));
      if (arrayValue) {
        questions = arrayValue as string[];
      } else {
        throw new Error("Could not find questions array in response");
      }
    }

    if (questions.length === 0) {
      throw new Error("No questions generated");
    }

    console.log(`✅ Generated ${questions.length} interview questions`);
    return questions;
  } catch (error) {
    console.error("Failed to parse interview questions:", error);
    console.error("Raw response:", content);
    throw new Error("Failed to parse interview questions from AI response");
  }
}
