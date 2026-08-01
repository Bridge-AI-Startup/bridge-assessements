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
};

export const PLAY_MODEL_OPTIONS: PlayModelOption[] = [
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
    id: "claude-opus-4-5-20251101",
    cliId: "claude-opus-4-5-20251101",
    label: "Opus 4.5",
    description: "Hardest problems",
    efforts: ["auto", "low", "medium", "high", "max"],
    defaultEffort: "auto",
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
};

const MODEL_IDS = new Set(PLAY_MODEL_OPTIONS.map((m) => m.id));

export function canonicalizePlayModel(raw?: string | null): string | null {
  const id = String(raw || "").trim();
  if (!id) return null;
  if (MODEL_IDS.has(id)) return id;
  const aliased = MODEL_ALIASES[id];
  if (aliased && MODEL_IDS.has(aliased)) return aliased;
  return null;
}

export function getPlayAnthropicModel(): string {
  const fromEnv =
    getShortsAnthropicModel() ||
    process.env.ANTHROPIC_MODEL?.trim();
  const canonical = canonicalizePlayModel(fromEnv);
  if (canonical) return canonical;
  return PLAY_MODEL_OPTIONS[0].id;
}

export function getPlayModelOption(modelId: string): PlayModelOption | null {
  const id = canonicalizePlayModel(modelId) || modelId;
  return PLAY_MODEL_OPTIONS.find((m) => m.id === id) || null;
}

/** Full Anthropic model id for Messages API / proxy. */
export function resolvePlayModel(raw?: string | null): string {
  return canonicalizePlayModel(raw) || getPlayAnthropicModel();
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
    defaultModel: getPlayAnthropicModel(),
    models: PLAY_MODEL_OPTIONS.map(({ cliId: _cli, ...pub }) => pub),
  };
}
