/**
 * Repository Indexing Service
 *
 * Indexes GitHub repositories into Pinecone using line-based chunking.
 * Creates embeddings for code chunks and stores them as vectors.
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, extname } from "path";
import SubmissionModel from "../models/submission.js";
import RepoIndexModel from "../models/repoIndex.js";
import {
  downloadAndExtractRepoSnapshot,
  cleanupRepoSnapshot,
} from "../util/repoSnapshot.js";
import { generateEmbeddings } from "../util/embeddings.js";
import { upsertVectors } from "../util/pinecone.js";
import { generateInterviewQuestionsFromRetrieval } from "./interviewGeneration.js";

/**
 * Chunking configuration constants
 */
const CHUNK_LINES = 200; // Lines per chunk
const CHUNK_OVERLAP = 40; // Lines of overlap between chunks
const MAX_CHUNK_CHARS = 10000; // Maximum characters per chunk (will split if exceeded)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file (increased for complete indexing)
// Removed MAX_CHUNKS_PER_REPO limit to ensure complete indexing

/**
 * File extensions to include (same as interviewGeneration)
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
 * Directories to ignore (same as interviewGeneration)
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
 * Infer language from file extension
 */
function inferLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".ipynb": "jupyter", // Jupyter notebooks
    ".java": "java",
    ".cpp": "cpp",
    ".c": "c",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".clj": "clojure",
    ".sh": "shell",
    ".sql": "sql",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".xml": "xml",
    ".md": "markdown",
  };
  return languageMap[ext] || "unknown";
}

/**
 * Split a chunk that exceeds character limit into multiple chunks
 */
function splitLargeChunk(
  lines: string[],
  startLine: number,
  maxChars: number = MAX_CHUNK_CHARS
): Array<{ start: number; end: number; lines: string[] }> {
  const subChunks: Array<{ start: number; end: number; lines: string[] }> = [];
  let currentStart = startLine;
  let currentLines: string[] = [];
  let currentSize = 0;
  const OVERLAP_LINES = 5; // Number of lines to overlap between split chunks

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = line.length + 1; // +1 for newline character

    // If adding this line would exceed the limit, save current chunk and start new one
    if (currentSize > 0 && currentSize + lineSize > maxChars) {
      // Save current chunk (without the current line)
      const chunkEnd = currentStart + currentLines.length - 1;
      subChunks.push({
        start: currentStart,
        end: chunkEnd,
        lines: [...currentLines],
      });

      // Start new chunk with overlap from previous chunk
      const overlapLines = Math.min(OVERLAP_LINES, currentLines.length);
      currentLines = currentLines.slice(-overlapLines);
      currentSize =
        currentLines.join("\n").length + (currentLines.length > 0 ? 1 : 0);
      // New chunk starts where previous chunk ended minus overlap (so they overlap)
      currentStart = chunkEnd - overlapLines + 1;
    }

    currentLines.push(line);
    currentSize += lineSize;
  }

  // Add the last chunk if it has content
  if (currentLines.length > 0) {
    subChunks.push({
      start: currentStart,
      end: currentStart + currentLines.length - 1,
      lines: currentLines,
    });
  }

  return subChunks;
}

/**
 * Chunk lines using sliding window with overlap
 */
function chunkLines(
  lines: string[],
  chunkSize: number = CHUNK_LINES,
  overlap: number = CHUNK_OVERLAP
): Array<{ start: number; end: number; lines: string[] }> {
  const chunks: Array<{ start: number; end: number; lines: string[] }> = [];

  for (let i = 0; i < lines.length; i += chunkSize - overlap) {
    const end = Math.min(i + chunkSize, lines.length);
    const chunkLines = lines.slice(i, end);

    // Skip empty or whitespace-only chunks
    const chunkText = chunkLines.join("\n");
    if (!chunkText.trim()) {
      continue;
    }

    chunks.push({
      start: i + 1, // 1-indexed line numbers
      end: end,
      lines: chunkLines,
    });
  }

  return chunks;
}

/**
 * Recursively traverse repository files
 * Returns files that were successfully read and files that were skipped with reasons
 */
async function traverseFiles(
  currentPath: string,
  relativePath: string = "",
  maxFileSize: number = MAX_FILE_SIZE
): Promise<{
  files: Array<{ path: string; content: string }>;
  skipped: Array<{ path: string; reason: string }>;
}> {
  const files: Array<{ path: string; content: string }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  async function traverse(dirPath: string, relPath: string) {
    try {
      const entries = await readdir(dirPath);

      for (const entry of entries) {
        // Skip ignored directories
        if (IGNORE_DIRS.has(entry)) {
          continue;
        }

        const fullPath = join(dirPath, entry);
        const relativeFilePath = relPath ? `${relPath}/${entry}` : entry;

        try {
          const stats = await stat(fullPath);

          if (stats.isDirectory()) {
            await traverse(fullPath, relativeFilePath);
          } else if (stats.isFile()) {
            const ext = extname(entry).toLowerCase();

            // Skip package.json and package-lock.json files
            if (entry === "package.json" || entry === "package-lock.json") {
              continue;
            }

            // Skip files with unsupported extensions
            if (!CODE_EXTENSIONS.has(ext)) {
              continue;
            }

            // Check file size
            if (stats.size > maxFileSize) {
              skipped.push({
                path: relativeFilePath,
                reason: `File too large (${(stats.size / 1024 / 1024).toFixed(
                  2
                )}MB > ${(maxFileSize / 1024 / 1024).toFixed(2)}MB)`,
              });
              continue;
            }

            try {
              const content = await readFile(fullPath, "utf-8");
              files.push({
                path: relativeFilePath,
                content,
              });
            } catch (error) {
              // Gracefully skip files that fail to decode
              skipped.push({
                path: relativeFilePath,
                reason: `Failed to read: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              });
            }
          }
        } catch (error) {
          skipped.push({
            path: relativeFilePath,
            reason: `Error accessing file: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }
  }

  await traverse(currentPath, relativePath);
  return { files, skipped };
}

/**
 * Index a submission's repository into Pinecone
 */
export async function indexSubmissionRepo(submissionId: string): Promise<{
  status: string;
  chunkCount?: number;
  fileCount?: number;
  error?: string;
}> {
  const indexName = process.env.PINECONE_INDEX_NAME;
  if (!indexName) {
    throw new Error("PINECONE_INDEX_NAME environment variable is not set");
  }

  // Step 1: Load Submission and validate
  const submission = await SubmissionModel.findById(submissionId);

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (
    !submission.githubRepo ||
    !submission.githubRepo.owner ||
    !submission.githubRepo.repo ||
    !submission.githubRepo.pinnedCommitSha
  ) {
    throw new Error(
      "GitHub repository information not found for this submission"
    );
  }

  const { owner, repo, pinnedCommitSha } = submission.githubRepo;

  // Step 2: Check if RepoIndex already exists
  let repoIndex = await RepoIndexModel.findOne({
    submissionId: submission._id,
    pinnedCommitSha,
  });

  if (repoIndex && repoIndex.status === "ready") {
    return {
      status: "ready",
      chunkCount: repoIndex.stats.chunkCount,
      fileCount: repoIndex.stats.fileCount,
    };
  }

  if (repoIndex && repoIndex.status === "indexing") {
    return {
      status: "indexing",
      chunkCount: repoIndex.stats.chunkCount,
      fileCount: repoIndex.stats.fileCount,
    };
  }

  // Step 3: Create or update RepoIndex and set status to indexing
  if (!repoIndex) {
    repoIndex = await RepoIndexModel.create({
      submissionId: submission._id,
      owner,
      repo,
      pinnedCommitSha,
      status: "indexing",
      pinecone: {
        indexName,
        namespace: submissionId.toString(),
      },
      stats: {
        fileCount: 0,
        chunkCount: 0,
        totalChars: 0,
        filesSkipped: 0,
      },
    });
  } else {
    repoIndex.status = "indexing";
    repoIndex.stats = {
      fileCount: 0,
      chunkCount: 0,
      totalChars: 0,
      filesSkipped: 0,
    };
    repoIndex.error = {
      message: null,
      stack: null,
      at: null,
    };
    await repoIndex.save();
  }

  let snapshot: Awaited<
    ReturnType<typeof downloadAndExtractRepoSnapshot>
  > | null = null;

  try {
    // Step 4: Download and extract repository
    console.log(
      `📥 [repoIndexing] Downloading repo: ${owner}/${repo}@${pinnedCommitSha.substring(
        0,
        7
      )}`
    );
    snapshot = await downloadAndExtractRepoSnapshot({
      owner,
      repo,
      pinnedCommitSha,
      submissionId: submission._id.toString(),
    });
    console.log(
      `✅ [repoIndexing] Repository extracted to: ${snapshot.repoRootPath}`
    );

    // Step 5: Traverse files
    console.log(`📖 [repoIndexing] Traversing files...`);
    const { files, skipped: skippedFiles } = await traverseFiles(
      snapshot.repoRootPath
    );
    console.log(`📚 [repoIndexing] Found ${files.length} files to process`);
    if (skippedFiles.length > 0) {
      console.log(`⚠️ [repoIndexing] Skipped ${skippedFiles.length} files:`);
      skippedFiles.slice(0, 10).forEach(({ path, reason }) => {
        console.log(`   - ${path}: ${reason}`);
      });
      if (skippedFiles.length > 10) {
        console.log(`   ... and ${skippedFiles.length - 10} more`);
      }
    }

    // Step 6: Process files and create chunks (NO LIMITS - process all files)
    const chunks: Array<{
      filePath: string;
      startLine: number;
      endLine: number;
      content: string;
      language: string;
    }> = [];

    let filesProcessed = 0;
    let filesFailed = 0;

    for (const file of files) {
      try {
        // Split into lines
        const lines = file.content.split("\n");

        // Create chunks with sliding window
        const lineChunks = chunkLines(lines, CHUNK_LINES, CHUNK_OVERLAP);

        for (const chunk of lineChunks) {
          // Join chunk lines
          const chunkText = chunk.lines.join("\n");

          // Skip empty or whitespace-only chunks
          if (!chunkText.trim()) {
            continue;
          }

          // If chunk exceeds character limit, split it into multiple chunks
          if (chunkText.length > MAX_CHUNK_CHARS) {
            const splitChunks = splitLargeChunk(
              chunk.lines,
              chunk.start,
              MAX_CHUNK_CHARS
            );

            for (const splitChunk of splitChunks) {
              const splitChunkText = splitChunk.lines.join("\n");
              if (!splitChunkText.trim()) {
                continue;
              }

              chunks.push({
                filePath: file.path,
                startLine: splitChunk.start,
                endLine: splitChunk.end,
                content: splitChunkText,
                language: inferLanguage(file.path),
              });
            }
          } else {
            chunks.push({
              filePath: file.path,
              startLine: chunk.start,
              endLine: chunk.end,
              content: chunkText,
              language: inferLanguage(file.path),
            });
          }
        }

        filesProcessed++;
      } catch (error) {
        console.warn(`Failed to process file ${file.path}:`, error);
        filesFailed++;
      }
    }

    const totalFilesSkipped = skippedFiles.length + filesFailed;

    console.log(
      `✅ [repoIndexing] Created ${chunks.length} chunks from ${filesProcessed} files (${totalFilesSkipped} files skipped)`
    );

    // Step 7: Generate embeddings in batches
    const BATCH_SIZE = 100; // OpenAI allows up to 2048 inputs per batch
    const vectors: Array<{
      id: string;
      values: number[];
      metadata: Record<string, any>;
    }> = [];

    console.log(`🤖 [repoIndexing] Generating embeddings in batches...`);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      // Create embedding text: file path, line range, and content
      const embeddingTexts = batch.map(
        (chunk) =>
          `File: ${chunk.filePath}\nLines: ${chunk.startLine}-${chunk.endLine}\n\n${chunk.content}`
      );

      // Generate embeddings
      const embeddings = await generateEmbeddings(embeddingTexts);

      // Create vectors
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const vectorId =
          `${submissionId}_${chunk.filePath}_${chunk.startLine}_${chunk.endLine}`.replace(
            /[^a-zA-Z0-9_-]/g,
            "_"
          );

        vectors.push({
          id: vectorId,
          values: embeddings[j],
          metadata: {
            submissionId: submissionId,
            owner,
            repo,
            pinnedCommitSha,
            filePath: chunk.filePath,
            language: chunk.language,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.content.substring(0, 1000), // Truncate for metadata
          },
        });
      }

      console.log(
        `✅ [repoIndexing] Processed batch ${
          Math.floor(i / BATCH_SIZE) + 1
        }/${Math.ceil(chunks.length / BATCH_SIZE)}`
      );
    }

    // Step 8: Upsert vectors to Pinecone
    console.log(
      `📤 [repoIndexing] Upserting ${vectors.length} vectors to Pinecone...`
    );

    // Upsert in batches (Pinecone recommends batches of 100)
    const PINECONE_BATCH_SIZE = 100;
    for (let i = 0; i < vectors.length; i += PINECONE_BATCH_SIZE) {
      const batch = vectors.slice(i, i + PINECONE_BATCH_SIZE);
      await upsertVectors(indexName, submissionId.toString(), batch);
    }

    // Step 9: Update RepoIndex with success
    const totalChars = chunks.reduce(
      (sum, chunk) => sum + chunk.content.length,
      0
    );

    repoIndex.status = "ready";
    repoIndex.stats = {
      fileCount: filesProcessed,
      chunkCount: chunks.length,
      totalChars,
      filesSkipped: totalFilesSkipped,
    };
    repoIndex.error = {
      message: null,
      stack: null,
      at: null,
    };
    await repoIndex.save();

    console.log(
      `✅ [repoIndexing] Indexing completed: ${chunks.length} chunks from ${filesProcessed} files (${totalFilesSkipped} skipped)`
    );

    // Automatically generate interview questions after indexing completes
    // This runs in the background and doesn't block the indexing response
    generateInterviewQuestionsAfterIndexing(submissionId).catch((error) => {
      console.error(
        `[repoIndexing] Failed to auto-generate interview questions for submission ${submissionId}:`,
        error
      );
    });

    return {
      status: "ready",
      chunkCount: chunks.length,
      fileCount: filesProcessed,
    };
  } catch (error) {
    // Step 10: Update RepoIndex with error
    console.error(`❌ [repoIndexing] Indexing failed:`, error);

    repoIndex.status = "failed";
    repoIndex.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack || null : null,
      at: new Date(),
    };
    await repoIndex.save();

    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Step 11: Always cleanup temp files
    if (snapshot) {
      try {
        await cleanupRepoSnapshot({
          zipPath: snapshot.zipPath,
          extractDir: snapshot.extractDir,
        });
        console.log("✅ [repoIndexing] Cleaned up temporary files");
      } catch (cleanupError) {
        console.warn("Failed to cleanup temp files:", cleanupError);
      }
    }
  }
}

/**
 * Automatically generate interview questions after repository indexing completes
 * This is called asynchronously and doesn't block the indexing response
 */
async function generateInterviewQuestionsAfterIndexing(
  submissionId: string
): Promise<void> {
  try {
    console.log(
      `🔄 [repoIndexing] Auto-generating interview questions for submission ${submissionId}...`
    );

    // Load submission with assessment
    const submission = await SubmissionModel.findById(submissionId).populate(
      "assessmentId"
    );

    if (!submission) {
      console.warn(
        `[repoIndexing] Submission ${submissionId} not found, skipping interview generation`
      );
      return;
    }

    const assessment = submission.assessmentId as any;

    // Verify submission is submitted
    if (submission.status !== "submitted" && submission.status !== "expired") {
      console.log(
        `[repoIndexing] Submission ${submissionId} not submitted yet (status: ${submission.status}), skipping interview generation`
      );
      return;
    }

    // Verify GitHub repo info exists
    if (
      !submission.githubRepo ||
      !submission.githubRepo.owner ||
      !submission.githubRepo.repo ||
      !submission.githubRepo.pinnedCommitSha
    ) {
      console.warn(
        `[repoIndexing] GitHub repository information not found for submission ${submissionId}, skipping interview generation`
      );
      return;
    }

    // Validate assessment description exists
    if (!assessment.description || !assessment.description.trim()) {
      console.warn(
        `[repoIndexing] Assessment description not found for submission ${submissionId}, skipping interview generation`
      );
      return;
    }

    // Check if interview questions already exist
    if (
      submission.interviewQuestions &&
      Array.isArray(submission.interviewQuestions) &&
      submission.interviewQuestions.length > 0
    ) {
      console.log(
        `[repoIndexing] Interview questions already exist for submission ${submissionId}, skipping generation`
      );
      return;
    }

    // Check if smart interviewer is enabled
    const isSmartInterviewerEnabled = (assessment as any).isSmartInterviewerEnabled !== false; // Default to true if not set
    
    if (!isSmartInterviewerEnabled) {
      console.log(
        `[repoIndexing] Smart interviewer is disabled for assessment ${assessment._id}, skipping interview question generation`
      );
      return;
    }

    // Generate interview questions using Pinecone retrieval
    const numQuestions = (assessment as any).numInterviewQuestions ?? 2;
    const customInstructions = (assessment as any)
      .interviewerCustomInstructions;
    const result = await generateInterviewQuestionsFromRetrieval(
      submission._id.toString(),
      assessment.description,
      numQuestions,
      customInstructions
    );

    const validatedQuestions = result.questions;
    const retrievedChunkCount = result.retrievedChunkCount;
    const chunkPaths = result.chunkPaths;

    console.log(
      `✅ [repoIndexing] Generated ${validatedQuestions.length} interview questions from ${retrievedChunkCount} code chunks`
    );

    if (!validatedQuestions || validatedQuestions.length === 0) {
      console.warn(
        `[repoIndexing] No questions generated for submission ${submissionId}`
      );
      return;
    }

    // Format questions with timestamps for storage
    const questionsWithTimestamps = validatedQuestions.map((q) => ({
      prompt: q.prompt,
      anchors: q.anchors,
      createdAt: new Date(),
    }));

    // Save questions to submission
    (submission as any).interviewQuestions = questionsWithTimestamps;
    // Mark the array as modified to ensure Mongoose saves it
    submission.markModified("interviewQuestions");
    await submission.save();

    console.log(
      `✅ [repoIndexing] Saved ${questionsWithTimestamps.length} interview questions to submission ${submissionId}`
    );
  } catch (error) {
    console.error(
      `❌ [repoIndexing] Error auto-generating interview questions for submission ${submissionId}:`,
      error
    );
    // Don't throw - this is a background operation
  }
}
