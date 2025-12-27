import { RequestHandler } from "express";
import SubmissionModel from "../models/submission.js";
import RepoIndexModel from "../models/repoIndex.js";
import { searchCodeChunks, CodeChunk } from "../services/repoRetrieval.js";

/**
 * Request body for get-context endpoint
 */
export interface GetContextRequest {
  submissionId: string;
  currentQuestion: string;
  candidateAnswer: string;
}

/**
 * Response body for get-context endpoint
 */
export interface GetContextResponse {
  contextChunks: Array<{
    path: string;
    startLine: number;
    endLine: number;
    content: string;
    score: number;
  }>;
  stats: {
    chunksReturned: number;
    totalCharsReturned: number;
  };
}

/**
 * Calculate overlap ratio between two line ranges
 */
function calculateOverlapRatio(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): number {
  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);

  if (overlapEnd <= overlapStart) {
    return 0; // No overlap
  }

  const overlapSize = overlapEnd - overlapStart + 1;
  const range1Size = end1 - start1 + 1;
  const range2Size = end2 - start2 + 1;
  const unionSize = Math.max(end1, end2) - Math.min(start1, start2) + 1;

  // Return overlap ratio: overlap / union
  return overlapSize / unionSize;
}

/**
 * Check if two chunks overlap significantly (same path and overlapping line ranges)
 */
function chunksOverlap(chunk1: CodeChunk, chunk2: CodeChunk): boolean {
  // Must be same path
  if (chunk1.path !== chunk2.path) {
    return false;
  }

  // Calculate overlap ratio
  const overlapRatio = calculateOverlapRatio(
    chunk1.startLine,
    chunk1.endLine,
    chunk2.startLine,
    chunk2.endLine
  );

  // Consider overlapping if overlap ratio > 0.3 or any overlap exists
  return overlapRatio > 0.3;
}

/**
 * Deduplicate overlapping chunks, keeping highest score
 */
function deduplicateChunks(chunks: CodeChunk[]): CodeChunk[] {
  // Sort by score descending
  const sorted = [...chunks].sort((a, b) => b.score - a.score);
  const unique: CodeChunk[] = [];

  for (const chunk of sorted) {
    // Check if this chunk overlaps with any already selected chunk
    const hasOverlap = unique.some((existing) =>
      chunksOverlap(chunk, existing)
    );

    if (!hasOverlap) {
      unique.push(chunk);
    }
  }

  return unique;
}

/**
 * Agent tool endpoint: Get relevant code context for interview follow-up
 * POST /api/agent-tools/get-context
 *
 * This endpoint retrieves relevant code snippets from Pinecone based on the
 * current interview question and candidate's answer, with strict output budgets.
 */
export const getContext: RequestHandler = async (req, res, next) => {
  try {
    const { submissionId, currentQuestion, candidateAnswer } =
      req.body as GetContextRequest;

    // Validate required fields
    if (!submissionId || typeof submissionId !== "string") {
      return res.status(400).json({ error: "submissionId is required" });
    }

    if (!currentQuestion || typeof currentQuestion !== "string") {
      return res.status(400).json({ error: "currentQuestion is required" });
    }

    if (!candidateAnswer || typeof candidateAnswer !== "string") {
      return res.status(400).json({ error: "candidateAnswer is required" });
    }

    // Trim inputs
    const trimmedQuestion = currentQuestion.trim();
    const trimmedAnswer = candidateAnswer.trim();

    if (!trimmedQuestion || !trimmedAnswer) {
      return res.status(400).json({
        error: "currentQuestion and candidateAnswer cannot be empty",
      });
    }

    // Step 1: Verify submission exists
    const submission = await SubmissionModel.findById(submissionId);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Step 2: Check RepoIndex status is "ready"
    const repoIndex = await RepoIndexModel.findOne({
      submissionId: submission._id,
    }).sort({ createdAt: -1 }); // Get latest

    if (!repoIndex) {
      return res.status(409).json({
        error: "Repository not indexed yet",
      });
    }

    if (repoIndex.status !== "ready") {
      return res.status(409).json({
        error: `Repository indexing status: ${repoIndex.status}. Must be 'ready' to retrieve context.`,
      });
    }

    // Step 3: Build retrieval query combining question and answer
    const retrievalQuery = `Interview question: ${trimmedQuestion}\n\nCandidate answer: ${trimmedAnswer}\n\nTask: return the most relevant code snippets to verify the answer and ask a precise follow-up.`;

    // Step 4: Retrieve code chunks from Pinecone
    // Request topK=10, but we'll apply stricter budgets below
    const requestedTopK = 10;
    const retrievalResult = await searchCodeChunks(
      submissionId,
      retrievalQuery,
      {
        topK: requestedTopK,
        maxChunks: 10, // Allow more initially, we'll filter further
        maxTotalChars: 20000, // Allow more initially, we'll filter further
        maxChunkChars: 4000,
      }
    );

    // Step 5: Apply additional deduplication (defense in depth)
    const deduplicated = deduplicateChunks(retrievalResult.chunks);

    // Step 6: Apply strict output budgets for agent tool
    const maxChunksReturned = 6;
    const maxCharsPerChunk = 4000;
    const maxTotalChars = 16000;

    const finalChunks: CodeChunk[] = [];
    let totalChars = 0;

    for (const chunk of deduplicated) {
      // Check maxChunksReturned limit
      if (finalChunks.length >= maxChunksReturned) {
        break;
      }

      // Truncate chunk content to maxCharsPerChunk
      let chunkContent = chunk.content;
      if (chunkContent.length > maxCharsPerChunk) {
        chunkContent = chunkContent.substring(0, maxCharsPerChunk);
      }

      // Check maxTotalChars limit
      if (totalChars + chunkContent.length > maxTotalChars) {
        // Can't add this chunk without exceeding budget
        break;
      }

      finalChunks.push({
        ...chunk,
        content: chunkContent,
      });

      totalChars += chunkContent.length;
    }

    // Step 7: Sort by score descending
    finalChunks.sort((a, b) => b.score - a.score);

    // Step 8: Format response
    const response: GetContextResponse = {
      contextChunks: finalChunks.map((chunk) => ({
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        score: chunk.score,
      })),
      stats: {
        chunksReturned: finalChunks.length,
        totalCharsReturned: totalChars,
      },
    };

    // Step 9: Log (without full code contents)
    console.log(
      `🔍 [agentTools/getContext] submissionId=${submissionId}, questionLength=${trimmedQuestion.length}, answerLength=${trimmedAnswer.length}, topK=${requestedTopK} (used=${retrievalResult.stats.requestedTopK}), chunksReturned=${response.stats.chunksReturned}, totalCharsReturned=${response.stats.totalCharsReturned}`
    );

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in get-context endpoint:", error);
    next(error);
  }
};

