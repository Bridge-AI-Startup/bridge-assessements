/**
 * Estimate token count for messages and response
 */
export function estimateTokens(
  messages: any[],
  response: string
): { input: number; output: number; total: number } {
  // Simple estimation: ~4 characters per token
  // For production, use tiktoken library
  const inputText = JSON.stringify(messages);
  const inputTokens = Math.ceil(inputText.length / 4);
  const outputTokens = Math.ceil(response.length / 4);

  return {
    input: inputTokens,
    output: outputTokens,
    total: inputTokens + outputTokens,
  };
}

/**
 * Calculate cost based on provider, model, and tokens
 * Pricing as of 2024 (update as needed)
 */
export function calculateCost(
  provider: string,
  model: string,
  tokens: { input: number; output: number }
): number {
  // Pricing per 1M tokens (input/output)
  const pricing: Record<string, { input: number; output: number }> = {
    openai: {
      "gpt-4o": { input: 2.5, output: 10.0 },
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
      "gpt-4": { input: 30.0, output: 60.0 },
      "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
    },
    anthropic: {
      "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
      "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
    },
    gemini: {
      "gemini-1.5-pro": { input: 1.25, output: 5.0 },
      "gemini-1.5-flash": { input: 0.075, output: 0.3 },
    },
  };

  const providerPricing = pricing[provider] || pricing["openai"];
  const modelPricing = providerPricing[model] || providerPricing["gpt-4o-mini"];

  const inputCost = (tokens.input / 1_000_000) * modelPricing.input;
  const outputCost = (tokens.output / 1_000_000) * modelPricing.output;

  return inputCost + outputCost;
}
