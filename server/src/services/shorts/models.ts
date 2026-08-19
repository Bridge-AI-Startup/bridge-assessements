/**
 * Play Claude model + effort allowlist (mirrors Claude Code /model UX).
 * Use dated / widely-available API IDs so the E2B Claude Code CLI and
 * Anthropic Messages API both accept them. (Dateless 4.6 IDs fail on older
 * CLI builds in the Play template with "may not exist or you may not have access".)
 */
import { getShortsAnthropicModel } from "../../utils/shortsEnv.js";

export type PlayEffortLevel =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type PlayModelOption = {
  id: string;
  /** Passed to `claude -p --model` (alias when safer for CLI). */
  cliId: string;
  label: string;
  description: string;
  /** Empty = no effort control for this model */
  efforts: PlayEffortLevel[];
  defaultEffort: PlayEffortLevel | null;
  /**
   * Serverless make only. The Shorts E2B template's Claude Code CLI rejects
   * model ids it does not know ("may not exist or you may not have access"),
   * so these never reach `claude -p` or the CLI-facing Messages proxy — the
   * resolver rewrites them to the default model outside serverless mode.
   */
  serverlessOnly?: boolean;
  /** Shown in the Build picker as a caution under the description. */
  warning?: string;
};

/** Product default for the Build picker and unresolved model requests. */
export const DEFAULT_PLAY_MODEL_ID = "claude-opus-4-5-20251101";

export const PLAY_MODEL_OPTIONS: PlayModelOption[] = [
  {
    id: "claude-opus-4-5-20251101",
    cliId: "claude-opus-4-5-20251101",
    label: "Opus 4.5",
    description: "Hardest problems",
    efforts: ["auto", "low", "medium", "high", "max"],
    defaultEffort: "auto",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    // Pass the full dated ID to `claude -p --model`. Short aliases like
    // "sonnet" resolve to whatever the CLI thinks is latest (e.g. claude-sonnet-5)
    // and fail with "may not exist or you may not have access".
    cliId: "claude-sonnet-4-5-20250929",
    label: "Sonnet 4.5",
    description: "Best balance for building",
    efforts: ["auto", "low", "medium", "high"],
    defaultEffort: "auto",
  },
  {
    id: "claude-haiku-4-5-20251001",
    cliId: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    description: "Fast and cheap",
    efforts: [],
    defaultEffort: null,
  },
  {
    id: "claude-fable-5",
    cliId: "claude-fable-5",
    label: "Fable 5",
    description: "Most capable · serverless only",
    // Effort is not plumbed through the serverless Messages call yet, so the
    // model runs at the API default. Advertising levels we ignore would lie.
    efforts: [],
    defaultEffort: null,
    serverlessOnly: true,
    warning: "Takes longer and uses more tokens",
  },
];

/** Map user/CLI aliases and retired IDs → allowlisted Anthropic API model. */
const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-6": "claude-sonnet-4-5-20250929",
  "claude-sonnet-5": "claude-sonnet-4-5-20250929",
  haiku: "claude-haiku-4-5-20251001",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
  opus: "claude-opus-4-5-20251101",
  "claude-opus-4-5": "claude-opus-4-5-20251101",
  "claude-opus-4-6": "claude-opus-4-5-20251101",
  "claude-opus-5": "claude-opus-4-5-20251101",
  fable: "claude-fable-5",
};

const MODEL_IDS = new Set(PLAY_MODEL_OPTIONS.map((m) => m.id));

/** Model used when a request asks for one this make mode cannot run. */
const FALLBACK_MODEL_ID =
  PLAY_MODEL_OPTIONS.find(
    (m) => m.id === DEFAULT_PLAY_MODEL_ID && !m.serverlessOnly,
  )?.id ??
  PLAY_MODEL_OPTIONS.find((m) => !m.serverlessOnly)?.id ??
  PLAY_MODEL_OPTIONS[0].id;

export type PlayModelScope = { serverless?: boolean };

function isRunnableIn(id: string, scope?: PlayModelScope): boolean {
  if (scope?.serverless) return true;
  return !PLAY_MODEL_OPTIONS.find((m) => m.id === id)?.serverlessOnly;
}

export function canonicalizePlayModel(raw?: string | null): string | null {
  const id = String(raw || "").trim();
  if (!id) return null;
  if (MODEL_IDS.has(id)) return id;
  const aliased = MODEL_ALIASES[id];
  if (aliased && MODEL_IDS.has(aliased)) return aliased;
  return null;
}

export function getPlayAnthropicModel(scope?: PlayModelScope): string {
  const fromEnv =
    getShortsAnthropicModel() ||
    process.env.ANTHROPIC_MODEL?.trim();
  const canonical = canonicalizePlayModel(fromEnv);
  if (canonical && isRunnableIn(canonical, scope)) return canonical;
  if (isRunnableIn(DEFAULT_PLAY_MODEL_ID, scope)) return DEFAULT_PLAY_MODEL_ID;
  return FALLBACK_MODEL_ID;
}

export function getPlayModelOption(modelId: string): PlayModelOption | null {
  const id = canonicalizePlayModel(modelId) || modelId;
  return PLAY_MODEL_OPTIONS.find((m) => m.id === id) || null;
}

/**
 * Full Anthropic model id for Messages API / proxy. Pass `{ serverless: true }`
 * from the serverless make path; every other caller (E2B `claude -p`, the
 * CLI-facing proxy) gets serverless-only models rewritten to the default.
 */
export function resolvePlayModel(
  raw?: string | null,
  scope?: PlayModelScope,
): string {
  const id = canonicalizePlayModel(raw);
  if (id && isRunnableIn(id, scope)) return id;
  return getPlayAnthropicModel(scope);
}

/** Value for `claude -p --model` (prefer short CLI alias). */
export function resolvePlayCliModel(raw?: string | null): string {
  const id = resolvePlayModel(raw);
  const opt = getPlayModelOption(id);
  return opt?.cliId || id;
}

export function resolvePlayEffort(
  modelId: string,
  raw?: string | null,
): PlayEffortLevel | null {
  const opt = getPlayModelOption(modelId);
  if (!opt || opt.efforts.length === 0) return null;
  const effort = String(raw || "").trim().toLowerCase() as PlayEffortLevel;
  if (effort && opt.efforts.includes(effort)) return effort;
  return opt.defaultEffort;
}

export function listPlayModelsPublic() {
  return {
    defaultModel: DEFAULT_PLAY_MODEL_ID,
    models: PLAY_MODEL_OPTIONS.map(({ cliId: _cli, ...pub }) => pub),
  };
}
