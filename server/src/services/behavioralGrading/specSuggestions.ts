/**
 * Turn an LLM's loose acceptance suggestions into strictly-validated
 * `BehavioralCheckSpec`s.
 *
 * The generator is allowed to be wrong here. A suggestion that does not convert
 * cleanly — unknown path shape, no assertion, a sequence with one request — is
 * dropped and the check falls back to the agent judge, which is exactly the
 * behavior an assessment with no specs already has. The cost of a bad spec
 * (confidently failing a correct submission against an interface the assessment
 * never promised) is far higher than the cost of no spec.
 */

import {
  behavioralCheckSpecSchema,
  legacyCheckId,
  type BehavioralCheckSpec,
  type HttpStepSpec,
} from "./checkSpecs.js";
import type { SuggestedAcceptance } from "../schemas/assessmentGeneration.js";

type SuggestedRequest = SuggestedAcceptance["requests"][number];

function toHttpStep(req: SuggestedRequest): HttpStepSpec | null {
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

  return {
    request: {
      method: req.method,
      path: req.path.trim(),
      ...(json === undefined ? {} : { json }),
    },
    expect: {
      ...(status.length ? { status } : {}),
      ...(bodyContains.length ? { bodyContains } : {}),
    },
  };
}

/**
 * Convert suggestions into specs, keeping only those that both parse and name a
 * check that actually exists. Order follows `checks`, not the suggestion list.
 */
export function suggestionsToSpecs(
  checks: string[],
  suggestions: SuggestedAcceptance[] | undefined
): BehavioralCheckSpec[] {
  if (!suggestions?.length) return [];
  const checkByText = new Map(checks.map((c) => [c.trim(), c]));
  const specs: BehavioralCheckSpec[] = [];
  const claimed = new Set<string>();

  for (const suggestion of suggestions) {
    const text = checkByText.get(suggestion.text.trim());
    if (!text || claimed.has(text)) continue;

    const steps = suggestion.requests.map(toHttpStep);
    if (steps.some((s) => s === null)) continue;
    const httpSteps = steps as HttpStepSpec[];

    const base = { id: legacyCheckId(text), text };
    let candidate: unknown;
    if (suggestion.kind === "http") {
      candidate = { ...base, kind: "http", acceptance: httpSteps[0] };
    } else if (suggestion.kind === "http_sequence") {
      if (httpSteps.length < 2) continue;
      candidate = {
        ...base,
        kind: "http_sequence",
        acceptance: { steps: httpSteps },
      };
    } else {
      if (httpSteps.length < 2) continue;
      candidate = {
        ...base,
        kind: "restart_persistence",
        acceptance: { write: httpSteps[0], read: httpSteps[1] },
      };
    }

    const parsed = behavioralCheckSpecSchema.safeParse(candidate);
    if (!parsed.success) continue;
    specs.push(parsed.data);
    claimed.add(text);
  }

  return specs;
}
