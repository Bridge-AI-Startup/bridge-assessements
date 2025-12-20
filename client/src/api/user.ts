import { APIResult, get, post, patch, handleAPIError } from "./requests";
import { auth } from "@/firebase/firebase";

export type User = {
  id: string;
  email: string;
  companyName: string;
  companyLogoUrl: string;
  privileged?: boolean;
};

export type UserCreate = {
  _id: string;
  name: string;
  companyName: string;
  companyLogoUrl: string;
  email: string;
};

export async function verifyUser(token: string): Promise<APIResult<User>> {
  try {
    console.log("🔍 [verifyUser] Calling /api/users/whoami with token");
    const response = await get("/users/whoami", {
      Authorization: `Bearer ${token}`,
    });
    console.log("🔍 [verifyUser] Response status:", response.status);
    console.log("🔍 [verifyUser] Response ok:", response.ok);
    const data = (await response.json()) as User;
    console.log("🔍 [verifyUser] Response data:", data);
    return { success: true, data };
  } catch (error) {
    console.error("❌ [verifyUser] Error:", error);
    let errorMessage = "Authentication failed. Please try again.";

    if (error instanceof Error) {
      console.error("❌ [verifyUser] Error message:", error.message);
      errorMessage = error.message;

      // Try to extract a more user-friendly message from the error
      if (
        errorMessage.includes("401") ||
        errorMessage.includes("INVALID_AUTH_TOKEN")
      ) {
        errorMessage = "User not found in database. Please sign up first.";
      } else if (errorMessage.includes("Token was invalid")) {
        errorMessage =
          "Invalid authentication token. Please try signing in again.";
      }
    }

    return { success: false, error: errorMessage };
  }
}

export async function createUser({
  companyName,
  companyLogoUrl,
  token,
}: {
  companyName: string;
  companyLogoUrl?: string | null;
  token?: string;
}): Promise<APIResult<UserCreate>> {
  try {
    // Get token if not provided
    let authToken = token;
    if (!authToken) {
      const user = auth.currentUser;
      if (!user) {
        return { success: false, error: "No user is currently signed in" };
      }
      authToken = await user.getIdToken();
    }

    const response = await post(
      "/users/create",
      {
        companyName,
        companyLogoUrl: companyLogoUrl || null,
      },
      {
        Authorization: `Bearer ${authToken}`,
      }
    );

    const result = await response.json();

    // Backend returns user object directly (not wrapped in { success, data })
    // Check if it's a user object (has _id or firebaseUid)
    if (result && (result._id || result.firebaseUid || result.id)) {
      return { success: true, data: result as UserCreate };
    }

    // If it's wrapped in success/data format, handle that too
    if (result.success && result.data) {
      return { success: true, data: result.data };
    }

    return { success: false, error: result.error || "Failed to create user" };
  } catch (error) {
    return handleAPIError(error);
  }
}
