import SubmissionModel from "../../models/submission.js";

interface LLMEvent {
  submissionId: string;
  sessionId: string;
  type: string;
  timestamp: Date;
  model?: string;
  provider?: string;
  prompt?: string;
  response?: any;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  latency?: number;
  cost?: number;
  metadata?: any;
  error?: string;
}

/**
 * Log LLM event to submission's trace
 */
export async function logLLMEvent(event: LLMEvent): Promise<void> {
  const submission = await SubmissionModel.findById(event.submissionId);
  if (!submission) {
    throw new Error(`Submission ${event.submissionId} not found`);
  }

  // Initialize llmWorkflow if it doesn't exist
  if (!submission.llmWorkflow) {
    submission.llmWorkflow = {
      trace: {
        sessionId: event.sessionId,
        events: [],
        totalTokens: 0,
        totalCost: 0,
        totalTime: 0,
        totalCalls: 0,
      },
      taskResults: [],
      scores: {},
      evaluation: {
        harnessVersion: "1.0.0",
        tasksCompleted: 0,
        tasksTotal: 0,
      },
    };
  }

  // Ensure trace exists
  if (!submission.llmWorkflow.trace) {
    submission.llmWorkflow.trace = {
      sessionId: event.sessionId,
      events: [],
      totalTokens: 0,
      totalCost: 0,
      totalTime: 0,
      totalCalls: 0,
    };
  }

  // Add event
  submission.llmWorkflow.trace.events.push({
    timestamp: event.timestamp,
    type: event.type,
    model: event.model || null,
    provider: event.provider || null,
    prompt: event.prompt || null,
    response: event.response || null,
    tokens: event.tokens || { input: 0, output: 0, total: 0 },
    latency: event.latency || 0,
    cost: event.cost || 0,
    metadata: event.metadata || {},
  });

  // Update totals
  if (event.tokens) {
    submission.llmWorkflow.trace.totalTokens += event.tokens.total;
  }
  if (event.cost) {
    submission.llmWorkflow.trace.totalCost += event.cost;
  }
  if (event.latency) {
    submission.llmWorkflow.trace.totalTime += event.latency;
  }
  submission.llmWorkflow.trace.totalCalls += 1;

  await submission.save();
}

/**
 * Check budget limits for a submission
 */
export async function checkBudget(submissionId: string): Promise<{
  exceeded: boolean;
  limit: number;
  used: number;
  timeLimit: number;
  timeUsed: number;
}> {
  const submission = await SubmissionModel.findById(submissionId).populate(
    "assessmentId"
  );
  if (!submission) {
    throw new Error("Submission not found");
  }

  const assessment = submission.assessmentId as any;

  // Default budget limits (configurable via env vars)
  const MAX_COST =
    parseFloat(process.env.LLM_PROXY_MAX_COST || "10.00"); // $10 default
  const MAX_TIME = parseInt(
    process.env.LLM_PROXY_MAX_TIME || "3600000"
  ); // 1 hour default

  const currentCost = submission.llmWorkflow?.trace?.totalCost || 0;
  const currentTime = submission.llmWorkflow?.trace?.totalTime || 0;

  return {
    exceeded: currentCost >= MAX_COST || currentTime >= MAX_TIME,
    limit: MAX_COST,
    used: currentCost,
    timeLimit: MAX_TIME,
    timeUsed: currentTime,
  };
}

/**
 * Update budget tracking (called after each LLM call)
 */
export async function updateBudget(
  submissionId: string,
  cost: number,
  latency: number
): Promise<void> {
  // Budget is already updated in logLLMEvent, this is a no-op for now
  // Can be extended for real-time budget checks
}
