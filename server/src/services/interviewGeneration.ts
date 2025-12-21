import { readFile, readdir, stat } from "fs/promises";
import { join, extname } from "path";
import OpenAI from "openai";

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
 * Generates interview questions based on the candidate's code submission
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
