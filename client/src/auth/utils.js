/**
 * Get user-friendly error messages from Firebase auth errors
 * @param {Error} error - Firebase error object
 * @returns {string} User-friendly error message
 */
export const getAuthErrorMessage = (error) => {
  const errorCode = error.code || error.message;

  switch (errorCode) {
    case "auth/email-already-in-use":
      return "This email is already registered. Please sign in instead.";
    case "auth/invalid-email":
      return "Invalid email address. Please check and try again.";
    case "auth/operation-not-allowed":
      return "Email/password accounts are not enabled. Please contact support.";
    case "auth/weak-password":
      return "Password is too weak. Please use at least 6 characters.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";
    case "auth/user-not-found":
      return "No account found with this email. Please sign up first.";
    case "auth/wrong-password":
      return "Incorrect password. Please try again.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Please check your connection and try again.";
    case "auth/invalid-credential":
      return "Invalid email or password. Please try again.";
    default:
      return error.message || "An error occurred. Please try again.";
  }
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} { isValid: boolean, message: string }
 */
export const validatePassword = (password) => {
  if (!password) {
    return { isValid: false, message: "Password is required" };
  }

  if (password.length < 6) {
    return {
      isValid: false,
      message: "Password must be at least 6 characters long",
    };
  }

  return { isValid: true, message: "" };
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if email is valid
 */
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

