import mongoose from "mongoose";

const TaskConfigSchema = new mongoose.Schema(
  {
    taskId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    taskName: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    // Task files (stored as base64 or file paths)
    files: [
      {
        path: String,
        content: String, // Base64 encoded or file path
        isHidden: { type: Boolean, default: false }, // Hidden test files
      },
    ],
    // Test configuration
    tests: {
      command: String, // e.g., "npm test" or "pytest"
      timeout: { type: Number, default: 30000 }, // milliseconds
      hiddenTests: [
        {
          name: String,
          test: String, // Test code/content
        },
      ],
    },
    // Scoring weights
    weights: {
      correctness: { type: Number, default: 40 },
      efficiency: { type: Number, default: 20 },
      promptQuality: { type: Number, default: 15 },
      structure: { type: Number, default: 20 },
      reliability: { type: Number, default: 5 },
    },
    // Task metadata
    language: String, // "python", "javascript", etc.
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    estimatedTime: Number, // minutes
  },
  { timestamps: true }
);

export default mongoose.model("TaskConfig", TaskConfigSchema);
