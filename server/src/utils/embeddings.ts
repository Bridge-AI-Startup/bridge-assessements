/**
 * Embeddings Helper
 *
 * Isolated embeddings logic using OpenAI.
 */

import OpenAI from "openai";

let openai: OpenAI | null = null;

/**
 * Initialize OpenAI client for embeddings
 */
function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }

    openai = new OpenAI({
      apiKey: apiKey,
    });

    console.log("✅ OpenAI client initialized for embeddings");
  }

  return openai;
}

/**
 * Generate embeddings for a batch of texts
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const client = getOpenAIClient();

  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
    dimensions: 512, // Match Pinecone index dimension (can be 512 or 1536)
  });

  return response.data.map((item) => item.embedding);
}

/**
 * Generate a single embedding
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const embeddings = await generateEmbeddings([text]);
  return embeddings[0];
}
