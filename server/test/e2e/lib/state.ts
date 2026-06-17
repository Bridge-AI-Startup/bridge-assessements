/**
 * Mutable state shared across the P1..P7 processes. Earlier processes populate
 * it (recruiter token, assessment id, candidate token, session id) so later
 * processes can build on real artifacts created upstream.
 */

import type { ApiClient } from "./apiClient.js";
import type { Recommendation } from "./types.js";

export interface RecruiterState {
  email: string;
  password: string;
  idToken: string;
  uid: string;
  userId?: string;
  companyName: string;
}

export interface CandidateState {
  token: string;
  submissionId: string;
  shareLink: string;
  sessionId?: string;
}

export interface SuiteState {
  api: ApiClient; // unauthenticated client
  recruiter?: RecruiterState;
  assessmentId?: string;
  candidate?: CandidateState;
  /** Dedicated throwaway submission/session for the real-video pipeline test. */
  videoCandidate?: CandidateState;
  fixes: Recommendation[];
  screenshots: Array<{ process: string; label: string; path: string }>;
}

export function authedApi(state: SuiteState): ApiClient {
  if (!state.recruiter) throw new Error("recruiter not authenticated yet");
  return state.api.withToken(state.recruiter.idToken);
}
