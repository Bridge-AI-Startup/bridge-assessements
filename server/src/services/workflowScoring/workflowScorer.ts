import SubmissionModel from "../../models/submission.js";

interface CorrectnessScore {
  score: number;
  breakdown: {
    testPassRate: number;
    edgeCaseHandling: number;
    reliability: number;
  };
  evidence: {
    passingTests: number;
    failingTests: number;
    totalTests: number;
    rerunConsistency: number | null;
  };
}

interface EfficiencyScore {
  score: number;
  breakdown: {
    costPerTask: number;
    timeToGreen: number;
    turnEfficiency: number;
  };
  evidence: {
    totalCost: number;
    totalTime: number;
    totalTurns: number;
    retryCount: number;
    cacheHits: number;
  };
}

interface PromptQualityScore {
  score: number;
  breakdown: {
    clarity: number;
    decomposition: number;
    feedbackUsage: number;
  };
  evidence: {
    constraintSpecification: boolean;
    verificationPrompts: number;
    clarificationRequests: number;
    thrashDetected: boolean;
    promptExcerpts: string[];
  };
}

interface StructureScore {
  score: number;
  breakdown: {
    modularity: number;
    configurability: number;
    observability: number;
    resilience: number;
  };
  evidence: {
    moduleCount: number;
    configFiles: number;
    logStatements: number;
    errorHandlers: number;
    retryPatterns: number;
  };
}

interface ReliabilityScore {
  score: number;
  breakdown: {
    failureHandling: number;
    safety: number;
  };
  evidence: {
    gracefulFailures: number;
    secretLeaks: number;
    unsafeInstructions: number;
  };
}

interface OverallScore {
  score: number;
  confidence: number;
  reasonCodes: string[];
}

interface WorkflowScores {
  correctness: CorrectnessScore;
  efficiency: EfficiencyScore;
  promptQuality: PromptQualityScore;
  structure: StructureScore;
  reliability: ReliabilityScore;
  overall: OverallScore;
}

/**
 * Calculate all workflow scores for a submission
 */
export async function calculateWorkflowScores(
  submissionId: string
): Promise<WorkflowScores> {
  const submission = await SubmissionModel.findById(submissionId);
  if (!submission) {
    throw new Error("Submission not found");
  }

  if (!submission.llmWorkflow?.trace) {
    throw new Error(
      "LLM workflow trace not found. Ensure trace is uploaded."
    );
  }

  // Allow missing taskResults (e.g. old submission or task run not saved); correctness/structure will be 0
  if (submission.llmWorkflow.taskResults == null) {
    submission.llmWorkflow.taskResults = [];
  }

  // Calculate each dimension
  const correctness = await calculateCorrectnessScore(submission);
  const efficiency = await calculateEfficiencyScore(submission);
  const promptQuality = await calculatePromptQualityScore(submission);
  const structure = await calculateStructureScore(submission);
  const reliability = await calculateReliabilityScore(submission);

  // Calculate overall score
  const overall = {
    score:
      correctness.score +
      efficiency.score +
      promptQuality.score +
      structure.score +
      reliability.score,
    confidence: calculateConfidence(correctness, efficiency, promptQuality),
    reasonCodes: generateReasonCodes(
      correctness,
      efficiency,
      promptQuality,
      structure,
      reliability
    ),
  };

  return {
    correctness,
    efficiency,
    promptQuality,
    structure,
    reliability,
    overall,
  };
}

/**
 * Correctness Score (40 points)
 */
async function calculateCorrectnessScore(
  submission: any
): Promise<CorrectnessScore> {
  const taskResults = submission.llmWorkflow.taskResults || [];

  let totalTests = 0;
  let passedTests = 0;
  let edgeCaseTests = 0;
  let passedEdgeCases = 0;

  for (const result of taskResults) {
    totalTests += result.testResults.total;
    passedTests += result.testResults.passed;

    // Count edge case failures (marked in test names)
    const edgeCaseFailures = result.testResults.failures.filter((f: any) =>
      /edge|corner|boundary/i.test(f.testName)
    );
    edgeCaseTests += edgeCaseFailures.length;
    // Edge cases that passed = total - failures
    passedEdgeCases +=
      result.testResults.total - result.testResults.failed - edgeCaseFailures.length;
  }

  const testPassRate =
    totalTests > 0 ? Math.round((passedTests / totalTests) * 30) : 0;

  const edgeCaseScore =
    edgeCaseTests > 0
      ? Math.round((passedEdgeCases / edgeCaseTests) * 5)
      : 0;

  // Reliability: Run tasks 3 times, check consistency
  // For MVP, assume single run (reliability = 5 if all passed)
  const reliability = passedTests === totalTests ? 5 : 0;

  return {
    score: testPassRate + edgeCaseScore + reliability,
    breakdown: {
      testPassRate,
      edgeCaseHandling: edgeCaseScore,
      reliability,
    },
    evidence: {
      passingTests: passedTests,
      failingTests: totalTests - passedTests,
      totalTests,
      rerunConsistency: reliability * 100 / 5, // Convert to percentage
    },
  };
}

/**
 * Efficiency Score (20 points)
 */
async function calculateEfficiencyScore(
  submission: any
): Promise<EfficiencyScore> {
  const trace = submission.llmWorkflow.trace;
  const taskResults = submission.llmWorkflow.taskResults || [];

  const totalCost = trace.totalCost || 0;
  const totalTime = trace.totalTime || 0;
  const totalCalls = trace.totalCalls || 0;
  const taskCount = taskResults.length || 1;

  // Cost per task (normalized, lower is better)
  const costPerTask = totalCost / taskCount;
  const costScore = Math.max(0, 10 - Math.round(costPerTask * 100)); // Normalize

  // Time to green (minutes)
  const avgTimePerTask = (totalTime / 1000 / 60) / taskCount;
  const timeScore = Math.max(0, 5 - Math.round(avgTimePerTask / 2));

  // Turn efficiency (penalize excessive retries)
  const retryCount = countRetries(trace.events);
  const turnScore = Math.max(0, 5 - Math.round(retryCount / taskCount));

  return {
    score: costScore + timeScore + turnScore,
    breakdown: {
      costPerTask: costScore,
      timeToGreen: timeScore,
      turnEfficiency: turnScore,
    },
    evidence: {
      totalCost,
      totalTime,
      totalTurns: totalCalls,
      retryCount,
      cacheHits: 0, // Not implemented in MVP
    },
  };
}

/**
 * Prompt Quality Score (15 points)
 * Rule-based analysis + LLM-as-judge
 */
async function calculatePromptQualityScore(
  submission: any
): Promise<PromptQualityScore> {
  const events = submission.llmWorkflow.trace.events.filter(
    (e: any) => e.type === "llm_call"
  );

  // Rule-based signals
  const clarity = analyzeClarity(events);
  const decomposition = analyzeDecomposition(events);
  const feedbackUsage = analyzeFeedbackUsage(events);

  return {
    score: Math.round(clarity + decomposition + feedbackUsage),
    breakdown: {
      clarity: Math.round(clarity),
      decomposition: Math.round(decomposition),
      feedbackUsage: Math.round(feedbackUsage),
    },
    evidence: {
      constraintSpecification: hasConstraints(events),
      verificationPrompts: countVerificationPrompts(events),
      clarificationRequests: countClarifications(events),
      thrashDetected: detectThrashing(events),
      promptExcerpts: extractKeyPrompts(events).slice(0, 5), // Limit to 5
    },
  };
}

/**
 * Structure Score (20 points)
 */
async function calculateStructureScore(
  submission: any
): Promise<StructureScore> {
  // For MVP, analyze code from task results
  // In future, analyze actual code files

  const taskResults = submission.llmWorkflow.taskResults || [];

  // Simple heuristics based on test results and file changes
  const modularity = taskResults.length > 0 ? 8 : 0; // Assume modular if multiple tasks
  const configurability = 5; // Default score
  const observability = 4; // Default score
  const resilience = 3; // Default score

  return {
    score: modularity + configurability + observability + resilience,
    breakdown: {
      modularity,
      configurability,
      observability,
      resilience,
    },
    evidence: {
      moduleCount: taskResults.length,
      configFiles: 0,
      logStatements: 0,
      errorHandlers: 0,
      retryPatterns: 0,
    },
  };
}

/**
 * Reliability Score (5 points)
 */
async function calculateReliabilityScore(
  submission: any
): Promise<ReliabilityScore> {
  const events = submission.llmWorkflow.trace.events || [];

  // Count graceful failures
  const gracefulFailures = events.filter(
    (e: any) =>
      e.response &&
      /error|failed/i.test(e.response) &&
      /try|catch|handle/i.test(e.response)
  ).length;

  // Check for secret leaks (simple pattern matching)
  const secretLeaks = events.filter(
    (e: any) =>
      /password|secret|api_key|token/i.test(e.prompt || "") &&
      !/redact|mask|hide/i.test(e.prompt || "")
  ).length;

  const failureHandling = gracefulFailures > 0 ? 3 : 0;
  const safety = secretLeaks === 0 ? 2 : 0;

  return {
    score: failureHandling + safety,
    breakdown: {
      failureHandling,
      safety,
    },
    evidence: {
      gracefulFailures,
      secretLeaks,
      unsafeInstructions: 0,
    },
  };
}

// Helper functions for prompt analysis
function analyzeClarity(events: any[]): number {
  if (events.length === 0) return 0;

  let score = 0;
  for (const event of events) {
    const prompt = event.prompt || "";
    if (/goal|objective|requirement/i.test(prompt)) score += 0.5;
    if (/constraint|limit|budget|timeout/i.test(prompt)) score += 0.5;
    if (prompt.length > 2000) score -= 0.2; // Penalize verbosity
  }
  return Math.min(5, (score / events.length) * 5);
}

function analyzeDecomposition(events: any[]): number {
  if (events.length === 0) return 0;

  let score = 0;
  for (const event of events) {
    const prompt = event.prompt || "";
    if (/step|plan|first|then|next/i.test(prompt)) score += 1;
    if (/verify|check|test|validate/i.test(prompt)) score += 1;
  }
  return Math.min(5, (score / events.length) * 2.5);
}

function analyzeFeedbackUsage(events: any[]): number {
  if (events.length === 0) return 0;

  let score = 0;
  let previousError: string | null = null;

  for (const event of events) {
    const prompt = event.prompt || "";
    const response = event.response || "";

    if (previousError && prompt.includes(previousError)) {
      score += 1; // Good: learning from errors
    }

    if (/error|failed/i.test(response)) {
      previousError = extractError(response);
    }
  }

  return Math.min(5, (score / events.length) * 5);
}

function hasConstraints(events: any[]): boolean {
  return events.some((e) =>
    /constraint|limit|budget|timeout/i.test(e.prompt || "")
  );
}

function countVerificationPrompts(events: any[]): number {
  return events.filter((e) =>
    /verify|check|test|validate/i.test(e.prompt || "")
  ).length;
}

function countClarifications(events: any[]): number {
  return events.filter((e) =>
    /clarify|explain|what|how|why/i.test(e.prompt || "")
  ).length;
}

function detectThrashing(events: any[]): boolean {
  // Detect repeated similar prompts without progress
  const prompts = events.map((e) => (e.prompt || "").substring(0, 100));
  const uniquePrompts = new Set(prompts);
  return prompts.length > uniquePrompts.size * 2; // More than 2x duplicates
}

function extractKeyPrompts(events: any[]): string[] {
  return events
    .map((e) => e.prompt || "")
    .filter((p) => p.length > 20)
    .slice(0, 10); // Return first 10
}

function countRetries(events: any[]): number {
  // Count consecutive failures followed by retry
  let retries = 0;
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (
      prev.response &&
      /error|failed/i.test(prev.response) &&
      curr.prompt &&
      prev.prompt &&
      curr.prompt.includes(prev.prompt.substring(0, 50))
    ) {
      retries++;
    }
  }
  return retries;
}

function extractError(response: string): string {
  const errorMatch = response.match(/error[:\s]+(.+?)(\n|$)/i);
  return errorMatch ? errorMatch[1] : "";
}

function calculateConfidence(
  correctness: any,
  efficiency: any,
  promptQuality: any
): number {
  // Confidence based on data completeness
  const hasTrace = correctness.evidence.totalTests > 0;
  const hasCost = efficiency.evidence.totalCost > 0;
  const hasPrompts = promptQuality.evidence.promptExcerpts.length > 0;

  let confidence = 0;
  if (hasTrace) confidence += 0.4;
  if (hasCost) confidence += 0.3;
  if (hasPrompts) confidence += 0.3;

  return Math.min(1, confidence);
}

function generateReasonCodes(
  correctness: any,
  efficiency: any,
  promptQuality: any,
  structure: any,
  reliability: any
): string[] {
  const codes: string[] = [];

  if (efficiency.evidence.retryCount > 5) {
    codes.push(
      `High cost due to ${efficiency.evidence.retryCount} retries on failing tests`
    );
  }

  if (correctness.evidence.failingTests > 0) {
    codes.push(`${correctness.evidence.failingTests} test(s) failed`);
  }

  if (promptQuality.evidence.thrashDetected) {
    codes.push("Repeated prompts detected (thrashing)");
  }

  if (reliability.evidence.secretLeaks > 0) {
    codes.push("Potential secret leaks detected in prompts");
  }

  return codes;
}
