/**
 * Pinecone Client Helper
 *
 * Isolated Pinecone logic for vector storage and retrieval.
 */

import { Pinecone } from "@pinecone-database/pinecone";

let pineconeClient: Pinecone | null = null;

/**
 * Initialize Pinecone client
 */
export function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error("PINECONE_API_KEY environment variable is not set");
    }

    pineconeClient = new Pinecone({
      apiKey: apiKey,
    });

    console.log("✅ Pinecone client initialized");
  }

  return pineconeClient;
}

/**
 * Get the Pinecone index
 */
export async function getPineconeIndex(indexName: string) {
  const client = getPineconeClient();
  return client.index(indexName);
}

/**
 * Upsert vectors into Pinecone
 */
export async function upsertVectors(
  indexName: string,
  namespace: string,
  vectors: Array<{
    id: string;
    values: number[];
    metadata: Record<string, any>;
  }>
): Promise<void> {
  const index = await getPineconeIndex(indexName);
  const namespaceIndex = index.namespace(namespace);

  await namespaceIndex.upsert(vectors);
  console.log(
    `✅ Upserted ${vectors.length} vectors to namespace ${namespace}`
  );
}

/**
 * Delete all vectors in a namespace
 */
export async function deleteNamespace(
  indexName: string,
  namespace: string
): Promise<void> {
  const index = await getPineconeIndex(indexName);
  const namespaceIndex = index.namespace(namespace);

  await namespaceIndex.deleteAll();
  console.log(`✅ Deleted all vectors from namespace ${namespace}`);
}

/**
 * Query Pinecone index for similar vectors
 */
export async function queryPinecone(
  indexName: string,
  namespace: string,
  queryVector: number[],
  topK: number,
  includeMetadata: boolean = true
): Promise<Array<{
  id: string;
  score: number;
  metadata?: Record<string, any>;
}>> {
  const index = await getPineconeIndex(indexName);
  const namespaceIndex = index.namespace(namespace);

  const queryResponse = await namespaceIndex.query({
    vector: queryVector,
    topK,
    includeMetadata,
  });

  return queryResponse.matches.map((match) => ({
    id: match.id,
    score: match.score || 0,
    metadata: match.metadata,
  }));
}
