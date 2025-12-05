import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import { auth } from "./firebase.js";
import { API_ENDPOINTS } from "@/config/api.js";
import {
  authenticatedPost,
  authenticatedGet,
  authenticatedPatch,
} from "@/utils/apiClient.js";

/**
 * Sign up a new user with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<UserCredential>} Firebase user credential
 */
export const signUp = async (email, password) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    return userCredential;
  } catch (error) {
    throw error;
  }
};

/**
 * Sign in an existing user with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<UserCredential>} Firebase user credential
 */
export const signIn = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    return userCredential;
  } catch (error) {
    throw error;
  }
};

/**
 * Sign out the current user
 * @returns {Promise<void>}
 */
export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    throw error;
  }
};

/**
 * Get the current user's ID token
 * @returns {Promise<string>} Firebase ID token
 */
export const getIdToken = async () => {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error("No user is currently signed in");
    }
    return await user.getIdToken();
  } catch (error) {
    throw error;
  }
};

/**
 * Get the current authenticated user
 * @returns {User|null} Firebase user object or null
 */
export const getCurrentUser = () => {
  return auth.currentUser;
};

/**
 * Listen to authentication state changes
 * @param {Function} callback - Callback function that receives the user
 * @returns {Function} Unsubscribe function
 */
export const onAuthStateChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};

/**
 * Update user profile
 * @param {Object} profileData - Profile data { displayName?, photoURL? }
 * @returns {Promise<void>}
 */
export const updateUserProfile = async (profileData) => {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error("No user is currently signed in");
    }
    await updateProfile(user, profileData);
  } catch (error) {
    throw error;
  }
};

/**
 * Create user in backend database after Firebase signup
 * @param {Object} userData - User data { name, companyLogoUrl? }
 * @returns {Promise<Object>} Created user from backend
 */
export const createUserInBackend = async (userData) => {
  try {
    const response = await authenticatedPost(
      API_ENDPOINTS.USER_AUTH.CREATE,
      userData
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to create user in backend");
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error("Backend user creation error:", error);
    throw error;
  }
};

/**
 * Login/Create user in backend database
 * This verifies the Firebase token and creates/returns user in MongoDB
 * @param {Object} additionalData - Optional { name?, companyLogoUrl? }
 * @returns {Promise<Object>} User from backend
 */
export const loginUserInBackend = async (additionalData = {}) => {
  try {
    const token = await getIdToken();

    const response = await fetch(API_ENDPOINTS.USER_AUTH.LOGIN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        ...additionalData,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to login user in backend");
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error("Backend user login error:", error);
    throw error;
  }
};

/**
 * Get current user from backend database
 * @returns {Promise<Object>} User from backend
 */
export const getCurrentUserFromBackend = async () => {
  try {
    const response = await authenticatedGet(API_ENDPOINTS.USER_AUTH.ME);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to get user from backend");
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error("Backend get user error:", error);
    throw error;
  }
};

/**
 * Update current user in backend database
 * @param {Object} updateData - Fields to update { name?, email?, companyLogoUrl? }
 * @returns {Promise<Object>} Updated user from backend
 */
export const updateUserInBackend = async (updateData) => {
  try {
    const response = await authenticatedPatch(
      API_ENDPOINTS.USER_AUTH.UPDATE_ME,
      updateData
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to update user in backend");
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error("Backend user update error:", error);
    throw error;
  }
};
