import { APIResult, get, post, patch, del, handleAPIError } from "./requests";
import { auth } from "@/firebase/firebase";

export type Assessment = {
  _id: string;
  userId: string;
  title: string;
  description: string;
  timeLimit: number;
  scoring?: Record<string, number>; // Key-value pair: category -> percent weight
  createdAt: string;
  updatedAt: string;
};

export type AssessmentCreate = {
  title: string;
  description: string;
  timeLimit: number;
  scoring?: Record<string, number>; // Key-value pair: category -> percent weight
};

export type AssessmentUpdate = {
  title?: string;
  description?: string;
  timeLimit?: number;
  scoring?: Record<string, number>; // Key-value pair: category -> percent weight
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
      scoring?: Record<string, number>;
    } = {
      title: data.title,
      description: data.description,
      timeLimit: data.timeLimit,
    };

    if (data.scoring) {
      requestBody.scoring = data.scoring;
    }

    const response = await post("/assessments", requestBody, {
      Authorization: `Bearer ${authToken}`,
    });

    const result = await response.json();

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
      scoring?: Record<string, number>;
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
    if (data.scoring !== undefined) {
      updateBody.scoring = data.scoring;
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
 * Calls the backend to generate title, timeLimit, and scoring based on description
 */
export async function generateAssessmentData(
  jobDescription: string,
  token?: string
): Promise<
  APIResult<{
    title: string;
    description: string;
    timeLimit: number;
    scoring: Record<string, number>;
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

    const response = await post(
      "/assessments/generate",
      { description: jobDescription },
      {
        Authorization: `Bearer ${authToken}`,
      }
    );

    console.log(
      "📥 [generateAssessmentData] Response status:",
      response.status
    );

    const result = await response.json();
    console.log("📦 [generateAssessmentData] Response data:", {
      hasTitle: !!result.title,
      hasDescription: !!result.description,
      descriptionLength: result.description?.length,
      hasTimeLimit: !!result.timeLimit,
      hasScoring: !!result.scoring,
      scoringKeys: result.scoring ? Object.keys(result.scoring) : [],
      fullResult: result,
    });

    // Backend returns generated data directly
    if (
      result &&
      result.title &&
      result.description &&
      result.timeLimit &&
      result.scoring
    ) {
      console.log("✅ [generateAssessmentData] Successfully generated:", {
        title: result.title,
        descriptionLength: result.description.length,
        timeLimit: result.timeLimit,
        scoringKeys: Object.keys(result.scoring),
      });
      return { success: true, data: result };
    }

    console.error(
      "❌ [generateAssessmentData] Invalid response format - missing fields:",
      {
        hasTitle: !!result.title,
        hasDescription: !!result.description,
        hasTimeLimit: !!result.timeLimit,
        hasScoring: !!result.scoring,
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
  rubric?: Array<{ criteria: string; weight: string }>;
  testCases?: Array<{ name: string; type: string; points: number }>;
};

export type ChatResponse = {
  updates: {
    description?: string;
    title?: string;
    timeLimit?: number;
    scoring?: Record<string, number>;
    rubric?: Array<{ criteria: string; weight: string }>;
    testCases?: Array<{ name: string; type: string; points: number }>;
  };
  changedSections: string[];
  changesSummary: string[];
  responseMessage: string;
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
