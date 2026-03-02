// The action types a candidate can perform during a screen recording session
export type ActionType = "ai_prompt" | "ai_response" | "coding" | "testing" | "reading" | "searching" | "idle"

// A single event from the Stage 1 VLM transcript
export type TranscriptEvent = {
  ts: number                          // start timestamp in seconds
  ts_end: number                      // end timestamp in seconds
  action_type: ActionType
  ai_tool: "cursor" | "claude" | "chatgpt" | "copilot" | null
  prompt_text: string | null          // visible prompt text if candidate typed into AI
  search_query: string | null         // visible search query if they searched
  description: string                 // full text description of what's on screen
}

// Output of the grounder — converts a vague criterion into observable behaviors
export type GroundedCriterion = {
  original: string                    // the raw criterion text
  definition: string                  // clarified definition of what the criterion means
  positive_indicators: string[]       // observable behaviors that support a high score
  negative_indicators: string[]       // observable behaviors that support a low score
  relevant_action_types: ActionType[] // which action_types in the transcript are most relevant
}

// A single piece of timestamped evidence supporting a verdict
export type EvidenceItem = {
  ts: number
  ts_end: number
  observation: string                 // what was observed at this timestamp
}

// The result for a single evaluated criterion
export type CriterionResult = {
  criterion: string                   // original criterion text
  score: number                       // 1-10
  confidence: "high" | "medium" | "low"
  verdict: string                     // one paragraph human-readable summary
  evidence: EvidenceItem[]            // specific timestamped moments supporting the verdict
  /** When false, this criterion was not evaluable from the transcript (e.g. subjective or unobservable). Exclude from any aggregate score so it does not penalise the applicant. */
  evaluable: boolean
}

/** Full evaluation report. For an overall score, use averageScoreOverEvaluableCriteria(criteria_results) so non-evaluable criteria do not penalise the applicant. */
export type EvaluationReport = {
  criteria_results: CriterionResult[]
  session_summary: string
}

/**
 * Average score (1–10) over criteria where evaluable is true. Use this (or
 * equivalent logic) when showing an overall score so non-evaluable criteria
 * do not penalise the applicant. Returns null if no evaluable criteria.
 */
export function averageScoreOverEvaluableCriteria(
  results: CriterionResult[]
): number | null {
  const evaluable = results.filter((r) => r.evaluable);
  if (evaluable.length === 0) return null;
  const sum = evaluable.reduce((s, r) => s + r.score, 0);
  return Math.round((sum / evaluable.length) * 10) / 10;
}

// Validation result for a criterion
export type ValidationResult = {
  valid: boolean
  reason?: string                     // if invalid, explanation of why and how to reformulate
}
