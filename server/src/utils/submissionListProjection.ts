import mongoose from "mongoose";

/**
 * Aggregation pipeline for the employer submissions list. Projects only the
 * fields the dashboard rows/stats need and never transfers heavy blobs
 * (trace events, raw OCR transcript, refined transcript, Mixed transcript fields)
 * from MongoDB to Node. Mongoose .select() cannot trim subpaths inside Mixed types.
 */
export function buildSubmissionListAggregationPipeline(
  assessmentId: string
): mongoose.PipelineStage[] {
  const assessmentObjectId = new mongoose.Types.ObjectId(assessmentId);

  return [
    { $match: { assessmentId: assessmentObjectId } },
    { $sort: { submittedAt: -1, createdAt: -1 } },
    {
      $set: {
        llmWorkflow: {
          $cond: [
            { $ifNull: ["$llmWorkflow", false] },
            {
              scores: "$llmWorkflow.scores",
              evaluation: "$llmWorkflow.evaluation",
              trace: {
                sessionId: "$llmWorkflow.trace.sessionId",
                totalTokens: "$llmWorkflow.trace.totalTokens",
                totalCost: "$llmWorkflow.trace.totalCost",
                totalTime: "$llmWorkflow.trace.totalTime",
                totalCalls: "$llmWorkflow.trace.totalCalls",
              },
            },
            "$$REMOVE",
          ],
        },
        interview: {
          $cond: [
            { $ifNull: ["$interview", false] },
            {
              provider: "$interview.provider",
              status: "$interview.status",
              conversationId: "$interview.conversationId",
              summary: "$interview.summary",
              analysis: "$interview.analysis",
              startedAt: "$interview.startedAt",
              completedAt: "$interview.completedAt",
              updatedAt: "$interview.updatedAt",
              error: "$interview.error",
            },
            "$$REMOVE",
          ],
        },
        behavioralGradingReport: {
          $cond: [
            { $ifNull: ["$behavioralGradingReport", false] },
            {
              setup: "$behavioralGradingReport.setup",
              failureCategory: "$behavioralGradingReport.failureCategory",
              startedAt: "$behavioralGradingReport.startedAt",
              completedAt: "$behavioralGradingReport.completedAt",
              cases: {
                $map: {
                  input: {
                    $ifNull: ["$behavioralGradingReport.cases", []],
                  },
                  as: "c",
                  in: {
                    checkText: "$$c.checkText",
                    checkIndex: "$$c.checkIndex",
                    verdict: "$$c.verdict",
                  },
                },
              },
            },
            "$$REMOVE",
          ],
        },
        evaluationReport: {
          $cond: [
            { $ifNull: ["$evaluationReport", false] },
            {
              session_summary: "$evaluationReport.session_summary",
              criteria_results: {
                $map: {
                  input: {
                    $ifNull: ["$evaluationReport.criteria_results", []],
                  },
                  as: "cr",
                  in: {
                    criterion: "$$cr.criterion",
                    score: "$$cr.score",
                    evaluable: "$$cr.evaluable",
                    confidence: "$$cr.confidence",
                    verdict: "$$cr.verdict",
                    evidence: "$$cr.evidence",
                  },
                },
              },
            },
            "$$REMOVE",
          ],
        },
      },
    },
    {
      $unset: [
        "screenRecordingTranscript",
        "enrichedTranscript",
        "refinedTranscript",
      ],
    },
  ];
}

/**
 * Post-query safety trim for code paths that still load full lean documents.
 */
export function stripSubmissionForListView(
  sub: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...sub };

  delete out.screenRecordingTranscript;
  delete out.enrichedTranscript;
  delete out.refinedTranscript;
  // behavioralGradingProgress is small and needed for live trace while pending.

  const llmWorkflow = out.llmWorkflow;
  if (llmWorkflow && typeof llmWorkflow === "object") {
    const wf = llmWorkflow as Record<string, unknown>;
    const trace =
      wf.trace && typeof wf.trace === "object"
        ? (wf.trace as Record<string, unknown>)
        : undefined;
    out.llmWorkflow = {
      trace: trace
        ? {
            sessionId: trace.sessionId,
            totalTokens: trace.totalTokens,
            totalCost: trace.totalCost,
            totalTime: trace.totalTime,
            totalCalls: trace.totalCalls,
          }
        : undefined,
      scores: wf.scores,
      evaluation: wf.evaluation,
    };
  }

  const interview = out.interview;
  if (interview && typeof interview === "object") {
    const iv = interview as Record<string, unknown>;
    const { transcript: _transcript, ...rest } = iv;
    out.interview = rest;
  }

  const behavioralGradingReport = out.behavioralGradingReport;
  if (
    behavioralGradingReport &&
    typeof behavioralGradingReport === "object"
  ) {
    const report = behavioralGradingReport as Record<string, unknown>;
    const cases = Array.isArray(report.cases)
      ? report.cases.map((raw) => {
          const c = raw as Record<string, unknown>;
          return {
            checkText: c.checkText,
            checkIndex: c.checkIndex,
            verdict: c.verdict,
          };
        })
      : [];
    out.behavioralGradingReport = {
      setup: report.setup,
      failureCategory: report.failureCategory,
      cases,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
    };
  }

  const evaluationReport = out.evaluationReport;
  if (evaluationReport && typeof evaluationReport === "object") {
    const report = evaluationReport as Record<string, unknown>;
    const criteriaResults = Array.isArray(report.criteria_results)
      ? report.criteria_results.map((raw) => {
          const cr = raw as Record<string, unknown>;
          return {
            criterion: cr.criterion,
            score: cr.score,
            evaluable: cr.evaluable,
            confidence: cr.confidence,
            verdict: cr.verdict,
            evidence: cr.evidence,
          };
        })
      : [];
    out.evaluationReport = {
      criteria_results: criteriaResults,
      session_summary: report.session_summary,
    };
  }

  return out;
}

export function stripSubmissionsForListView(
  submissions: Record<string, unknown>[]
): Record<string, unknown>[] {
  return submissions.map(stripSubmissionForListView);
}
