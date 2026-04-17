/**
 * Quick check that E2B is wired up: creates a sandbox, runs a command, tears down.
 *
 * Usage (from server/):
 *   npx tsx src/scripts/e2b-smoke.ts
 *
 * Requires E2B_API_KEY in config.env or the environment.
 */
import "../config/loadEnv.js";
import { withGradingSandbox } from "../services/e2b/graderSandbox.js";

async function main() {
  const result = await withGradingSandbox(async (ctx) => {
    const echo = await ctx.run('echo "bridge-e2b-smoke"');
    const uname = await ctx.run("uname -a");
    return { echo, uname, sandboxId: ctx.sandboxId };
  });

  console.log("E2B smoke OK");
  console.log("sandboxId:", result.sandboxId);
  console.log("echo:", result.echo.stdout.trim());
  console.log("uname:", result.uname.stdout.trim());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
