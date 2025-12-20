// server/models/user.ts
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

    // Company name from onboarding
    companyName: {
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

const UserModel = mongoose.model("User", UserSchema);
export default UserModel;
