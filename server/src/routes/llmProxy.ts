import express from "express";
import { createChatCompletion, getModelForProvider } from "../services/langchainAI.js";
import {
  logLLMEvent,
  checkBudget,
  updateBudget,
} from "../services/llmProxy/logger.js";
import {
  estimateTokens,
  calculateCost,
} from "../services/llmProxy/costCalculator.js";
import SubmissionModel from "../models/submission.js";

const router = express.Router();

interface ProxyRequest {
  sessionId: string;
  submissionId: string;
  model?: string;
  provider?: string;
  messages: any[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * POST /api/llm-proxy/chat
 * Proxy endpoint for LLM chat completions
 * Public endpoint (no auth) - candidates use this via SDK
 */
router.post("/chat", async (req, res, next) => {
  try {
    const {
      sessionId,
      submissionId,
      model,
      provider = "openai",
      messages,
      temperature = 0.7,
      maxTokens = 1000,
    } = req.body as ProxyRequest;

    // Validate required fields
    if (!sessionId || !submissionId || !messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: "sessionId, submissionId, and messages array are required",
      });
    }

    // Verify submission exists and is in-progress
    const submission = await SubmissionModel.findById(submissionId);

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (submission.status !== "in-progress") {
      return res.status(400).json({
        error: "Can only use LLM proxy during active assessment",
      });
    }

    const startTime = Date.now();

    // Check budget limits
    const budget = await checkBudget(submissionId);
    if (budget.exceeded) {
      return res.status(429).json({
        error: "Budget exceeded",
        limit: budget.limit,
        used: budget.used,
        message: `Maximum cost ($${budget.limit}) or time (${budget.timeLimit}ms) exceeded`,
      });
    }

    // Determine model to use
    const modelToUse =
      model || getModelForProvider(provider as any, "workflow_evaluation");

    // Make actual LLM call through existing LangChain service
    // Use new use case: "workflow_evaluation"
    const response = await createChatCompletion("workflow_evaluation", messages, {
      provider: provider as any,
      model: modelToUse,
      temperature,
      maxTokens,
    });

    const latency = Date.now() - startTime;

    // Calculate tokens and cost
    const tokens = estimateTokens(messages, response.content);
    const cost = calculateCost(provider, modelToUse, tokens);

    // Log event to database
    await logLLMEvent({
      submissionId,
      sessionId,
      type: "llm_call",
      timestamp: new Date(),
      model: modelToUse,
      provider,
      prompt: JSON.stringify(messages),
      response: response.content,
      tokens: {
        input: tokens.input,
        output: tokens.output,
        total: tokens.total,
      },
      latency,
      cost,
      metadata: {
        temperature,
        maxTokens,
      },
    });

    // Update budget tracking
    await updateBudget(submissionId, cost, latency);

    res.json({
      content: response.content,
      model: response.model,
      provider: response.provider,
      usage: {
        tokens: tokens.total,
        cost,
        latency,
      },
    });
  } catch (error) {
    console.error("[llmProxy] Error:", error);
    next(error);
  }
});

export default router;
