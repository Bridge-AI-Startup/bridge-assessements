/**
 * Scoring Service
 *
 * Persists workflow evaluation scores (5D + overall) when an in-app LLM trace exists.
 * Pinecone-based "completeness" semantic matching was removed — it was not a reliable
 * signal; behavioral grading covers observable checks for take-home repos.
 */

import SubmissionModel from "../models/submission.js";

/**
 * Calculate overall score and save to submission.
 * Workflow scores only (requires llmWorkflow.trace with events).
 */
export async function calculateAndSaveScores(
  submissionId: string
): Promise<{
  overall: number | null;
  completeness: null;
  workflow?: any;
}> {
  console.log(`🎯 [scoring] Calculating workflow scores for submission ${submissionId}`);

  let workflowScores = null;
  try {
    const submission = await SubmissionModel.findById(submissionId);
    if (submission?.llmWorkflow?.trace?.events?.length > 0) {
      const { calculateWorkflowScores } = await import(
        "./workflowScoring/workflowScorer.js"
      );
      workflowScores = await calculateWorkflowScores(submissionId);
    }
  } catch (error: any) {
    console.warn(
      `[scoring] Could not calculate workflow scores: ${error.message}`
    );
  }

  const overall: number | null =
    workflowScores != null ? workflowScores.overall.score : null;

  const updateData: any = {};
  if (overall != null) {
    updateData["scores.overall"] = overall;
  }
  if (workflowScores != null) {
    updateData["llmWorkflow.scores"] = {
      ...workflowScores,
      calculatedAt: new Date(),
      calculationVersion: "1.0.0",
    };
  }

  if (Object.keys(updateData).length === 0) {
    console.warn(
      `[scoring] No workflow scores to save for ${submissionId} (no LLM trace); skipping update`
    );
    return {
      overall: null,
      completeness: null,
      workflow: workflowScores ?? undefined,
    };
  }

  updateData["scores.calculatedAt"] = new Date();
  updateData["scores.calculationVersion"] = "2.0.0";

  await SubmissionModel.findByIdAndUpdate(submissionId, updateData, {
    new: true,
  });

  console.log(
    `✅ [scoring] Scores saved: Overall=${overall ?? "n/a"}${
      workflowScores ? `, Workflow=${workflowScores.overall.score}` : ""
    }`
  );

  return {
    overall: overall ?? null,
    completeness: null,
    workflow: workflowScores ?? undefined,
  };
}
