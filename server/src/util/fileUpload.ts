import multer from "multer";
import { Request } from "express";

// Configure multer for JSON file uploads
const storage = multer.memoryStorage(); // Store in memory for processing

const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Only allow JSON files
  if (file.mimetype === "application/json" || file.originalname.endsWith(".json")) {
    cb(null, true);
  } else {
    cb(new Error("Only JSON files are allowed"));
  }
};

export const uploadLLMTrace = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
}).single("llmTrace"); // Field name: "llmTrace"

export function parseTraceFile(file: Express.Multer.File): any {
  try {
    const content = file.buffer.toString("utf-8");
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
