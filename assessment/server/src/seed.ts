/**
 * Seed demo data into the in-memory repository and print credentials/tokens.
 * Run: npm run seed
 */
import path from "node:path";
import dotenv from "dotenv";
import { seedStore } from "./repositories/inMemoryStore.js";

dotenv.config({ path: path.resolve(process.cwd(), "config.env") });
dotenv.config();

const seeded = seedStore();
console.log("\n--- Seed complete (in-memory) ---");
console.log("Employer API token (Authorization: Bearer ...):");
console.log(seeded.user.apiToken);
console.log("\nAssessment IDs:");
console.log("  a1:", seeded.assessments[0].id);
console.log("  a2:", seeded.assessments[1].id);
console.log("\nCandidate tokens (use /candidate?token=...):");
console.log("  pending:   ", seeded.submissions[0].token);
console.log("  in-progress:", seeded.submissions[1].token);
console.log("  submitted: ", seeded.submissions[2].token);
console.log("");
console.log(
  "Note: seed data is in-memory per process. Running this command does not persist data to a running API process.",
);
