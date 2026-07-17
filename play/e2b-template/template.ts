import { Template, waitForPort } from "e2b";

/**
 * Play sandbox golden image:
 * - Node 22 base
 * - static preview (python http.server) on :8080
 * - Claude Code CLI on PATH
 * - starter project at `/home/user/project`
 *
 * Build UI uses Monaco + Claude chat + preview iframe (no code-server).
 *
 * Rebuild after changing start.sh or starter-project:
 *   npx tsx build.dev.ts
 */
export const template = Template()
  .fromNodeImage("22")
  .setEnvs({
    PLAY_WORKSPACE: "/home/user/project",
    // Claude native installer lands in ~/.local/bin
    PATH: "/home/user/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  })
  .runCmd(
    [
      "apt-get update",
      "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 curl ca-certificates",
      "rm -rf /var/lib/apt/lists/*",
    ],
    { user: "root" },
  )
  .makeDir("/home/user/project", { mode: 0o755 })
  .copy("starter-project/", "/home/user/project/")
  .copy("start.sh", "/home/user/start.sh", { mode: 0o755, user: "root" })
  // Claude Code CLI — native installer (Anthropic recommended as of 2026).
  // Fallback if native fails: npm install -g @anthropic-ai/claude-code
  .runCmd(
    "curl -fsSL https://claude.ai/install.sh | bash || npm install -g @anthropic-ai/claude-code",
  )
  .runCmd(
    'bash -lc \'command -v claude || test -x "$HOME/.local/bin/claude"\'',
  )
  .setStartCmd("/home/user/start.sh", waitForPort(8080));
