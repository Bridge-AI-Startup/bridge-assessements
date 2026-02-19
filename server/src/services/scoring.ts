/**
 * Scoring Service
 *
 * Analyzes code submissions using Pinecone and calculates scores.
 * Currently implements completeness score (requirement matching).
 */

import SubmissionModel from "../models/submission.js";
import AssessmentModel from "../models/assessment.js";
import RepoIndexModel from "../models/repoIndex.js";
import { searchCodeChunks } from "./repoRetrieval.js";

/**
 * Extract requirements from assessment description
 * Looks for "Requirements" section in markdown format
 */
function extractRequirements(description: string): string[] {
  const requirements: string[] = [];

  // Try to find "## Requirements" section
  const requirementsMatch = description.match(
    /##\s+Requirements?\s+(?:\(must-have\))?\s*\n([\s\S]*?)(?=\n##|$)/
  );

  if (requirementsMatch) {
    const requirementsText = requirementsMatch[1];
    // Extract list items (lines starting with -, *, or numbered)
    const lines = requirementsText.split("\n");
    for (const line of lines) {
      // Match: - item, * item, 1. item, etc.
      const match = line.match(/^[\s]*[-*•]\s+(.+)$|^[\s]*\d+\.\s+(.+)$/);
      if (match) {
        const requirement = (match[1] || match[2]).trim();
        if (requirement) {
          requirements.push(requirement);
        }
      }
    }
  }

  // If no requirements section found, try to extract from "Acceptance Criteria"
  if (requirements.length === 0) {
    const criteriaMatch = description.match(
      /##\s+Acceptance\s+Criteria\s+\(definition\s+of\s+done\)\s*\n([\s\S]*?)(?=\n##|$)/
    );
    if (criteriaMatch) {
      const criteriaText = criteriaMatch[1];
      const lines = criteriaText.split("\n");
      for (const line of lines) {
        // Match checkbox items: - [ ] item
        const match = line.match(/^[\s]*[-*]\s+\[[\sx]\]\s+(.+)$/i);
        if (match) {
          const requirement = match[1].trim();
          if (requirement) {
            requirements.push(requirement);
          }
        }
      }
    }
  }

  // Fallback: if still no requirements, use first 5-8 sentences from description
  if (requirements.length === 0) {
    const sentences = description
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20 && s.length < 200)
      .slice(0, 8);
    requirements.push(...sentences);
  }

  return requirements;
}

/**
 * Calculate completeness score
 * - Searches Pinecone for evidence of each requirement
 * - Uses semantic search to find relevant code
 */
export async function calculateCompletenessScore(
  submissionId: string
): Promise<{
  score: number;
  breakdown: {
    requirementsMet: number;
    totalRequirements: number;
    details: Array<{
      requirement: string;
      met: boolean;
      evidence?: string;
      similarityScore?: number;
    }>;
  };
}> {
  // 1. Get submission and assessment
  const submission = await SubmissionModel.findById(submissionId).populate(
    "assessmentId"
  );

  if (!submission) {
    throw new Error("Submission not found");
  }

  if (!submission.assessmentId) {
    throw new Error("Assessment not found for this submission");
  }

  const assessment = submission.assessmentId as any;

  // 2. Check if repo is indexed
  const repoIndex = await RepoIndexModel.findOne({
    submissionId: submission._id,
  });

  if (!repoIndex || repoIndex.status !== "ready") {
    throw new Error(
      "Repository not indexed yet. Please wait for indexing to complete."
    );
  }

  // 3. Extract requirements from assessment description
  const requirements = extractRequirements(assessment.description);

  if (requirements.length === 0) {
    throw new Error(
      "No requirements found in assessment description. Cannot calculate completeness score."
    );
  }

  console.log(
    `📋 [scoring] Found ${requirements.length} requirements to check`
  );

  // 4. For each requirement, search Pinecone for evidence
  const requirementChecks = await Promise.all(
    requirements.map(async (req, index) => {
      try {
        console.log(
          `🔍 [scoring] Checking requirement ${index + 1}/${requirements.length}: "${req.substring(0, 50)}..."`
        );

        const chunks = await searchCodeChunks(submissionId, req, {
          topK: 3,
          maxChunks: 3,
          maxTotalChars: 5000,
        });

        // Consider requirement met if we found relevant code with good similarity
        const bestMatch = chunks.chunks[0];
        const met =
          chunks.chunks.length > 0 &&
          bestMatch &&
          bestMatch.score > 0.7; // Threshold: 0.7 similarity

        return {
          requirement: req,
          met,
          evidence: bestMatch?.path || null,
          similarityScore: bestMatch?.score || null,
        };
      } catch (error) {
        console.error(
          `❌ [scoring] Error checking requirement "${req}":`,
          error
        );
        return {
          requirement: req,
          met: false,
          evidence: null,
          similarityScore: null,
        };
      }
    })
  );

  // 5. Calculate score
  const met = requirementChecks.filter((r) => r.met).length;
  const score = Math.round((met / requirements.length) * 100);

  console.log(
    `✅ [scoring] Completeness score: ${score}% (${met}/${requirements.length} requirements met)`
  );

  return {
    score,
    breakdown: {
      requirementsMet: met,
      totalRequirements: requirements.length,
      details: requirementChecks,
    },
  };
}

/**
 * Calculate overall score and save to submission
 * Calculates completeness score and workflow scores (if available).
 * Resilient: runs with only completeness, only workflow, or both; does not overwrite existing scores with null.
 */
export async function calculateAndSaveScores(
  submissionId: string
): Promise<{
  overall: number | null;
  completeness: { score: number; breakdown: any } | null;
  workflow?: any;
}> {
  console.log(`🎯 [scoring] Calculating scores for submission ${submissionId}`);

  // Completeness (optional: repo may not be indexed)
  let completeness: { score: number; breakdown: any } | null = null;
  try {
    completeness = await calculateCompletenessScore(submissionId);
  } catch (error: any) {
    console.warn(
      `[scoring] Could not calculate completeness score: ${error.message}`
    );
  }

  // Workflow scores (optional: may have no trace or taskResults)
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

  // Overall: both → 40% completeness + 60% workflow; only one → that score; neither → null
  let overall: number | null = null;
  if (completeness != null && workflowScores != null) {
    overall = Math.round(
      completeness.score * 0.4 + workflowScores.overall.score * 0.6
    );
  } else if (completeness != null) {
    overall = completeness.score;
  } else if (workflowScores != null) {
    overall = workflowScores.overall.score;
  }

  // Build update payload: only set non-null values so we don't overwrite with null
  const updateData: any = {
    "scores.calculatedAt": new Date(),
    "scores.calculationVersion": "1.1.0",
  };
  if (completeness != null) {
    updateData["scores.completeness"] = {
      score: completeness.score,
      breakdown: completeness.breakdown,
      calculatedAt: new Date(),
    };
  }
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

  await SubmissionModel.findByIdAndUpdate(submissionId, updateData, {
    new: true,
  });

  console.log(
    `✅ [scoring] Scores saved: Overall=${overall ?? "n/a"}, Completeness=${
      completeness?.score ?? "n/a"
    }${workflowScores ? `, Workflow=${workflowScores.overall.score}` : ""}`
  );

  return {
    overall: overall ?? null,
    completeness,
    workflow: workflowScores ?? undefined,
  };
}
