import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

export type AIProvider = "openai" | "anthropic" | "gemini";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
}

export interface ChatCompletionResponse {
  content: string;
  model?: string;
}

/**
 * Get the configured AI provider from environment variables
 */
export function getAIProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase() as AIProvider;
  
  if (provider === "anthropic" || provider === "gemini" || provider === "openai") {
    return provider;
  }
  
  console.warn(`⚠️  Invalid AI_PROVIDER "${provider}", defaulting to "openai"`);
  return "openai";
}

/**
 * Get the model name for the current provider
 */
export function getModelForProvider(provider: AIProvider, defaultModel?: string): string {
  if (defaultModel) {
    return defaultModel;
  }

  switch (provider) {
    case "openai":
      return process.env.OPENAI_MODEL || "gpt-4o-mini";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
    case "gemini":
      return process.env.GEMINI_MODEL || "gemini-1.5-pro";
    default:
      return "gpt-4o-mini";
  }
}

/**
 * Initialize OpenAI client
 */
function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when using OpenAI provider");
  }
  return new OpenAI({ apiKey });
}

/**
 * Initialize Anthropic client
 */
function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when using Anthropic provider");
  }
  return new Anthropic({ apiKey });
}

/**
 * Initialize Gemini client
 */
function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required when using Gemini provider");
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Convert messages to Anthropic format
 * Returns { messages, system } where system is the combined system message
 */
function convertMessagesForAnthropic(
  messages: ChatMessage[]
): { messages: Anthropic.MessageParam[]; system?: string } {
  const systemMessages: string[] = [];
  const conversationMessages: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(msg.content);
    } else if (msg.role === "user") {
      conversationMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      conversationMessages.push({ role: "assistant", content: msg.content });
    }
  }

  return {
    messages: conversationMessages,
    system: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined,
  };
}

/**
 * Convert messages to Gemini format
 * Returns messages without system messages (system is handled separately)
 */
function convertMessagesForGemini(
  messages: ChatMessage[]
): Array<{ role: string; parts: Array<{ text: string }> }> {
  const geminiMessages: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  for (const msg of messages) {
    // Skip system messages - they're handled via systemInstruction parameter
    if (msg.role === "system") {
      continue;
    }
    
    const role = msg.role === "assistant" ? "model" : "user";
    geminiMessages.push({
      role,
      parts: [{ text: msg.content }],
    });
  }

  return geminiMessages;
}

/**
 * Create a chat completion using the configured AI provider
 */
export async function createChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResponse> {
  const provider = getAIProvider();
  const model = getModelForProvider(provider, options.model);
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 1000;

  console.log(`🤖 [AI Provider: ${provider}] Creating chat completion with model: ${model}`);

  try {
    switch (provider) {
      case "openai": {
        const client = getOpenAIClient();
        const response = await client.chat.completions.create({
          model,
          messages: messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          temperature,
          max_tokens: maxTokens,
          ...(options.responseFormat && { response_format: options.responseFormat }),
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) {
          throw new Error("No content in OpenAI response");
        }

        return {
          content,
          model: response.model,
        };
      }

      case "anthropic": {
        const client = getAnthropicClient();
        const { messages: anthropicMessages, system } = convertMessagesForAnthropic(messages);

        // Anthropic requires at least one user message
        if (anthropicMessages.length === 0 || anthropicMessages[0].role !== "user") {
          throw new Error("Anthropic requires at least one user message");
        }

        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: anthropicMessages,
          ...(system && { system }),
        });

        const content = response.content[0]?.text?.trim();
        if (!content) {
          throw new Error("No content in Anthropic response");
        }

        return {
          content,
          model: response.model,
        };
      }

      case "gemini": {
        const client = getGeminiClient();
        const geminiMessages = convertMessagesForGemini(messages);

        // Extract system instruction if present
        const systemInstruction = messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n");

        // Configure generation options
        const generationConfig: any = {
          temperature,
          maxOutputTokens: maxTokens,
        };

        // Gemini supports JSON mode through responseMimeType
        if (options.responseFormat?.type === "json_object") {
          generationConfig.responseMimeType = "application/json";
        }

        const geminiModel = client.getGenerativeModel({
          model,
          systemInstruction: systemInstruction || undefined,
          generationConfig,
        });

        // For single-turn conversations, use generateContent
        // For multi-turn, use startChat
        if (geminiMessages.length === 1) {
          const result = await geminiModel.generateContent(
            geminiMessages[0].parts[0].text
          );
          const response = result.response;
          const content = response.text()?.trim();

          if (!content) {
            throw new Error("No content in Gemini response");
          }

          return {
            content,
            model: model,
          };
        } else {
          // Multi-turn conversation
          const chat = geminiModel.startChat({
            history: geminiMessages.slice(0, -1).map((msg) => ({
              role: msg.role,
              parts: msg.parts,
            })),
          });

          const lastMessage = geminiMessages[geminiMessages.length - 1];
          const result = await chat.sendMessage(lastMessage.parts[0].text);
          const response = result.response;
          const content = response.text()?.trim();

          if (!content) {
            throw new Error("No content in Gemini response");
          }

          return {
            content,
            model: model,
          };
        }
      }

      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  } catch (error) {
    console.error(`❌ [AI Provider: ${provider}] Error creating chat completion:`, error);
    throw error;
  }
}

/**
 * Initialize and log the configured AI provider
 */
export function initializeAIProvider(): void {
  const provider = getAIProvider();
  console.log(`✅ AI Provider initialized: ${provider}`);

  // Validate API keys are set
  try {
    switch (provider) {
      case "openai":
        if (!process.env.OPENAI_API_KEY) {
          console.warn("⚠️  OPENAI_API_KEY not set. AI features will not work.");
        } else {
          console.log("✅ OpenAI API key configured");
        }
        break;
      case "anthropic":
        if (!process.env.ANTHROPIC_API_KEY) {
          console.warn("⚠️  ANTHROPIC_API_KEY not set. AI features will not work.");
        } else {
          console.log("✅ Anthropic API key configured");
        }
        break;
      case "gemini":
        if (!process.env.GEMINI_API_KEY) {
          console.warn("⚠️  GEMINI_API_KEY not set. AI features will not work.");
        } else {
          console.log("✅ Gemini API key configured");
        }
        break;
    }
  } catch (error) {
    console.error("❌ Error initializing AI provider:", error);
  }
}

