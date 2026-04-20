import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    companyName: { type: String, default: "", trim: true },
    /** Opaque bearer token for employer API (mini app — replace with Firebase in production). */
    apiToken: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true },
);

export type UserDoc = mongoose.InferSchemaType<typeof UserSchema>;
export default mongoose.model("User", UserSchema);
