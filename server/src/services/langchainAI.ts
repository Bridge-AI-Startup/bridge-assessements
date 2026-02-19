import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type AIProvider = "openai" | "anthropic" | "gemini";

/**
 * Different AI use cases in the application
 */
export type AIUseCase =
  | "assessment_generation" // Generate assessment components from job description
  | "assessment_chat" // Chat with assessment AI assistant
  | "interview_questions" // Generate interview questions from code
  | "interview_summary" // Generate interview summary from transcript
  | "workflow_evaluation"; // LLM workflow evaluation proxy

/**
 * Get the provider for a specific use case
 */
export function getProviderForUseCase(useCase: AIUseCase): AIProvider {
  // Check for use-case-specific provider (e.g., AI_PROVIDER_ASSESSMENT_GENERATION)
  const useCaseKey = `AI_PROVIDER_${useCase.toUpperCase().replace(/-/g, "_")}`;
  const useCaseProvider = process.env[useCaseKey]?.toLowerCase() as
    | AIProvider
    | undefined;

  if (
    useCaseProvider &&
    ["openai", "anthropic", "gemini"].includes(useCaseProvider)
  ) {
    return useCaseProvider;
  }

  // Fall back to global provider
  const globalProvider = (
    process.env.AI_PROVIDER || "openai"
  ).toLowerCase() as AIProvider;
  if (["openai", "anthropic", "gemini"].includes(globalProvider)) {
    return globalProvider;
  }

  return "openai";
}

/**
 * Get the model name for a provider and use case
 */
export function getModelForProvider(
  provider: AIProvider,
  useCase: AIUseCase
): string {
  // Check for use-case-specific model
  const useCaseKey = `${provider.toUpperCase()}_MODEL_${useCase
    .toUpperCase()
    .replace(/-/g, "_")}`;
  const useCaseModel = process.env[useCaseKey];

  if (useCaseModel) {
    return useCaseModel;
  }

  // Fall back to provider-specific default
  const providerKey = `${provider.toUpperCase()}_MODEL`;
  const providerModel = process.env[providerKey];

  if (providerModel) {
    return providerModel;
  }

  // Default models per provider
  const defaults: Record<AIProvider, string> = {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-sonnet-20241022",
    gemini: "gemini-1.5-pro",
  };

  return defaults[provider];
}

/**
 * Create a LangChain chat model instance
 */
export function createChatModel(
  provider: AIProvider,
  model: string,
  options: {
    temperature?: number;
    maxTokens?: number;
  } = {}
): ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI {
  const { temperature = 0.7, maxTokens = 1000 } = options;

  switch (provider) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY is required when using OpenAI provider"
        );
      }
      return new ChatOpenAI({
        modelName: model,
        temperature,
        maxTokens,
        openAIApiKey: apiKey,
      });
    }

    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is required when using Anthropic provider"
        );
      }
      return new ChatAnthropic({
        modelName: model,
        temperature,
        maxTokens,
        anthropicApiKey: apiKey,
      });
    }

    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "GEMINI_API_KEY is required when using Gemini provider"
        );
      }
      return new ChatGoogleGenerativeAI({
        modelName: model,
        temperature,
        maxOutputTokens: maxTokens,
        apiKey: apiKey,
      });
    }

    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * Get or create a chat model for a specific use case
 */
const modelCache = new Map<
  string,
  ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI
>();

export function getChatModelForUseCase(
  useCase: AIUseCase,
  options: {
    temperature?: number;
    maxTokens?: number;
  } = {}
): ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI {
  const provider = getProviderForUseCase(useCase);
  const model = getModelForProvider(provider, useCase);

  // Create cache key
  const cacheKey = `${useCase}:${provider}:${model}:${
    options.temperature ?? 0.7
  }:${options.maxTokens ?? 1000}`;

  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey)!;
  }

  const chatModel = createChatModel(provider, model, options);
  modelCache.set(cacheKey, chatModel);
  return chatModel;
}

/**
 * Interface for chat messages
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Convert messages to LangChain format
 */
export function convertToLangChainMessages(
  messages: ChatMessage[]
): (HumanMessage | SystemMessage | AIMessage)[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case "system":
        return new SystemMessage(msg.content);
      case "user":
        return new HumanMessage(msg.content);
      case "assistant":
        return new AIMessage(msg.content);
      default:
        throw new Error(`Unknown message role: ${msg.role}`);
    }
  });
}

/**
 * Create a chat completion using LangChain for a specific use case
 */
export async function createChatCompletion(
  useCase: AIUseCase,
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "json_object" };
    provider?: AIProvider; // Override provider from prompt config
    model?: string; // Override model from prompt config
  } = {}
): Promise<{
  content: string;
  model?: string;
  provider: AIProvider;
}> {
  // Use provider from options (prompt config) if provided, otherwise use environment variables
  const provider = options.provider || getProviderForUseCase(useCase);
  // Use model from options (prompt config) if provided, otherwise use environment variables
  const model = options.model || getModelForProvider(provider, useCase);

  console.log(
    `🤖 [LangChain: ${provider}] Use case: ${useCase}, Model: ${model}`
  );

  try {
    // Create model with overrides if provided
    const chatModel =
      options.provider && options.model
        ? createChatModel(options.provider, options.model, {
            temperature: options.temperature ?? 0.7,
            maxTokens: options.maxTokens ?? 1000,
          })
        : getChatModelForUseCase(useCase, {
            temperature: options.temperature ?? 0.7,
            maxTokens: options.maxTokens ?? 1000,
          });

    const langChainMessages = convertToLangChainMessages(messages);

    // Handle JSON mode
    if (options.responseFormat?.type === "json_object") {
      // For JSON mode, we need to add instructions and use a parser
      const systemMessage = messages.find((m) => m.role === "system");
      const userMessages = messages.filter((m) => m.role === "user");
      const assistantMessages = messages.filter((m) => m.role === "assistant");

      // Update system message to include JSON instruction
      const jsonSystemMessage = systemMessage
        ? `${systemMessage.content}\n\nIMPORTANT: You must respond with valid JSON only. Do not include any text outside of the JSON object.`
        : "You must respond with valid JSON only. Do not include any text outside of the JSON object.";

      const updatedMessages = [
        new SystemMessage(jsonSystemMessage),
        ...userMessages.map((m) => new HumanMessage(m.content)),
        ...assistantMessages.map((m) => new AIMessage(m.content)),
      ];

      const response = await chatModel.invoke(updatedMessages as any);
      let content = response.content as string;

      // Log response metadata if available
      if (response.response_metadata) {
        console.log(`📊 [LangChain] Response metadata:`, {
          tokenUsage: response.response_metadata.tokenUsage,
          finishReason: response.response_metadata.finishReason,
        });

        // Warn if response was cut off due to token limit
        if (response.response_metadata.finishReason === "length") {
          console.warn(
            "⚠️ [LangChain] Response was truncated due to token limit!"
          );
        }
      }

      // Try to extract JSON if wrapped in markdown or other text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      return {
        content: content.trim(),
        model,
        provider,
      };
    }

    // Regular text response
    const response = await chatModel.invoke(langChainMessages as any);
    const content = response.content as string;

    return {
      content: content.trim(),
      model,
      provider,
    };
  } catch (error) {
    console.error(
      `❌ [LangChain: ${provider}] Error in use case ${useCase}:`,
      error
    );
    throw error;
  }
}

/**
 * Initialize and log all configured AI providers
 */
export function initializeLangChainAI(): void {
  const useCases: AIUseCase[] = [
    "assessment_generation",
    "assessment_chat",
    "interview_questions",
    "interview_summary",
  ];

  console.log("✅ LangChain AI initialized");
  console.log("📋 Provider configuration per use case:");

  useCases.forEach((useCase) => {
    const provider = getProviderForUseCase(useCase);
    const model = getModelForProvider(provider, useCase);
    console.log(`   ${useCase}: ${provider} (${model})`);

    // Validate API key is set
    try {
      switch (provider) {
        case "openai":
          if (!process.env.OPENAI_API_KEY) {
            console.warn(`   ⚠️  OPENAI_API_KEY not set for ${useCase}`);
          }
          break;
        case "anthropic":
          if (!process.env.ANTHROPIC_API_KEY) {
            console.warn(`   ⚠️  ANTHROPIC_API_KEY not set for ${useCase}`);
          }
          break;
        case "gemini":
          if (!process.env.GEMINI_API_KEY) {
            console.warn(`   ⚠️  GEMINI_API_KEY not set for ${useCase}`);
          }
          break;
      }
    } catch (error) {
      console.error(`   ❌ Error validating ${useCase}:`, error);
    }
  });
}
