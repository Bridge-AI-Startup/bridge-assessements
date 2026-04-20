import mongoose from "mongoose";

const AssessmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "" },
    timeLimit: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

export default mongoose.model("Assessment", AssessmentSchema);
