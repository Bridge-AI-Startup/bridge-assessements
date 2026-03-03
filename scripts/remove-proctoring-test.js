#!/usr/bin/env node
/**
 * Removes the standalone proctoring test page and all related test infrastructure.
 *
 * What this script does:
 * 1. Deletes client/src/pages/ProctoringTest.jsx
 * 2. Removes the ProctoringTest import and entry from pages.config.js
 * 3. Removes the createTestSession handler from server/src/controllers/proctoring.ts
 * 4. Removes the test route from server/src/routes/proctoring.ts
 * 5. Removes the createTestProctoringSession function from client/src/api/proctoring.ts
 * 6. Restores verifyAuthToken on generate-transcript route (removes dev bypass)
 *
 * Usage:
 *   node scripts/remove-proctoring-test.js
 *
 * Or just tell Claude: "remove the proctoring test page"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function removeFile(relPath) {
  const full = path.join(ROOT, relPath);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
    console.log(`  Deleted: ${relPath}`);
  } else {
    console.log(`  Already gone: ${relPath}`);
  }
}

function editFile(relPath, replacements) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    console.log(`  Skipped (not found): ${relPath}`);
    return;
  }
  let content = fs.readFileSync(full, "utf8");
  for (const [search, replace] of replacements) {
    if (content.includes(search)) {
      content = content.replace(search, replace);
    }
  }
  fs.writeFileSync(full, content, "utf8");
  console.log(`  Updated: ${relPath}`);
}

console.log("\nRemoving proctoring test infrastructure...\n");

// 1. Delete test page
removeFile("client/src/pages/ProctoringTest.jsx");

// 2. Clean pages.config.js
editFile("client/src/pages.config.js", [
  ['import ProctoringTest from "./pages/ProctoringTest";\n', ""],
  ["  ProctoringTest: ProctoringTest,\n", ""],
]);

// 3. Remove createTestSession from controller
editFile("server/src/controllers/proctoring.ts", [
  ['import crypto from "crypto";\n', ""],
  ['import mongoose from "mongoose";\n', ""],
  [
    /\/\/ POST \/api\/proctoring\/sessions\/test\/create  \(DEV ONLY\)[\s\S]*$/m,
    "",
  ],
]);

// 4. Remove test route + dev auth bypass from routes
editFile("server/src/routes/proctoring.ts", [
  [
    `// Dev-only test endpoint (must be before :sessionId param routes)
router.post(
  "/sessions/test/create",
  ProctoringController.createTestSession
);

`,
    "",
  ],
  [
    `const transcriptAuthMiddleware =
  process.env.NODE_ENV === "production" ? [verifyAuthToken] : [];

router.post(
  "/sessions/:sessionId/generate-transcript",
  ...transcriptAuthMiddleware,
  ProctoringValidator.generateTranscriptValidation,
  ProctoringController.generateSessionTranscript
);`,
    `router.post(
  "/sessions/:sessionId/generate-transcript",
  [verifyAuthToken],
  ProctoringValidator.generateTranscriptValidation,
  ProctoringController.generateSessionTranscript
);`,
  ],
]);

// 5. Remove createTestProctoringSession from client API
editFile("client/src/api/proctoring.ts", [
  [
    `/**
 * Create a dev-only test proctoring session (no real assessment needed).
 */
export async function createTestProctoringSession(): Promise<
  APIResult<{ session: ProctoringSession; token: string }>
> {
  try {
    const response = await post("/proctoring/sessions/test/create", {});
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return handleAPIError(error);
  }
}

`,
    "",
  ],
]);

console.log("\nDone! The proctoring test page has been removed.");
console.log(
  "The generateTranscript and getTranscriptContent API functions were kept (they're useful for production).\n"
);
