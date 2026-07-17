import type { GradingSandboxContext } from "../e2b/graderSandbox.js";
import { bashLc, curlInsideSandbox } from "./artifacts.js";
import type { RunbookPlan } from "./schema.js";
import { behavioralInfo } from "./log.js";

export type SandboxAppAccess = {
  /** Origin for run_command curl inside the VM (e.g. http://127.0.0.1:5070). */
  internalOrigin?: string;
  port?: number;
  discoverySource?: string;
  /** Optional E2B public URL — only for Playwright on the Bridge host. */
  externalOrigin?: string;
};

function uniquePorts(ports: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const p of ports) {
    if (!Number.isFinite(p) || p < 1 || p > 65535) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** Prefer API/backend ports over typical Vite dev-server ports when both appear in README. */
function prioritizePorts(ports: number[], readmeText: string): number[] {
  const lower = readmeText.toLowerCase();
  const scored = ports.map((port) => {
    let score = 0;
    const apiCtx = new RegExp(
      `api[^\\n]{0,80}(localhost|127\\.0\\.0\\.1):${port}\\b`,
      "i"
    ).test(readmeText);
    const uiCtx = new RegExp(
      `(ui|vite|frontend)[^\\n]{0,80}(localhost|127\\.0\\.0\\.1):${port}\\b`,
      "i"
    ).test(readmeText);
    if (apiCtx) score += 20;
    if (uiCtx) score -= 10;
    if (port === 5173 || port === 5175 || port === 3000) score -= 5;
    if (port === 8000 || port === 8080 || port === 5070 || port === 5050) score += 3;
    if (lower.includes(`localhost:${port}`) && lower.indexOf(`localhost:${port}`) < 800) {
      score += 2;
    }
    return { port, score };
  });
  scored.sort((a, b) => b.score - a.score || a.port - b.port);
  return scored.map((s) => s.port);
}

function portsFromReadme(readmeText: string): number[] {
  const ports: number[] = [];
  for (const m of readmeText.matchAll(/(?:localhost|127\.0\.0\.1):(\d{2,5})/gi)) {
    ports.push(Number(m[1]));
  }
  return ports;
}

async function portsFromConfigFiles(
  ctx: GradingSandboxContext,
  repoPath: string
): Promise<number[]> {
  const r = await ctx.run(
    bashLc(
      `grep -rhE '^PORT=' --include='config.env' --include='.env' --include='.env.local' . 2>/dev/null | head -10`
    ),
    { cwd: repoPath, timeoutMs: 20_000 }
  );
  const ports: number[] = [];
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  for (const m of text.matchAll(/^PORT=(\d{2,5})/gm)) {
    ports.push(Number(m[1]));
  }
  return ports;
}

async function portsFromListeningSockets(
  ctx: GradingSandboxContext
): Promise<number[]> {
  const r = await ctx.run(
    bashLc(
      `(command -v ss >/dev/null && ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null) | awk '{print $NF}' | grep -oE '[0-9]+$' | sort -nu | head -20`
    ),
    { cwd: "/",
      timeoutMs: 20_000 }
  );
  const ports: number[] = [];
  for (const line of (r.stdout || "").split("\n")) {
    const n = Number(line.trim());
    if (Number.isFinite(n)) ports.push(n);
  }
  return ports;
}

async function probeOrigin(
  ctx: GradingSandboxContext,
  port: number
): Promise<{ ok: boolean; path: string }> {
  const origin = `http://127.0.0.1:${port}`;
  for (const path of ["/health", "/api/health", "/"]) {
    const res = await curlInsideSandbox(ctx, `${origin}${path}`);
    if (res.ok) return { ok: true, path };
  }
  return { ok: false, path: "/" };
}

/**
 * Discover how to reach the candidate app from inside the E2B VM (human-style localhost).
 * Does not require runbook portsHint.
 */
export async function discoverSandboxAppAccess(
  ctx: GradingSandboxContext,
  repoPath: string,
  readmeText: string,
  runbook: RunbookPlan,
  externalOrigin?: string
): Promise<SandboxAppAccess> {
  const fromConfig = await portsFromConfigFiles(ctx, repoPath);
  const fromReadme = portsFromReadme(readmeText);
  const fromListen = await portsFromListeningSockets(ctx);
  const fromHint = runbook.portsHint ?? [];

  const all = uniquePorts([
    ...fromConfig,
    ...fromReadme,
    ...fromHint,
    ...fromListen,
  ]);

  const ordered = prioritizePorts(all, readmeText);

  behavioralInfo("sandbox_app_discover_candidates", {
    ordered: ordered.slice(0, 8),
    fromConfig,
    fromReadme: fromReadme.slice(0, 5),
    fromListen: fromListen.slice(0, 8),
    fromHint,
  });

  for (const port of ordered) {
    const probe = await probeOrigin(ctx, port);
    if (probe.ok) {
      const internalOrigin = `http://127.0.0.1:${port}`;
      let discoverySource = "probe";
      if (fromConfig.includes(port)) discoverySource = "config.env PORT";
      else if (fromReadme.includes(port)) discoverySource = "README localhost port";
      else if (fromHint.includes(port)) discoverySource = "runbook portsHint";
      else if (fromListen.includes(port)) discoverySource = "listening socket";

      behavioralInfo("sandbox_app_discover_ok", {
        internalOrigin,
        port,
        discoverySource,
        probePath: probe.path,
      });

      return {
        internalOrigin,
        port,
        discoverySource,
        externalOrigin,
      };
    }
  }

  behavioralInfo("sandbox_app_discover_none", { tried: ordered.slice(0, 10) });
  return { externalOrigin };
}
