/**
 * Smoke-test the Play E2B template: create sandbox, print URLs, curl preview.
 *
 * Usage (from server/):
 *   npx tsx src/scripts/play-sandbox-smoke.ts
 *   npx tsx src/scripts/play-sandbox-smoke.ts --keep
 *
 * Requires E2B_API_KEY and a built template (PLAY_E2B_TEMPLATE_ID or bridge-play-dev).
 * Build first: cd ../play/e2b-template && npx tsx build.dev.ts
 */
import "../config/loadEnv.js";
import {
  createPlaySandbox,
  getPlayE2bTemplateId,
  getPlaySandboxUrls,
  killPlaySandbox,
  runPlayCommand,
  writeChallengeMarkdown,
} from "../services/play/sandbox.js";

const SAMPLE_CHALLENGE = `# Smoke challenge

Build anything small in this folder. Edit \`index.html\` and refresh the preview URL.
`;

async function waitForPreview(
  previewUrl: string,
  attempts = 30,
): Promise<{ ok: boolean; status?: number; snippet?: string; error?: string }> {
  let lastError = "no attempts";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(previewUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          snippet: text.slice(0, 120).replace(/\s+/g, " "),
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, error: lastError };
}

async function main() {
  const keep = process.argv.includes("--keep");
  const templateId = getPlayE2bTemplateId();

  console.log("Play E2B smoke");
  console.log("  template:", templateId);
  console.log("  keep:", keep);

  const sandbox = await createPlaySandbox({
    metadata: { purpose: "play-sandbox-smoke" },
  });

  try {
    await writeChallengeMarkdown(sandbox, SAMPLE_CHALLENGE);

    const urls = getPlaySandboxUrls(sandbox);
    console.log("\nSandbox ready");
    console.log("  sandboxId:", sandbox.sandboxId);
    console.log("  previewUrl:", urls.previewUrl);
    console.log("  vscodeUrl (legacy, unused):", urls.vscodeUrl);

    const claudeCheck = await runPlayCommand(
      sandbox,
      'bash -lc \'command -v claude || test -x "$HOME/.local/bin/claude" && echo claude_ok || echo claude_missing\'',
    );
    console.log(
      "  claude:",
      (claudeCheck.stdout || claudeCheck.stderr || "").trim() ||
        `exit ${claudeCheck.exitCode}`,
    );

    console.log("\nWaiting for preview HTTP 200…");
    const preview = await waitForPreview(urls.previewUrl);
    if (preview.ok) {
      console.log("  preview OK:", preview.status, preview.snippet);
    } else {
      console.error("  preview FAILED:", preview.error);
      if (!keep) {
        process.exitCode = 1;
      }
    }

    console.log(`
Manual checklist:
  1. Open previewUrl → see starter index.html (+ CHALLENGE.md written)
  2. Confirm smoke printed claude_ok
  3. Build UI uses Monaco + Claude chat (no code-server)
`);

    if (keep) {
      console.log(
        "Leaving sandbox alive (--keep). Kill it from the E2B dashboard or:",
      );
      console.log(`  sandboxId=${sandbox.sandboxId}`);
      console.log("Press Ctrl+C when done; this process will then kill the sandbox.\n");
      await new Promise<void>((resolve) => {
        const shutdown = async () => {
          console.log("\nKilling sandbox…");
          await killPlaySandbox(sandbox);
          resolve();
        };
        process.on("SIGINT", () => {
          void shutdown();
        });
        process.on("SIGTERM", () => {
          void shutdown();
        });
      });
    }
  } finally {
    if (!keep) {
      await killPlaySandbox(sandbox);
      console.log("Sandbox killed.");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
