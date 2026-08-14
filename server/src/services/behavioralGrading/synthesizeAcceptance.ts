/**
 * Instantiate a purpose template from linked capabilities.
 *
 * The model does not write walkthroughs. Invalid or incomplete links return
 * null — the caller marks the check inconclusive rather than asking the agent
 * judge to invent clicks.
 */

import {
  behavioralCheckSpecSchema,
  legacyCheckId,
  type BehavioralCheckSpec,
  type UiStepSpec,
} from "./checkSpecs.js";
import {
  sourceHint,
  type Capability,
} from "./extractCapabilities.js";
import {
  inferPurpose,
  pickTemplateCaps,
  type CheckPurpose,
  type CapabilityLink,
} from "./linkCheckCapabilities.js";

export function synthesizeAcceptance(input: {
  checkText: string;
  checkId?: string;
  capabilities: Capability[];
  link?: CapabilityLink | null;
}): BehavioralCheckSpec | null {
  if (!input.capabilities.length) return null;
  const purpose = input.link?.purpose ?? inferPurpose(input.checkText);
  if (!purpose) return null;

  const linked = input.link
    ? input.capabilities.filter((c) => input.link!.capabilityIds.includes(c.id))
    : input.capabilities;
  const pool = linked.length ? linked : input.capabilities;
  // Templates still need create/fill siblings that may not be in the tagged
  // subset (a leftover LLM might only return the toggle id).
  const caps = pickTemplateCaps(purpose, [
    ...pool,
    ...input.capabilities.filter((c) => !pool.some((p) => p.id === c.id)),
  ]);

  const spec =
    purpose === "health"
      ? healthSpec(input, caps.health)
      : uiSpec(input, purpose, caps);
  if (!spec) return null;
  const parsed = behavioralCheckSpecSchema.safeParse(spec);
  return parsed.success ? parsed.data : null;
}

function healthSpec(
  input: { checkText: string; checkId?: string },
  health?: Capability
): unknown | null {
  if (!health?.path || !health.method) return null;
  const bodyContains = health.signals.includes("ok") ? ['"ok":true'] : [];
  return {
    id: input.checkId || legacyCheckId(input.checkText),
    text: input.checkText,
    kind: "http" as const,
    acceptance: {
      request: { method: health.method, path: health.path },
      expect: {
        status: [200],
        ...(bodyContains.length ? { bodyContains } : {}),
      },
    },
  };
}

function uiSpec(
  input: { checkText: string; checkId?: string },
  purpose: Exclude<CheckPurpose, "health">,
  caps: ReturnType<typeof pickTemplateCaps>
): unknown | null {
  const fillStep = fillFrom(caps.fill);
  const createClick = namedClick(caps.create);
  if (!fillStep || !createClick) return null;

  const goto: UiStepSpec = { action: "goto", path: "/" };
  const expectNonce: UiStepSpec = { action: "expect_text", text: "{{nonce}}" };
  const steps: UiStepSpec[] = [goto, fillStep, createClick, expectNonce];

  if (purpose === "create") {
    return packUi(input, steps);
  }

  if (purpose === "delete") {
    const del = caps.delete;
    if (!del) return null;
    steps.push(clickInNonceRow(del), {
      action: "expect_text",
      text: "{{nonce}}",
      absent: true,
    });
    return packUi(input, steps);
  }

  const toggle = caps.toggle;
  if (!toggle) return null;
  steps.push(
    clickInNonceRow(toggle, caps.delete),
    { action: "reload" },
    expectNonce
  );
  const doneSignal = doneSignalFrom(toggle);
  if (doneSignal) {
    steps.push({
      action: "expect_in_row",
      hasText: "{{nonce}}",
      text: doneSignal,
    });
  }
  return packUi(input, steps);
}

function packUi(
  input: { checkText: string; checkId?: string },
  steps: UiStepSpec[]
): unknown {
  return {
    id: input.checkId || legacyCheckId(input.checkText),
    text: input.checkText,
    kind: "ui" as const,
    acceptance: { steps },
  };
}

function fillFrom(fill?: Capability): UiStepSpec | null {
  if (!fill || fill.kind !== "ui.fill") return null;
  if (fill.placeholder) {
    return {
      action: "fill_placeholder",
      placeholder: fill.placeholder,
      value: "{{nonce}}",
    };
  }
  return { action: "fill_role", role: "textbox", value: "{{nonce}}" };
}

function namedClick(cap?: Capability): Extract<UiStepSpec, { action: "click_role" }> | null {
  const name = cap?.name?.trim();
  if (!cap || !name) return null;
  const role =
    cap.role === "link" || cap.role === "checkbox" ? cap.role : "button";
  return { action: "click_role", role, name, exact: true };
}

function clickInNonceRow(
  cap: Capability,
  exclude?: Capability
): Extract<UiStepSpec, { action: "click_in_row" }> {
  const role =
    cap.role === "link" || cap.role === "checkbox" ? cap.role : "button";
  const source = sourceHint(cap);
  if (cap.name) {
    return {
      action: "click_in_row",
      hasText: "{{nonce}}",
      role,
      name: cap.name,
      capabilityId: cap.id,
      source,
    };
  }
  return {
    action: "click_in_row",
    hasText: "{{nonce}}",
    role,
    index: 0,
    ...(exclude?.name ? { hasNotName: exclude.name } : {}),
    capabilityId: cap.id,
    source,
  };
}

function doneSignalFrom(toggle: Capability): string | null {
  if (toggle.signals.includes("✓") || toggle.source.snippet.includes("✓")) return "✓";
  if (toggle.name === "✓") return "✓";
  return null;
}
