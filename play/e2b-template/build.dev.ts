import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Template, defaultBuildLogger } from "e2b";
import { template } from "./template.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Prefer local .env, then fall back to server/config.env (same E2B_API_KEY as grading).
config({ path: resolve(__dirname, ".env") });
config({ path: resolve(__dirname, "../../server/config.env") });

async function main() {
  if (!process.env.E2B_API_KEY?.trim()) {
    throw new Error(
      "E2B_API_KEY is required. Set it in play/e2b-template/.env or server/config.env",
    );
  }

  console.log("Building Play E2B template: bridge-play-dev …");
  const info = await Template.build(template, "bridge-play-dev", {
    cpuCount: 2,
    memoryMB: 2048,
    onBuildLogs: defaultBuildLogger(),
  });
  console.log("Build complete:", info);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
