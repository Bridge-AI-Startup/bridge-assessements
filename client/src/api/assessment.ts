import { APIResult, get, post, patch, del, handleAPIError } from "./requests";
import { auth } from "@/firebase/firebase";
import { API_BASE_URL } from "@/config/api";

export type Assessment = {
  _id: string;
  userId: string;
  title: string;
  description: string;
  timeLimit: number;
  numInterviewQuestions?: number;
  starterFilesGitHubLink?: string;
  interviewerCustomInstructions?: string;
  isSmartInterviewerEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssessmentCreate = {
  title: string;
  description: string;
  timeLimit: number;
  numInterviewQuestions?: number;
  starterFilesGitHubLink?: string;
  interviewerCustomInstructions?: string;
};

export type AssessmentUpdate = {
  title?: string;
  description?: string;
  timeLimit?: number;
  numInterviewQuestions?: number;
  starterFilesGitHubLink?: string;
  interviewerCustomInstructions?: string;
  isSmartInterviewerEnabled?: boolean;
};

/**
 * Create a new assessment
 */
export async function createAssessment(
  data: AssessmentCreate,
  token?: string
): Promise<APIResult<Assessment>> {
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

    const requestBody: {
      title: string;
      description: string;
      timeLimit: number;
    } = {
      title: data.title,
      description: data.description,
      timeLimit: data.timeLimit,
    };

    // Make request without assertOk to handle 403 subscription limit errors
    const response = await fetch(`${API_BASE_URL}/assessments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
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
          result.error || `Failed to create assessment (${response.status})`,
      };
    }

    // Backend returns assessment object directly (not wrapped in { success, data })
    // Check if it's an assessment object (has _id)
    if (result && result._id) {
      return { success: true, data: result as Assessment };
    }

    // If it's wrapped in success/data format, handle that too
    if (result.success && result.data) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      error: result.error || "Failed to create assessment",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Get all assessments for the current user
 */
export async function getAssessments(): Promise<APIResult<Assessment[]>> {
  try {
    // Get Firebase ID token
    const user = auth.currentUser;
    if (!user) {
      console.error("❌ [getAssessments] No user is currently signed in");
      return { success: false, error: "No user is currently signed in" };
    }

    console.log("🔄 [getAssessments] Getting ID token for user:", user.email);
    const token = await user.getIdToken();
    console.log(
      "✅ [getAssessments] Got token, making request to /assessments"
    );

    const response = await get("/assessments", {
      Authorization: `Bearer ${token}`,
    });

    console.log("📦 [getAssessments] Response status:", response.status);
    const data = (await response.json()) as Assessment[];
    console.log("📦 [getAssessments] Response data:", data);
    console.log(
      "📦 [getAssessments] Data type:",
      Array.isArray(data) ? "array" : typeof data
    );
    console.log(
      "📦 [getAssessments] Data length:",
      Array.isArray(data) ? data.length : "not an array"
    );

    return { success: true, data: Array.isArray(data) ? data : [] };
  } catch (error) {
    console.error("❌ [getAssessments] Error:", error);
    return handleAPIError(error);
  }
}

/**
 * Get a single assessment by ID
 */
export async function getAssessment(
  id: string,
  token?: string
): Promise<APIResult<Assessment>> {
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

    const response = await get(`/assessments/${id}`, {
      Authorization: `Bearer ${authToken}`,
    });

    const data = (await response.json()) as Assessment;
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Update an assessment
 */
export async function updateAssessment(
  id: string,
  data: AssessmentUpdate,
  token?: string
): Promise<APIResult<Assessment>> {
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

    const updateBody: {
      title?: string;
      description?: string;
      timeLimit?: number;
      numInterviewQuestions?: number;
      starterFilesGitHubLink?: string;
      interviewerCustomInstructions?: string;
      isSmartInterviewerEnabled?: boolean;
    } = {};

    if (data.title !== undefined) {
      updateBody.title = data.title;
    }
    if (data.description !== undefined) {
      updateBody.description = data.description;
    }
    if (data.timeLimit !== undefined) {
      updateBody.timeLimit = data.timeLimit;
    }
    if (data.numInterviewQuestions !== undefined) {
      updateBody.numInterviewQuestions = data.numInterviewQuestions;
    }
    if (data.starterFilesGitHubLink !== undefined) {
      updateBody.starterFilesGitHubLink = data.starterFilesGitHubLink;
    }
    if (data.interviewerCustomInstructions !== undefined) {
      updateBody.interviewerCustomInstructions =
        data.interviewerCustomInstructions;
    }
    if (data.isSmartInterviewerEnabled !== undefined) {
      updateBody.isSmartInterviewerEnabled = data.isSmartInterviewerEnabled;
    }

    const response = await patch(`/assessments/${id}`, updateBody, {
      Authorization: `Bearer ${authToken}`,
    });

    const result = await response.json();

    // Backend returns assessment object directly
    if (result && result._id) {
      return { success: true, data: result as Assessment };
    }

    // If it's wrapped in success/data format, handle that too
    if (result.success && result.data) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      error: result.error || "Failed to update assessment",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Delete an assessment
 */
export async function deleteAssessment(
  id: string
): Promise<APIResult<{ message: string }>> {
  try {
    // Get Firebase ID token
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: "No user is currently signed in" };
    }
    const token = await user.getIdToken();

    const response = await del(`/assessments/${id}`, {
      Authorization: `Bearer ${token}`,
    });

    const result = await response.json();

    // Backend returns { message: "..." } or wrapped format
    if (result && result.message) {
      return { success: true, data: result };
    }

    if (result.success && result.data) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      error: result.error || "Failed to delete assessment",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

/**
 * Generate assessment data from description
 * Calls the backend to generate title and timeLimit based on description
 */
export async function generateAssessmentData(
  jobDescription: string,
  token?: string
): Promise<
  APIResult<{
    title: string;
    description: string;
    timeLimit: number;
  }>
> {
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

    console.log(
      "📤 [generateAssessmentData] Calling backend to generate assessment data"
    );
    console.log(
      "   Job description length:",
      jobDescription.length,
      "characters"
    );

    // Use fetch directly to handle 403 errors without throwing
    const response = await fetch(`${API_BASE_URL}/assessments/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: jobDescription }),
    });

    console.log(
      "📥 [generateAssessmentData] Response status:",
      response.status
    );

    let result;
    try {
      result = await response.json();
    } catch (jsonError) {
      // If JSON parsing fails, check if it's a 403
      if (response.status === 403) {
        return {
          success: false,
          error: "SUBSCRIPTION_LIMIT_REACHED",
        };
      }
      throw jsonError;
    }

    // Check for subscription limit error (403 status) - MUST be checked before other error handling
    if (response.status === 403) {
      console.log("🔍 [generateAssessmentData] 403 response detected:", result);
      // Check multiple possible error formats
      if (
        result?.error === "SUBSCRIPTION_LIMIT_REACHED" ||
        result?.message?.includes("free tier limit") ||
        result?.message?.includes("limit") ||
        JSON.stringify(result || {}).includes("SUBSCRIPTION_LIMIT_REACHED")
      ) {
        console.log(
          "✅ [generateAssessmentData] Detected subscription limit error, returning early"
        );
        return {
          success: false,
          error: "SUBSCRIPTION_LIMIT_REACHED",
        };
      }
      // If it's a 403 but we can't parse it, still return subscription limit error
      console.warn(
        "⚠️ [generateAssessmentData] 403 response but couldn't parse error format, assuming subscription limit"
      );
      return {
        success: false,
        error: "SUBSCRIPTION_LIMIT_REACHED",
      };
    }

    console.log("📦 [generateAssessmentData] Response data:", {
      hasTitle: !!result.title,
      hasDescription: !!result.description,
      descriptionLength: result.description?.length,
      hasTimeLimit: !!result.timeLimit,
      fullResult: result,
    });

    // Check for other errors (but 403 should have been handled above)
    if (!response.ok) {
      // Double-check for subscription limit in case we missed it
      if (response.status === 403) {
        return {
          success: false,
          error: "SUBSCRIPTION_LIMIT_REACHED",
        };
      }
      return {
        success: false,
        error:
          result?.error ||
          result?.message ||
          `Failed to generate assessment data (${response.status})`,
      };
    }

    // Backend returns generated data directly
    if (result && result.title && result.description && result.timeLimit) {
      console.log("✅ [generateAssessmentData] Successfully generated:", {
        title: result.title,
        descriptionLength: result.description.length,
        timeLimit: result.timeLimit,
      });
      return { success: true, data: result };
    }

    console.error(
      "❌ [generateAssessmentData] Invalid response format - missing fields:",
      {
        hasTitle: !!result.title,
        hasDescription: !!result.description,
        hasTimeLimit: !!result.timeLimit,
        result,
      }
    );
    return {
      success: false,
      error:
        result.error ||
        "Failed to generate assessment data - missing required fields",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}

export type ChatRequest = {
  message: string;
  allowedSections?: string[];
  testCases?: Array<{ name: string; type: string; points: number }>;
};

export type ChatResponse = {
  updates: {
    description?: string;
    title?: string;
    timeLimit?: number;
    testCases?: Array<{ name: string; type: string; points: number }>;
  };
  changedSections: string[];
  changesSummary: string[];
  responseMessage: string;
  model?: string;
  provider?: string;
  assessment?: Assessment;
};

/**
 * Chat with assessment to modify it through natural language
 */
export async function chatWithAssessment(
  assessmentId: string,
  data: ChatRequest,
  token?: string
): Promise<APIResult<ChatResponse>> {
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

    console.log("💬 [chatWithAssessment] Sending chat message:", {
      assessmentId,
      message: data.message.substring(0, 50) + "...",
    });

    const response = await post(`/assessments/${assessmentId}/chat`, data, {
      Authorization: `Bearer ${authToken}`,
    });

    console.log("📥 [chatWithAssessment] Response status:", response.status);

    const result = await response.json();

    if (result && result.updates && result.changedSections) {
      console.log("✅ [chatWithAssessment] Chat successful:", {
        changedSections: result.changedSections,
        responseMessage: result.responseMessage,
      });
      return { success: true, data: result };
    }

    console.error("❌ [chatWithAssessment] Invalid response format:", result);
    return {
      success: false,
      error: result.error || "Failed to process chat message",
    };
  } catch (error) {
    return handleAPIError(error);
  }
}
