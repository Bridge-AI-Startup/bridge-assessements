// server/models/User.js
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    // Firebase Auth UID
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // User's name from onboarding or Firebase
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Email from Firebase Auth
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // Optional logo field
    companyLogoUrl: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

const User = mongoose.model("User", UserSchema);
export default User;
