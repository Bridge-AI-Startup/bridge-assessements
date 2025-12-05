import User from "../models/User.js";
import { auth } from "../config/firebaseAdmin.js";

/**
 * Create a new user in the database
 * This is called after Firebase authentication succeeds
 * @param {Object} userData - User data { firebaseUid, email, name, companyLogoUrl? }
 * @returns {Promise<Object>} Created user
 */
export const createUser = async (userData) => {
  const { firebaseUid, email, name, companyLogoUrl } = userData;

  // Validation
  if (!firebaseUid || !email || !name) {
    throw new Error("firebaseUid, email, and name are required");
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error("Invalid email format");
  }

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ firebaseUid }, { email: email.toLowerCase() }],
  });

  if (existingUser) {
    throw new Error("User with this Firebase UID or email already exists");
  }

  // Create new user
  const newUser = new User({
    firebaseUid,
    email: email.toLowerCase().trim(),
    name: name.trim(),
    companyLogoUrl: companyLogoUrl || null,
  });

  const savedUser = await newUser.save();
  return savedUser.toObject();
};

/**
 * Login/Create user - Verifies Firebase token and creates/returns user
 * This handles both login and signup scenarios
 * @param {string} firebaseToken - Firebase ID token
 * @param {Object} additionalData - Optional additional user data { name?, companyLogoUrl? }
 * @returns {Promise<Object>} User object from database
 */
export const loginUser = async (firebaseToken, additionalData = {}) => {
  try {
    // Verify Firebase token
    const decodedToken = await auth.verifyIdToken(firebaseToken);

    const { uid, email, email_verified, name: firebaseName } = decodedToken;

    // Check if user exists in database
    let user = await User.findOne({
      $or: [{ firebaseUid: uid }, { email: email.toLowerCase() }],
    });

    if (user) {
      // User exists - update firebaseUid if it was missing
      if (!user.firebaseUid) {
        user.firebaseUid = uid;
        await user.save();
      }

      // Update additional data if provided
      const updates = {};
      if (additionalData.name) updates.name = additionalData.name;
      if (additionalData.companyLogoUrl !== undefined)
        updates.companyLogoUrl = additionalData.companyLogoUrl;

      if (Object.keys(updates).length > 0) {
        Object.assign(user, updates);
        await user.save();
      }

      return user.toObject();
    } else {
      // User doesn't exist - create new user
      const newUser = new User({
        firebaseUid: uid,
        email: email.toLowerCase(),
        name: additionalData.name || firebaseName || email.split("@")[0],
        companyLogoUrl: additionalData.companyLogoUrl || null,
      });

      const savedUser = await newUser.save();
      return savedUser.toObject();
    }
  } catch (error) {
    if (error.code === "auth/id-token-expired") {
      throw new Error("Token expired. Please sign in again.");
    }
    if (error.code === "auth/argument-error") {
      throw new Error("Invalid token.");
    }
    throw error;
  }
};

/**
 * Get user by Firebase UID
 * @param {string} firebaseUid - Firebase user UID
 * @returns {Promise<Object|null>} User object or null
 */
export const getUserByFirebaseUid = async (firebaseUid) => {
  const user = await User.findOne({ firebaseUid });
  return user ? user.toObject() : null;
};

/**
 * Get user by email
 * @param {string} email - User email
 * @returns {Promise<Object|null>} User object or null
 */
export const getUserByEmail = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  return user ? user.toObject() : null;
};

/**
 * Update user by Firebase UID
 * @param {string} firebaseUid - Firebase user UID
 * @param {Object} updateData - Fields to update
 * @returns {Promise<Object|null>} Updated user or null
 */
export const updateUserByFirebaseUid = async (firebaseUid, updateData) => {
  const user = await User.findOne({ firebaseUid });

  if (!user) {
    return null;
  }

  // Update fields
  if (updateData.name !== undefined) user.name = updateData.name.trim();
  if (updateData.email !== undefined) {
    // Validate email if being updated
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(updateData.email)) {
      throw new Error("Invalid email format");
    }
    // Check if email is already in use by another user
    const existingUser = await User.findOne({
      email: updateData.email.toLowerCase(),
      firebaseUid: { $ne: firebaseUid },
    });
    if (existingUser) {
      throw new Error("Email is already in use by another user");
    }
    user.email = updateData.email.toLowerCase();
  }
  if (updateData.companyLogoUrl !== undefined)
    user.companyLogoUrl = updateData.companyLogoUrl;

  await user.save();
  return user.toObject();
};

