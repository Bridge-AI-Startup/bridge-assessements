/**
 * Repository Retrieval Service
 *
 * Retrieves relevant code chunks from Pinecone for a given submission and query.
 * Includes deduplication and budget enforcement.
 */

import RepoIndexModel from "../models/repoIndex.js";
import { generateEmbedding } from "../utils/embeddings.js";
import { queryPinecone } from "../utils/pinecone.js";

export interface CodeChunk {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  language?: string;
}

export interface SearchCodeChunksOptions {
  topK?: number;
  maxChunks?: number;
  maxTotalChars?: number;
  maxChunkChars?: number;
}

export interface SearchCodeChunksResult {
  chunks: CodeChunk[];
  stats: {
    requestedTopK: number;
    returnedChunks: number;
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
 * Check if two chunks overlap significantly
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
 * Search code chunks for a submission
 */
export async function searchCodeChunks(
  submissionId: string,
  query: string,
  options: SearchCodeChunksOptions = {}
): Promise<SearchCodeChunksResult> {
  // 1. Validate inputs
  if (!submissionId) {
    throw new Error("submissionId is required");
  }

  const trimmedQuery = query?.trim();
  if (!trimmedQuery) {
    throw new Error("query is required and cannot be empty");
  }

  // Default options
  const topK = Math.min(options.topK ?? 8, 15); // Default 8, max 15
  const maxChunks = options.maxChunks ?? 8;
  const maxTotalChars = options.maxTotalChars ?? 16000;
  const maxChunkChars = options.maxChunkChars ?? 4000;

  // 2. Ensure repo is indexed
  const repoIndex = await RepoIndexModel.findOne({
    submissionId,
  }).sort({ createdAt: -1 }); // Get latest

  if (!repoIndex) {
    throw new Error("Repo not indexed yet");
  }

  if (repoIndex.status !== "ready") {
    throw new Error("Repo not indexed yet");
  }

  // 3. Embed query
  console.log(`🔍 [repoRetrieval] Embedding query: "${trimmedQuery}"`);
  const queryEmbedding = await generateEmbedding(trimmedQuery);

  // 4. Query Pinecone
  const indexName = repoIndex.pinecone.indexName;
  const namespace = repoIndex.pinecone.namespace;

  console.log(
    `🔍 [repoRetrieval] Querying Pinecone: index=${indexName}, namespace=${namespace}, topK=${topK}`
  );

  const matches = await queryPinecone(
    indexName,
    namespace,
    queryEmbedding,
    topK,
    true
  );

  console.log(`✅ [repoRetrieval] Found ${matches.length} matches`);

  // 5. Normalize results
  const chunks: CodeChunk[] = matches
    .map((match) => {
      const metadata = match.metadata;
      if (!metadata || !metadata.filePath) {
        console.warn(
          `⚠️ [repoRetrieval] Match ${match.id} missing required metadata`
        );
        return null;
      }

      // Ensure numeric fields are numbers
      const startLine =
        typeof metadata.startLine === "number"
          ? metadata.startLine
          : parseInt(metadata.startLine) || 0;
      const endLine =
        typeof metadata.endLine === "number"
          ? metadata.endLine
          : parseInt(metadata.endLine) || 0;

      return {
        path: String(metadata.filePath),
        startLine,
        endLine,
        content: String(metadata.content || ""),
        score: match.score,
        language: metadata.language ? String(metadata.language) : undefined,
      };
    })
    .filter((chunk): chunk is CodeChunk => chunk !== null && chunk.path !== "");

  // 6. Deduplicate overlapping chunks
  const deduplicated = deduplicateChunks(chunks);
  console.log(
    `🔄 [repoRetrieval] Deduplicated: ${chunks.length} -> ${deduplicated.length} chunks`
  );

  // 7. Enforce strict output size budgets
  const finalChunks: CodeChunk[] = [];
  let totalChars = 0;

  for (const chunk of deduplicated) {
    // Check maxChunks limit
    if (finalChunks.length >= maxChunks) {
      break;
    }

    // Truncate chunk content to maxChunkChars
    let chunkContent = chunk.content;
    if (chunkContent.length > maxChunkChars) {
      chunkContent = chunkContent.substring(0, maxChunkChars);
      console.log(
        `✂️ [repoRetrieval] Truncated chunk ${chunk.path}:${chunk.startLine} from ${chunk.content.length} to ${maxChunkChars} chars`
      );
    }

    // Check maxTotalChars limit
    if (totalChars + chunkContent.length > maxTotalChars) {
      // Can't add this chunk without exceeding budget
      console.log(
        `⚠️ [repoRetrieval] Stopping at ${finalChunks.length} chunks (${totalChars} chars) to stay under ${maxTotalChars} char limit`
      );
      break;
    }

    finalChunks.push({
      ...chunk,
      content: chunkContent,
    });

    totalChars += chunkContent.length;
  }

  console.log(
    `✅ [repoRetrieval] Final result: ${finalChunks.length} chunks, ${totalChars} total chars`
  );

  return {
    chunks: finalChunks,
    stats: {
      requestedTopK: topK,
      returnedChunks: finalChunks.length,
      totalCharsReturned: totalChars,
    },
  };
}

