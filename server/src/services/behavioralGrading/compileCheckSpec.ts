/**
 * Compile a leftover `kind: "agent"` check into a machine-run spec at grade time.
 *
 * Preferred path: link the check sentence to the capability inventory, then
 * instantiate a purpose template. The model may only tag existing IDs. Invented
 * clicks and HTTP paths are dropped. Invalid link → inconclusive, not an agent
 * fail.
 *
 * When no inventory was extracted, the older structured-output compile is kept
 * as a backstop for named-control walkthroughs.
 */

import { z } from "zod";
import {
  createChatCompletionWithStructuredOutput,
  type ChatMessage,
} from "../langchainAI.js";
import { suggestedAcceptanceSchema } from "../schemas/assessmentGeneration.js";
import type { BehavioralBrowserSession } from "./browserSession.js";
import {
  behavioralCheckSpecSchema,
  type BehavioralCheckSpec,
} from "./checkSpecs.js";
import {
  uiControlsToCapabilities,
  type Capability,
} from "./extractCapabilities.js";
import {
  formatUiControlCatalog,
  type UiControl,
} from "./extractUiControls.js";
import {
  looksSubjectiveCheck,
  tagLeftoverCheckWithLlm,
  type CapabilityLink,
} from "./linkCheckCapabilities.js";
import { behavioralInfo } from "./log.js";
import { suggestionToSpec } from "./specSuggestions.js";
import { synthesizeAcceptance } from "./synthesizeAcceptance.js";

const compileOutputSchema = suggestedAcceptanceSchema.omit({ text: true });

export type CompileCheckSpecInput = {
  checkText: string;
  checkId?: string;
  assessmentDescription: string;
  /** Source-grounded controls — used to bind leftover click_text and as a catalog backstop. */
  catalog?: UiControl[];
  /** Unified UI + HTTP inventory. When present, compile is link + template. */
  capabilities?: Capability[];
  /** Optional corroboration only. Never used as a search key for clicks. */
  ariaSnapshot?: string;
  sandboxAppOrigin?: string;
};

export type CompileCheckSpecResult =
  | { ok: true; spec: BehavioralCheckSpec }
  | { ok: false; reason: string };

const MAX_SNAPSHOT = 6_000;
const MAX_DESCRIPTION = 4_000;

export async function captureAriaSnapshot(input: {
  session: BehavioralBrowserSession;
  baseUrl: string;
}): Promise<string | undefined> {
  try {
    const page = await input.session.getPage(input.baseUrl);
    const url = input.baseUrl.replace(/\/$/, "") + "/";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const aria = await page.locator("body").ariaSnapshot({ timeout: 8_000 });
    const title = await page.title().catch(() => "");
    const combined = `URL: ${page.url()}\nTitle: ${title}\n\n${aria}`;
    return combined.length <= MAX_SNAPSHOT
      ? combined
      : `${combined.slice(0, MAX_SNAPSHOT)}\n… (truncated)`;
  } catch (e) {
    behavioralInfo("compile_snapshot_failed", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    });
    return undefined;
  }
}

function buildCompileMessages(input: CompileCheckSpecInput): ChatMessage[] {
  const description = input.assessmentDescription.slice(0, MAX_DESCRIPTION);
  const catalog = formatUiControlCatalog(input.catalog ?? []);
  const snapshot = input.ariaSnapshot?.trim()
    ? input.ariaSnapshot.slice(0, MAX_SNAPSHOT)
    : "(none — corroboration only; do not search the page for controls)";
  const origin = input.sandboxAppOrigin?.trim() || "(unknown)";

  return [
    {
      role: "system",
      content: `You compile one behavioral check into a machine-run acceptance procedure. You do NOT grade the submission. You do NOT invent APIs. You do NOT invent click targets.

Rules:
- User-facing product behavior (add, see in the list, delete, check off, form, page, button) → kind="ui". Use goto, fill_placeholder or fill_role, click_role, expect_text. Put {{nonce}} in the typed value AND the expect_text when the check is about data the user entered, so a hardcoded fixture cannot pass.
- Click targets MUST be copied from the source control catalog (button/link/checkbox names). Prefer click_role with role=button|link|checkbox, name exact, exact=true. Never click prose, headings, lede copy, or empty-state text ("No notes yet.", "Add a note, check it off").
- fill_placeholder.placeholder must be copied from a catalog textbox. fill_role.role is textbox/searchbox/combobox. Never emit CSS selectors.
- goto path is almost always "/".
- kind="http" / "http_sequence" / "restart_persistence" ONLY when the check itself names a method and path (GET /health, POST /api/notes). The path MUST also appear in the description. Do not invent /api/... and do not curl an API just because the description listed it.
- kind="agent" ONLY for subjective/layout checks that cannot be asserted (e.g. "the layout still works on a phone"). Those are the rare leftover.
- requests[].path starts with /. jsonBody is a JSON string. Use {{nonce}} in jsonBody and expectBodyContains for stored data.
- expectBodyContains must be distinctive fragments (the nonce, ok, a field value) — NEVER a whole JSON object and NEVER pretty-printed JSON with spaces after colons. Compact form only: "ok":true not "ok": true. Extra fields in the real response are normal.
- If the check itself does not name a method and path (GET /health, POST /api/notes), you MUST emit kind="ui" even when the description lists APIs. "add a note and see it in the list" is a walkthrough, not a curl.`
    },
    {
      role: "user",
      content: `Behavioral check:
${input.checkText}

Assessment description (excerpt):
${description || "(none)"}

Source UI control catalog (click and fill ONLY these):
${catalog}

Live accessibility snapshot (corroboration, not a search key):
${snapshot}

In-sandbox origin: ${origin}

Compile the procedure.`,
    },
  ];
}

/**
 * Whether the check sentence itself names an HTTP contract. "GET /health"
 * does; "someone can add a note" does not, even if the assessment description
 * lists POST /api/notes.
 */
export function checkNamesHttpContract(text: string): boolean {
  return (
    /\b(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(text) ||
    /(?:^|\s)\/[A-Za-z0-9._~!$&'()*+,;=:@%/\-]+/.test(text)
  );
}

/**
 * Last-resort UI walkthrough from the source catalog when the inventory
 * templates cannot run. Clicks only catalog buttons — never page prose.
 */
export function fallbackUiSpecFromCatalog(input: {
  checkText: string;
  checkId?: string;
  catalog?: UiControl[];
  capabilities?: Capability[];
}): BehavioralCheckSpec | null {
  const capabilities =
    input.capabilities?.length
      ? input.capabilities
      : uiControlsToCapabilities(input.catalog ?? []);
  return synthesizeAcceptance({
    checkText: input.checkText,
    checkId: input.checkId,
    capabilities,
  });
}

/** @deprecated Use fallbackUiSpecFromCatalog — snapshot is not a click search key. */
export function fallbackUiSpecFromSnapshot(input: {
  checkText: string;
  checkId?: string;
  ariaSnapshot?: string;
  catalog?: UiControl[];
  capabilities?: Capability[];
}): BehavioralCheckSpec | null {
  return fallbackUiSpecFromCatalog(input);
}

function stampSpec(
  spec: BehavioralCheckSpec,
  checkId?: string
): BehavioralCheckSpec | null {
  const stamped = checkId ? ({ ...spec, id: checkId } as BehavioralCheckSpec) : spec;
  const parsed = behavioralCheckSpecSchema.safeParse(stamped);
  return parsed.success ? parsed.data : null;
}

function inventoryFrom(input: CompileCheckSpecInput): Capability[] {
  if (input.capabilities?.length) return input.capabilities;
  if (input.catalog?.length) return uiControlsToCapabilities(input.catalog);
  return [];
}

/**
 * Link + instantiate a template, or a reason the check cannot be compiled.
 * `kind: "agent"` is a successful compile that means "this check is not mechanical".
 */
export async function compileCheckSpec(
  input: CompileCheckSpecInput
): Promise<CompileCheckSpecResult> {
  const t0 = Date.now();
  const capabilities = inventoryFrom(input);
  behavioralInfo("compile_spec_start", {
    checkId: input.checkId,
    catalogSize: input.catalog?.length ?? 0,
    capabilitySize: capabilities.length,
    hasSnapshot: Boolean(input.ariaSnapshot?.trim()),
  });

  const fail = (reason: string, extra?: Record<string, unknown>): CompileCheckSpecResult => {
    behavioralInfo("compile_spec_invalid", {
      checkId: input.checkId,
      ms: Date.now() - t0,
      ...extra,
    });
    return { ok: false, reason };
  };

  const succeed = (spec: BehavioralCheckSpec, via: string): CompileCheckSpecResult => {
    behavioralInfo("compile_spec_done", {
      checkId: input.checkId,
      kind: spec.kind,
      via,
      ms: Date.now() - t0,
    });
    return { ok: true, spec };
  };

  const trySynthesize = (link?: CapabilityLink | null) => {
    const spec = synthesizeAcceptance({
      checkText: input.checkText,
      checkId: input.checkId,
      capabilities,
      link,
    });
    return spec ? stampSpec(spec, input.checkId) : null;
  };

  if (capabilities.length) {
    const heuristic = trySynthesize(null);
    if (heuristic) return succeed(heuristic, "capability_graph");

    const tagged = await tagLeftoverCheckWithLlm({
      check: { id: input.checkId || "check", text: input.checkText },
      capabilities,
    });
    const fromTag = tagged ? trySynthesize(tagged) : null;
    if (fromTag) return succeed(fromTag, "capability_link_llm");

    if (looksSubjectiveCheck(input.checkText)) {
      const agent: BehavioralCheckSpec = {
        id: input.checkId || "check",
        text: input.checkText,
        kind: "agent",
      };
      const stamped = stampSpec(agent, input.checkId);
      if (stamped) return succeed(stamped, "subjective");
    }

    return fail(
      "The compiled procedure was not a valid acceptance spec (invented path or incomplete walkthrough)."
    );
  }

  let parsed: z.infer<typeof compileOutputSchema>;
  try {
    ({ result: parsed } = await createChatCompletionWithStructuredOutput(
      "workflow_evaluation",
      buildCompileMessages(input),
      compileOutputSchema,
      { temperature: 0, maxTokens: 1600 }
    ));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    behavioralInfo("compile_spec_failed", {
      checkId: input.checkId,
      error: reason.slice(0, 400),
      ms: Date.now() - t0,
    });
    const fallback = fallbackUiSpecFromCatalog(input);
    if (fallback) return succeed(fallback, "snapshot_fallback");
    return { ok: false, reason: "The acceptance procedure could not be compiled." };
  }

  const suggestion = { ...parsed, text: input.checkText };
  const grounding = `${input.assessmentDescription}\n${input.ariaSnapshot ?? ""}`;
  let converted = suggestionToSpec(
    input.checkText,
    suggestion,
    grounding,
    input.catalog
  );

  if (
    converted &&
    converted.kind !== "ui" &&
    converted.kind !== "agent" &&
    converted.kind !== "cli" &&
    !checkNamesHttpContract(input.checkText)
  ) {
    behavioralInfo("compile_spec_http_rejected", {
      checkId: input.checkId,
      kind: converted.kind,
    });
    converted = null;
  }

  if (converted) {
    const stamped = stampSpec(converted, input.checkId);
    if (stamped) return succeed(stamped, "llm");
  }

  const fallback = fallbackUiSpecFromCatalog(input);
  if (fallback) {
    const stamped = stampSpec(fallback, input.checkId);
    if (stamped) return succeed(stamped, "snapshot_fallback");
  }

  return fail(
    "The compiled procedure was not a valid acceptance spec (invented path or incomplete walkthrough).",
    { kind: parsed.kind }
  );
}
