import { APIResult, post, get, patch, del, handleAPIError } from "./requests";
import { auth } from "@/firebase/firebase";
import { API_BASE_URL } from "@/config/api";

export type GenerateShareLinkRequest = {
  assessmentId: string;
  candidateName: string;
  candidateEmail?: string;
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
  status: "pending" | "in-progress" | "submitted" | "expired" | "opted-out";
  startedAt?: string;
  submittedAt?: string;
  timeSpent: number;
  githubLink?: string;
  optedOut?: boolean;
  optOutReason?: string;
  optedOutAt?: string;
  interviewQuestions?: Array<{
    prompt: string;
    anchors?: Array<{
      path: string;
      startLine: number;
      endLine: number;
    }>;
    createdAt: string;
  }>;
  interview?: {
    provider: string;
    status: "not_started" | "in_progress" | "completed" | "failed";
    conversationId?: string;
    transcript: {
      turns: Array<{
        role: "agent" | "candidate";
        text: string;
        startMs?: number;
        endMs?: number;
      }>;
    };
    summary?: string;
    analysis?: any; // Mixed type from provider
    startedAt?: string;
    completedAt?: string;
    updatedAt?: string;
    error?: {
      message?: string;
      at?: string;
      raw?: any;
    };
  };
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

    // Make request without assertOk to handle 403 subscription limit errors
    // Using direct fetch to handle 403 status without throwing
    const response = await fetch(`${API_BASE_URL}/submissions/generate-link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    // Check for subscription limit error (403 status)
    if (
      response.status === 403 &&
      result.error === "SUBSCRIPTION_LIMIT_REACHED"
    ) {
      return {
        success: false,
        error: "SUBSCRIPTION_LIMIT_REACHED",
      };
    }

    // Check for other errors
    if (!response.ok) {
      return {
        success: false,
        error:
          result.error || `Failed to generate share link (${response.status})`,
      };
    }

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

/**
 * Update interview conversationId for a submission
 */
export async function updateInterviewConversationId(
  submissionId: string,
  conversationId: string,
  token?: string
): Promise<APIResult<{ message: string }>> {
  try {
    // Include token in query params if provided (for candidate access)
    const url = token
      ? `/submissions/${submissionId}/interview-conversation-id?token=${token}`
      : `/submissions/${submissionId}/interview-conversation-id`;
    const response = await patch(url, { conversationId });

    const result = await response.json();
    return { success: true, data: result };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Delete a submission (employer endpoint)
 */
export async function deleteSubmission(
  submissionId: string,
  token?: string
): Promise<APIResult<{ message: string }>> {
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

    const response = await del(`/submissions/${submissionId}`, {
      Authorization: `Bearer ${authToken}`,
    });

    const result = await response.json();

    if (response.ok) {
      return { success: true, data: result };
    }

    return {
      success: false,
      error: result.error || "Failed to delete submission",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Opt out of assessment (candidate endpoint)
 */
export async function optOutAssessment(
  token: string,
  reason?: string
): Promise<APIResult<Submission>> {
  try {
    const response = await post(`/submissions/token/${token}/opt-out`, {
      reason,
    });

    const result = await response.json();

    if (result && result._id) {
      return { success: true, data: result as Submission };
    }

    return {
      success: false,
      error: result.error || "Failed to opt out",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

export type BulkGenerateLinksRequest = {
  assessmentId: string;
  candidates: Array<{ name: string; email: string }>;
};

export type BulkGenerateLinksResponse = {
  submissions: Array<{
    submissionId: string;
    token: string;
    shareLink: string;
    candidateName: string;
    candidateEmail: string;
  }>;
};

export type SendInvitesRequest = {
  submissionIds: string[];
};

export type SendInvitesResponse = {
  sent: number;
  failed: number;
  errors?: string[];
};

/**
 * Bulk generate share links for multiple candidates (employer endpoint)
 */
export async function bulkGenerateLinks(
  assessmentId: string,
  candidates: Array<{ name: string; email: string }>
): Promise<APIResult<BulkGenerateLinksResponse>> {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: "No user is currently signed in" };
    }
    const authToken = await user.getIdToken();

    const response = await fetch(
      `${API_BASE_URL}/submissions/bulk-generate-links`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assessmentId, candidates }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error:
          result.error ||
          `Failed to bulk generate links (${response.status})`,
      };
    }

    if (result && Array.isArray(result.submissions)) {
      return { success: true, data: result as BulkGenerateLinksResponse };
    }

    return {
      success: false,
      error: result.error || "Failed to bulk generate links",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Send invite emails to candidates by submission IDs (employer endpoint)
 */
export async function sendInvites(
  submissionIds: string[]
): Promise<APIResult<SendInvitesResponse>> {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: "No user is currently signed in" };
    }
    const authToken = await user.getIdToken();

    const response = await fetch(`${API_BASE_URL}/submissions/send-invites`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ submissionIds }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: result.error || `Failed to send invites (${response.status})`,
      };
    }

    if (result && typeof result.sent === "number") {
      return { success: true, data: result as SendInvitesResponse };
    }

    return {
      success: false,
      error: result.error || "Failed to send invites",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Upload LLM trace file (candidate endpoint)
 */
export async function uploadLLMTrace(
  token: string,
  file: File
): Promise<APIResult<{ sessionId: string; eventsProcessed: number }>> {
  try {
    const formData = new FormData();
    formData.append("llmTrace", file);

    const response = await fetch(`${API_BASE_URL}/submissions/token/${token}/upload-trace`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    if (result.sessionId) {
      return { success: true, data: result };
    }

    return {
      success: false,
      error: result.error || "Failed to upload trace",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}
