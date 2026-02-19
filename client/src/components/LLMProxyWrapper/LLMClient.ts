/**
 * LLM Client Wrapper
 * Routes all LLM calls through proxy for logging
 * Candidates use this instead of direct OpenAI/Anthropic clients
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5050/api";

export class LLMClient {
  private sessionId: string;
  private submissionId: string;

  constructor(sessionId: string, submissionId: string) {
    this.sessionId = sessionId;
    this.submissionId = submissionId;
  }

  /**
   * Chat completion (OpenAI/Anthropic compatible interface)
   */
  async chat(
    messages: Array<{ role: string; content: string }>,
    options: {
      model?: string;
      provider?: "openai" | "anthropic" | "gemini";
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<{
    content: string;
    model: string;
    provider: string;
    usage: {
      tokens: number;
      cost: number;
      latency: number;
    };
  }> {
    const response = await fetch(`${API_BASE_URL}/llm-proxy/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.sessionId,
        submissionId: this.submissionId,
        model: options.model,
        provider: options.provider || "openai",
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "LLM call failed");
    }

    return await response.json();
  }

  /**
   * Generate session ID (call once at start of assessment)
   */
  static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}
