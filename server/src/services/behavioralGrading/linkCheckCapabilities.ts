/**
 * Bind a behavioral check sentence to inventory IDs.
 *
 * Heuristics first (handler name ∩ check tokens; PATCH+done ∩ "check off").
 * An LLM leftover may only pick IDs that already exist — invented clicks and
 * paths are dropped, same rule as HTTP grounding.
 */

import { z } from "zod";
import {
  createChatCompletionWithStructuredOutput,
  type ChatMessage,
} from "../langchainAI.js";
import {
  formatCapabilityInventory,
  type Capability,
} from "./extractCapabilities.js";
import { behavioralInfo } from "./log.js";

export const CHECK_PURPOSES = [
  "create",
  "toggle_done",
  "delete",
  "health",
] as const;

export type CheckPurpose = (typeof CHECK_PURPOSES)[number];

export type CapabilityLink = {
  checkId: string;
  checkText: string;
  purpose: CheckPurpose;
  capabilityIds: string[];
};

const leftoverLinkSchema = z.object({
  purpose: z.enum(CHECK_PURPOSES),
  capabilityIds: z.array(z.string().min(1).max(120)).max(8),
});

export function inferPurpose(checkText: string): CheckPurpose | null {
  const text = checkText.trim();
  if (
    (/\b(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(text) || /\/health\b/i.test(text)) &&
    /health/i.test(text)
  ) {
    return "health";
  }
  if (/\bdelet|\bremov/i.test(text)) return "delete";
  if (
    /\b(done|check(?:ing|ed)?\s+(?:a\s+)?(?:note\s+)?off|toggles?|marks?\s+it\s+done)\b/i.test(
      text
    )
  ) {
    return "toggle_done";
  }
  if (/\b(add|create|see it in the list|new note)\b/i.test(text)) return "create";
  return null;
}

export function looksSubjectiveCheck(text: string): boolean {
  return /\b(layout|on a phone|mobile|tablet|pretty|aesthetic|accessible|a11y|looks good|visual polish|responsive design)\b/i.test(
    text
  );
}

export function scoreCapabilityForPurpose(
  cap: Capability,
  purpose: CheckPurpose
): number {
  if (purpose === "health") {
    if (cap.kind !== "http") return 0;
    if (cap.method === "GET" && /health/i.test(cap.path || "")) return 10;
    if (cap.signals.includes("health")) return 8;
    return 0;
  }
  if (purpose === "create") {
    if (cap.kind === "ui.fill") return cap.placeholder ? 6 : 4;
    if (cap.kind === "ui.click") {
      const name = cap.name || "";
      const handler = cap.handler || "";
      if (/^(add|create|save|submit)$/i.test(name)) return 10;
      if (/add|create/i.test(handler)) return 9;
      if (/add|create|save|submit/i.test(name)) return 8;
    }
    return 0;
  }
  if (purpose === "toggle_done") {
    if (cap.kind === "ui.click") {
      if (/toggle|check/i.test(cap.handler || "")) return 10;
      if (/check/i.test(cap.className || "")) return 9;
      if (!cap.name) return 7;
      if (/done|check/i.test(cap.name)) return 6;
    }
    if (
      cap.kind === "http" &&
      cap.method === "PATCH" &&
      cap.signals.includes("done")
    ) {
      return 5;
    }
    return 0;
  }
  if (purpose === "delete") {
    if (cap.kind === "ui.click") {
      if (/delete|remove/i.test(cap.name || "")) return 10;
      if (/remove|delete/i.test(cap.handler || "")) return 9;
    }
    if (cap.kind === "http" && cap.method === "DELETE") return 5;
    return 0;
  }
  return 0;
}

export function pickCapabilitiesForPurpose(
  purpose: CheckPurpose,
  capabilities: Capability[]
): Capability[] {
  const ranked = capabilities
    .map((cap) => ({ cap, score: scoreCapabilityForPurpose(cap, purpose) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  if (purpose === "health") {
    const http = ranked.find((r) => r.cap.kind === "http");
    return http ? [http.cap] : [];
  }
  const fill = capabilities
    .filter((c) => c.kind === "ui.fill")
    .sort((a, b) => (b.placeholder ? 1 : 0) - (a.placeholder ? 1 : 0))[0];
  const primary = ranked.find((r) => r.cap.kind !== "ui.fill" && r.cap.kind !== "http");
  const ids: Capability[] = [];
  if (fill && purpose !== "health") ids.push(fill);
  if (primary) ids.push(primary.cap);
  return ids;
}

/**
 * Create/delete/toggle_done all need a create control so the walkthrough can
 * plant a nonce first. Health does not.
 */
export function pickTemplateCaps(
  purpose: CheckPurpose,
  capabilities: Capability[]
): {
  fill?: Capability;
  create?: Capability;
  toggle?: Capability;
  delete?: Capability;
  health?: Capability;
} {
  const fill = capabilities
    .filter((c) => c.kind === "ui.fill")
    .sort((a, b) => (b.placeholder ? 1 : 0) - (a.placeholder ? 1 : 0))[0];
  const best = (p: CheckPurpose) =>
    capabilities
      .map((cap) => ({ cap, score: scoreCapabilityForPurpose(cap, p) }))
      .filter((r) => r.score > 0 && r.cap.kind === "ui.click")
      .sort((a, b) => b.score - a.score)[0]?.cap;
  const health = capabilities
    .map((cap) => ({ cap, score: scoreCapabilityForPurpose(cap, "health") }))
    .filter((r) => r.score > 0 && r.cap.kind === "http")
    .sort((a, b) => b.score - a.score)[0]?.cap;

  if (purpose === "health") return { health };
  if (purpose === "create") return { fill, create: best("create") };
  if (purpose === "delete") {
    return { fill, create: best("create"), delete: best("delete") };
  }
  return { fill, create: best("create"), toggle: best("toggle_done"), delete: best("delete") };
}

export function linkCheckToCapabilities(
  check: { id: string; text: string },
  capabilities: Capability[]
): CapabilityLink | null {
  const purpose = inferPurpose(check.text);
  if (!purpose) return null;
  const picked = pickCapabilitiesForPurpose(purpose, capabilities);
  if (!picked.length) return null;
  if (purpose === "health" && !picked.some((c) => c.kind === "http")) return null;
  if (purpose !== "health" && !picked.some((c) => c.kind === "ui.click")) return null;
  return {
    checkId: check.id,
    checkText: check.text,
    purpose,
    capabilityIds: picked.map((c) => c.id),
  };
}

export function validateCapabilityLink(
  proposed: { purpose: string; capabilityIds: string[] },
  capabilities: Capability[],
  check: { id: string; text: string }
): CapabilityLink | null {
  if (!(CHECK_PURPOSES as readonly string[]).includes(proposed.purpose)) {
    return null;
  }
  const known = new Set(capabilities.map((c) => c.id));
  const valid = proposed.capabilityIds.filter((id) => known.has(id));
  if (!valid.length) return null;
  return {
    checkId: check.id,
    checkText: check.text,
    purpose: proposed.purpose as CheckPurpose,
    capabilityIds: valid,
  };
}

export async function tagLeftoverCheckWithLlm(input: {
  check: { id: string; text: string };
  capabilities: Capability[];
}): Promise<CapabilityLink | null> {
  if (!input.capabilities.length) return null;
  const inventory = formatCapabilityInventory(input.capabilities);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You tag one behavioral check against a frozen inventory of product commands extracted from the candidate's source.

You may ONLY return capabilityIds that appear in the inventory. Do not invent clicks, CSS, names, or HTTP paths. If nothing fits, return an empty capabilityIds array.

Purposes:
- create: add/create something the user typed
- toggle_done: check off / mark done
- delete: remove an item
- health: GET a health/status endpoint`,
    },
    {
      role: "user",
      content: `Check (${input.check.id}):
${input.check.text}

Inventory:
${inventory}

Return purpose and capabilityIds.`,
    },
  ];
  try {
    const { result } = await createChatCompletionWithStructuredOutput(
      "workflow_evaluation",
      messages,
      leftoverLinkSchema,
      { temperature: 0, maxTokens: 400 }
    );
    const link = validateCapabilityLink(result, input.capabilities, input.check);
    behavioralInfo("capability_link_llm", {
      checkId: input.check.id,
      ok: Boolean(link),
      purpose: link?.purpose,
      ids: link?.capabilityIds.length ?? 0,
    });
    return link;
  } catch (e) {
    behavioralInfo("capability_link_llm_failed", {
      checkId: input.check.id,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    });
    return null;
  }
}
