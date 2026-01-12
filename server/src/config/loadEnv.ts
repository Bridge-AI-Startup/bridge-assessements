/**
 * Load environment variables from config.env
 * This MUST be imported FIRST before any other modules that need env vars
 */

import { config } from "dotenv";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Get the directory of the current file (ES module equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config.env file if it exists (for local development)
// In production (Render), environment variables are set directly
const configEnvPath = join(__dirname, "../../config.env");
if (existsSync(configEnvPath)) {
  const result = config({ path: configEnvPath });
  if (result.error) {
    console.error("❌ Error loading config.env:", result.error);
  } else {
    console.log("📄 Loaded environment variables from config.env");
  }
} else {
  // Also check relative to current working directory (for npm scripts)
  const cwdConfigPath = join(process.cwd(), "config.env");
  if (existsSync(cwdConfigPath)) {
    const result = config({ path: cwdConfigPath });
    if (result.error) {
      console.error("❌ Error loading config.env:", result.error);
    } else {
      console.log("📄 Loaded environment variables from config.env (CWD)");
    }
  } else {
    console.log("📄 Using environment variables from system (production mode)");
    console.log(`   Searched for config.env at: ${configEnvPath}`);
    console.log(`   Also searched at: ${cwdConfigPath}`);
  }
}

