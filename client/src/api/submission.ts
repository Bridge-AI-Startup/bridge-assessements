import { APIResult, post, get, handleAPIError } from "./requests";
import { auth } from "@/firebase/firebase";

export type GenerateShareLinkRequest = {
  assessmentId: string;
  candidateName: string;
};

export type GenerateShareLinkResponse = {
  token: string;
  shareLink: string;
  submissionId: string;
  candidateName: string;
};

export type Submission = {
  _id: string;
  token: string;
  assessmentId:
    | string
    | {
        _id: string;
        title: string;
        description: string;
        timeLimit: number;
      };
  candidateName?: string;
  candidateEmail?: string;
  status: "pending" | "in-progress" | "submitted" | "expired";
  startedAt?: string;
  submittedAt?: string;
  timeSpent: number;
  githubLink?: string;
  timeRemaining?: number | null; // Minutes remaining (calculated server-side)
  createdAt: string;
  updatedAt: string;
};

/**
 * Generate a share link for a candidate (employer endpoint)
 */
export async function generateShareLink(
  data: GenerateShareLinkRequest,
  token?: string
): Promise<APIResult<GenerateShareLinkResponse>> {
  try {
    // Get Firebase ID token - use provided token or get from current user
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await post("/submissions/generate-link", data, {
      Authorization: `Bearer ${authToken}`,
    });

    const result = await response.json();

    // Backend returns the response directly
    if (result && result.token && result.shareLink) {
      return { success: true, data: result as GenerateShareLinkResponse };
    }

    return {
      success: false,
      error: result.error || "Failed to generate share link",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Get submission by token (candidate endpoint)
 */
export async function getSubmissionByToken(
  token: string
): Promise<APIResult<Submission>> {
  try {
    const response = await get(`/submissions/token/${token}`);

    const result = await response.json();

    if (result && result._id) {
      return { success: true, data: result as Submission };
    }

    return {
      success: false,
      error: result.error || "Failed to load submission",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Start assessment (update status to "in-progress")
 */
export async function startAssessment(
  token: string
): Promise<APIResult<Submission>> {
  try {
    const response = await post(`/submissions/token/${token}/start`, {});

    const result = await response.json();

    if (result && result._id) {
      return { success: true, data: result as Submission };
    }

    return {
      success: false,
      error: result.error || "Failed to start assessment",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Submit assessment (candidate endpoint)
 */
export async function submitAssessment(
  token: string,
  githubLink: string
): Promise<APIResult<Submission>> {
  try {
    const response = await post(`/submissions/token/${token}/submit`, {
      githubLink,
    });

    const result = await response.json();

    if (result && result._id) {
      return { success: true, data: result as Submission };
    }

    return {
      success: false,
      error: result.error || "Failed to submit assessment",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Get all submissions for an assessment (employer endpoint)
 */
export async function getSubmissionsForAssessment(
  assessmentId: string,
  token?: string
): Promise<APIResult<Submission[]>> {
  try {
    // Get Firebase ID token - use provided token or get from current user
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await get(
      `/submissions/assessments/${assessmentId}/submissions`,
      {
        Authorization: `Bearer ${authToken}`,
      }
    );

    const result = await response.json();

    if (Array.isArray(result)) {
      return { success: true, data: result as Submission[] };
    }

    return {
      success: false,
      error: result.error || "Failed to load submissions",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

export type GenerateInterviewResponse = {
  questions: string[];
  submissionId: string;
  candidateName?: string;
};

/**
 * Generate interview questions for a submission by token (candidate endpoint)
 */
export async function generateInterviewQuestionsByToken(
  submissionToken: string
): Promise<APIResult<GenerateInterviewResponse>> {
  try {
    const response = await post(
      `/submissions/token/${submissionToken}/generate-interview`,
      {}
    );

    const result = await response.json();

    if (result && result.questions && Array.isArray(result.questions)) {
      return { success: true, data: result as GenerateInterviewResponse };
    }

    return {
      success: false,
      error: result.error || "Failed to generate interview questions",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Generate interview questions for a submission (employer endpoint)
 */
export async function generateInterviewQuestions(
  submissionId: string,
  token?: string
): Promise<APIResult<GenerateInterviewResponse>> {
  try {
    // Get Firebase ID token - use provided token or get from current user
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await post(
      `/submissions/${submissionId}/generate-interview`,
      {},
      {
        Authorization: `Bearer ${authToken}`,
      }
    );

    const result = await response.json();

    if (result && result.questions && Array.isArray(result.questions)) {
      return { success: true, data: result as GenerateInterviewResponse };
    }

    return {
      success: false,
      error: result.error || "Failed to generate interview questions",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}
