/**
 * Provision Claude Code in a Play sandbox for no-login gateway access.
 */
import type { Sandbox } from "e2b";
import { runPlayCommand, writePlayProjectClaudeMd } from "./sandbox.js";
import {
  buildSessionLlmBaseUrl,
  getPlayLlmProxyPublicBase,
  isPlayLlmProxyLikelyUnreachableFromE2b,
} from "./llmProxy.js";
import { getPlayAnthropicModel } from "./models.js";

export async function provisionClaudeForSession(
  sandbox: Sandbox,
  input: {
    sessionId: string;
    llmProxyToken: string;
  },
): Promise<void> {
  const publicBase = getPlayLlmProxyPublicBase();
  if (isPlayLlmProxyLikelyUnreachableFromE2b(publicBase)) {
    console.warn(
      "[play/claudeProvision] PLAY_LLM_PROXY_PUBLIC_URL is unset or points at localhost (" +
        publicBase +
        "). E2B sandboxes cannot reach the host; set PLAY_LLM_PROXY_PUBLIC_URL to Render or a tunnel.",
    );
  }

  const baseUrl = buildSessionLlmBaseUrl(input.sessionId);
  const model = getPlayAnthropicModel();

  const settings = {
    model,
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: input.llmProxyToken,
      ANTHROPIC_MODEL: model,
    },
  };

  const claudeJson = {
    hasCompletedOnboarding: true,
    theme: "dark",
  };

  await runPlayCommand(
    sandbox,
    "mkdir -p /home/user/.claude /home/user/project/.claude",
    { timeoutMs: 10_000 },
  );

  await sandbox.files.write(
    "/home/user/.claude/settings.json",
    `${JSON.stringify(settings, null, 2)}\n`,
  );
  await sandbox.files.write(
    "/home/user/project/.claude/settings.json",
    `${JSON.stringify(settings, null, 2)}\n`,
  );
  await sandbox.files.write(
    "/home/user/.claude.json",
    `${JSON.stringify(claudeJson, null, 2)}\n`,
  );

  const exports = [
    `export ANTHROPIC_BASE_URL=${JSON.stringify(baseUrl)}`,
    `export ANTHROPIC_AUTH_TOKEN=${JSON.stringify(input.llmProxyToken)}`,
    `export ANTHROPIC_MODEL=${JSON.stringify(model)}`,
  ].join("\n");

  // Shell profile so interactive terminals pick up the gateway (refresh on resume)
  const envSnippet = `\n# PLAY_LLM_GATEWAY\n${exports}\n# END_PLAY_LLM_GATEWAY\n`;
  const gatewayBlock =
    /(?:\n)?# PLAY_LLM_GATEWAY\n[\s\S]*?(?:# END_PLAY_LLM_GATEWAY\n|(?=[\s\S]*$))/;

  async function upsertShellProfile(path: string): Promise<void> {
    let existing = "";
    try {
      existing = await sandbox.files.read(path);
    } catch {
      existing = "";
    }
    const next = gatewayBlock.test(existing)
      ? existing.replace(gatewayBlock, envSnippet)
      : existing + envSnippet;
    await sandbox.files.write(path, next);
  }

  try {
    await upsertShellProfile("/home/user/.bashrc");
    await upsertShellProfile("/home/user/.profile");
  } catch (err) {
    console.warn("[play/claudeProvision] shell profile update failed:", err);
  }

  // Claude Code auto-loads CLAUDE.md from the project cwd.
  await writePlayProjectClaudeMd(sandbox);

  await sandbox.files.write(
    "/home/user/project/CLAUDE_PLAY.md",
    [
      "# Bridge Play — Claude",
      "",
      "Claude Code is preconfigured for this session (no Anthropic login).",
      "",
      "- Use the chat panel on the Build page, or run `claude` in the Terminal.",
      "- Token usage is metered against this challenge's budget.",
      "- **Preview opens `index.html` first.** Put the home UI there (linked CSS/JS or CDN).",
      "- Extra HTML pages are fine for multi-page apps if linked from `index.html`.",
      "- Do not leave `index.html` as the untouched starter while the real app lives only elsewhere.",
      "- Static preview only — no Vite / npm install / bundlers.",
      "- Prefer `preventDefault` on forms; use `localStorage` when persistence is required.",
      "",
      "See also `CLAUDE.md` and `CHALLENGE.md` in this folder.",
      "",
    ].join("\n"),
  );
}
