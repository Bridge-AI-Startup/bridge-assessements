/**
 * Turn an LLM's loose acceptance suggestions into strictly-validated
 * `BehavioralCheckSpec`s.
 *
 * The generator is allowed to be wrong here. A suggestion that does not convert
 * cleanly — unknown path shape, no assertion, a sequence with one request — is
 * dropped. At assessment-generation time that leaves the check without a stored
 * spec; at grading time `compileCheckSpec` tries again against the live page
 * rather than letting the agent judge invent a verdict.
 *
 * Invented HTTP paths are dropped on purpose. Failing a candidate against an
 * interface the assessment never promised is worse than leaving the check to
 * compile against what the app actually rendered.
 */

import {
  behavioralCheckSpecSchema,
  legacyCheckId,
  UI_CLICK_ROLES,
  UI_FILL_ROLES,
  type BehavioralCheckSpec,
  type HttpStepSpec,
  type UiStepSpec,
} from "./checkSpecs.js";
import type {
  SuggestedAcceptance,
  SuggestedUiStep,
} from "../schemas/assessmentGeneration.js";
import {
  bindUiStepsToCatalog,
  type UiControl,
} from "./extractUiControls.js";

type SuggestedRequest = NonNullable<SuggestedAcceptance["requests"]>[number];

export function toHttpStep(req: SuggestedRequest): HttpStepSpec | null {
  const status = req.expectStatus?.filter((s) => Number.isInteger(s)) ?? [];
  const bodyContains =
    req.expectBodyContains?.filter((s) => s.trim().length > 0) ?? [];
  if (status.length === 0 && bodyContains.length === 0) return null;

  let json: unknown;
  if (req.jsonBody?.trim()) {
    try {
      json = JSON.parse(req.jsonBody);
    } catch {
      // A body we cannot parse would be sent as something other than what the
      // generator intended; drop the whole suggestion rather than guess.
      return null;
    }
  }

  const path = req.path.trim();
  if (!path.startsWith("/") || path.includes("..") || /^\w+:\/\//.test(path)) {
    return null;
  }

  return {
    request: {
      method: req.method,
      path,
      ...(json === undefined ? {} : { json }),
    },
    expect: {
      ...(status.length ? { status } : {}),
      ...(bodyContains.length ? { bodyContains } : {}),
    },
  };
}

export function toUiStep(step: SuggestedUiStep): UiStepSpec | null {
  if (step.action === "goto") {
    const path = (step.path ?? "/").trim() || "/";
    if (!path.startsWith("/") || path.includes("..")) return null;
    return { action: "goto", path };
  }
  if (step.action === "click_role") {
    const role = step.role;
    const name = step.name?.trim() || step.text?.trim();
    if (!role || !name) return null;
    if (!(UI_CLICK_ROLES as readonly string[]).includes(role)) return null;
    return {
      action: "click_role",
      role: role as (typeof UI_CLICK_ROLES)[number],
      name,
      exact: true,
    };
  }
  if (step.action === "click_text") {
    const text = step.text?.trim();
    if (!text) return null;
    return { action: "click_text", text };
  }
  if (step.action === "fill_placeholder") {
    const placeholder = step.placeholder?.trim();
    const value = step.value ?? "";
    if (!placeholder) return null;
    return { action: "fill_placeholder", placeholder, value };
  }
  if (step.action === "fill_role") {
    const role = step.role;
    if (!role || !(UI_FILL_ROLES as readonly string[]).includes(role)) return null;
    return {
      action: "fill_role",
      role: role as (typeof UI_FILL_ROLES)[number],
      value: step.value ?? "",
      ...(step.name?.trim() ? { name: step.name.trim() } : {}),
    };
  }
  const text = step.text?.trim();
  if (!text) return null;
  return {
    action: "expect_text",
    text,
    ...(step.absent ? { absent: true } : {}),
  };
}

/**
 * An HTTP path is grounded when it already appears in the assessment text or
 * the live page snapshot. "/" is always allowed.
 */
export function httpPathIsGrounded(path: string, context: string): boolean {
  const trimmed = path.trim();
  if (trimmed === "/") return true;
  const hay = context.toLowerCase();
  const needle = trimmed.toLowerCase();
  if (hay.includes(needle)) return true;
  const noSlash = needle.replace(/\/$/, "");
  return noSlash.length > 1 && hay.includes(noSlash);
}

export function suggestionToSpec(
  text: string,
  suggestion: SuggestedAcceptance,
  groundingContext?: string,
  catalog?: UiControl[]
): BehavioralCheckSpec | null {
  const base = { id: legacyCheckId(text), text };

  if (suggestion.kind === "agent") {
    return { ...base, kind: "agent" };
  }

  if (suggestion.kind === "ui") {
    const raw = suggestion.uiSteps ?? [];
    const steps = raw.map(toUiStep);
    if (!steps.length || steps.some((s) => s === null)) return null;
    let uiSteps = steps as UiStepSpec[];
    if (catalog) {
      const bound = bindUiStepsToCatalog(uiSteps, catalog);
      if (!bound) return null;
      uiSteps = bound;
    }
    const candidate = {
      ...base,
      kind: "ui" as const,
      acceptance: { steps: uiSteps },
    };
    const parsed = behavioralCheckSpecSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  const rawRequests = suggestion.requests ?? [];
  const steps = rawRequests.map(toHttpStep);
  if (steps.some((s) => s === null)) return null;
  const httpSteps = steps as HttpStepSpec[];
  if (!httpSteps.length) return null;

  if (groundingContext !== undefined) {
    const grounded = httpSteps.every((s) =>
      httpPathIsGrounded(s.request.path, groundingContext)
    );
    if (!grounded) return null;
  }

  let candidate: unknown;
  if (suggestion.kind === "http") {
    candidate = { ...base, kind: "http", acceptance: httpSteps[0] };
  } else if (suggestion.kind === "http_sequence") {
    if (httpSteps.length < 2) return null;
    candidate = {
      ...base,
      kind: "http_sequence",
      acceptance: { steps: httpSteps },
    };
  } else {
    if (httpSteps.length < 2) return null;
    candidate = {
      ...base,
      kind: "restart_persistence",
      acceptance: { write: httpSteps[0], read: httpSteps[1] },
    };
  }

  const parsed = behavioralCheckSpecSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Convert suggestions into specs, keeping only those that both parse and name a
 * check that actually exists. Order follows `checks`, not the suggestion list.
 */
export function suggestionsToSpecs(
  checks: string[],
  suggestions: SuggestedAcceptance[] | undefined,
  groundingContext?: string,
  catalog?: UiControl[]
): BehavioralCheckSpec[] {
  if (!suggestions?.length) return [];
  const checkByText = new Map(checks.map((c) => [c.trim(), c]));
  const specs: BehavioralCheckSpec[] = [];
  const claimed = new Set<string>();

  for (const suggestion of suggestions) {
    const text = checkByText.get(suggestion.text.trim());
    if (!text || claimed.has(text)) continue;
    const spec = suggestionToSpec(text, suggestion, groundingContext, catalog);
    if (!spec || spec.kind === "agent") continue;
    specs.push(spec);
    claimed.add(text);
  }

  return specs;
}
