import { APIResult, handleAPIError } from "./requests";
import { auth } from "@/firebase/firebase";
import { API_BASE_URL } from "@/config/api";

/**
 * Run screen recording evaluation for a submission (employer, auth required).
 * Loads transcript from submission or proctoring, runs criteria evaluation, persists report.
 */
export async function runSubmissionEvaluation(
  submissionId: string,
  token?: string
): Promise<
  APIResult<{ report: { session_summary: string; criteria_results: unknown[] } }>
> {
  try {
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await fetch(`${API_BASE_URL}/evaluate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ submissionId }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: result.error || `Evaluation failed (${response.status})`,
      };
    }

    if (result && result.report) {
      return { success: true, data: result };
    }

    return {
      success: false,
      error: result.error || "Invalid response from evaluation",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Suggest evaluation criteria from a job description (employer, auth required)
 */
export async function suggestCriteria(
  jobDescription: string,
  token?: string
): Promise<APIResult<{ suggested_criteria: string[] }>> {
  try {
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await fetch(`${API_BASE_URL}/suggest-criteria`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job_description: jobDescription }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: result.error || `Failed to suggest criteria (${response.status})`,
      };
    }

    if (result && Array.isArray(result.suggested_criteria)) {
      return { success: true, data: result };
    }

    return {
      success: false,
      error: result.error || "Invalid response from suggest criteria",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Validate a single criterion (employer, auth required)
 * Returns { valid: boolean, reason?: string }
 */
export async function validateCriterion(
  criterion: string,
  token?: string
): Promise<APIResult<{ valid: boolean; reason?: string }>> {
  try {
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await fetch(`${API_BASE_URL}/validate-criterion`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ criterion }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: result.error || `Failed to validate criterion (${response.status})`,
      };
    }

    if (typeof result.valid === "boolean") {
      return { success: true, data: result };
    }

    return {
      success: false,
      error: result.error || "Invalid response from validate criterion",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}
