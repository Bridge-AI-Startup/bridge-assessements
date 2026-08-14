/**
 * How a behavioral check is verified.
 *
 * `assessment.behavioralChecks` stays a plain `[String]` — the stack-agnostic
 * sentence an employer, a candidate and a recruiter all read. Alongside it,
 * `behavioralCheckSpecs` may pin *how* a given sentence is checked, so a
 * mechanical requirement ("POST /notes rejects a blank title with a 400") is
 * settled by making the request rather than by asking a model to reason about it.
 *
 * Two rules keep this honest:
 *
 *  - **The sentence list is authoritative.** A spec only takes effect when its
 *    `text` still matches a check on the assessment. A spec left behind by an
 *    edited or deleted check grades nothing.
 *  - **Never read the raw field.** Resolve through `resolveBehavioralCheckSpecs`,
 *    following the precedent in `utils/evidenceMode.ts`: the server-wide switch
 *    always wins downward, so a deployment with deterministic checks disabled
 *    quietly falls back to the agent judge instead of skipping the check.
 *
 * The `{{nonce}}` placeholder is what makes a spec resistant to a hardcoded
 * response: the runner substitutes a value invented at grading time, so an app
 * that returns canned fixtures cannot echo it back.
 */

import { createHash } from "crypto";
import { z } from "zod";

const NONCE_TOKEN = "{{nonce}}";

/** Request path only — never a full URL; the runner supplies the origin. */
const requestPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((p) => p.startsWith("/"), { message: "path must start with /" })
  .refine((p) => !/^\w+:\/\//.test(p), { message: "path must not include an origin" })
  .refine((p) => !p.includes(".."), { message: "path must not traverse" });

const httpRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  path: requestPathSchema,
  headers: z.record(z.string().max(200)).optional(),
  /** Sent as JSON. Mutually exclusive with `body` in practice; `json` wins. */
  json: z.unknown().optional(),
  body: z.string().max(20_000).optional(),
});

const jsonPathExpectationSchema = z.object({
  /** Dotted path with numeric indices, e.g. `notes.0.title`. */
  path: z.string().min(1).max(200),
  equals: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]).optional(),
  contains: z.string().min(1).max(2000).optional(),
  /** Assert only that something is present at the path. */
  exists: z.boolean().optional(),
});

const httpExpectationSchema = z
  .object({
    status: z.array(z.number().int().min(100).max(599)).min(1).max(10).optional(),
    bodyContains: z.array(z.string().min(1).max(2000)).max(10).optional(),
    bodyNotContains: z.array(z.string().min(1).max(2000)).max(10).optional(),
    bodyMatches: z.string().min(1).max(500).optional(),
    json: z.array(jsonPathExpectationSchema).max(10).optional(),
  })
  .refine(
    (e) =>
      Boolean(
        e.status?.length ||
          e.bodyContains?.length ||
          e.bodyNotContains?.length ||
          e.bodyMatches ||
          e.json?.length
      ),
    { message: "expectation must assert something" }
  );

const httpStepSchema = z.object({
  label: z.string().max(120).optional(),
  request: httpRequestSchema,
  expect: httpExpectationSchema,
});

const cliExpectationSchema = z
  .object({
    exitCode: z.number().int().min(0).max(255).optional(),
    stdoutContains: z.array(z.string().min(1).max(2000)).max(10).optional(),
    stdoutNotContains: z.array(z.string().min(1).max(2000)).max(10).optional(),
    stdoutMatches: z.string().min(1).max(500).optional(),
  })
  .refine(
    (e) =>
      e.exitCode != null ||
      Boolean(e.stdoutContains?.length || e.stdoutNotContains?.length || e.stdoutMatches),
    { message: "expectation must assert something" }
  );

/** Roles that Playwright can type into. Specs must not depend on CSS. */
export const UI_FILL_ROLES = ["textbox", "searchbox", "combobox"] as const;

/** Roles that Playwright can click by accessible name. Prefer over `click_text`. */
export const UI_CLICK_ROLES = ["button", "link", "checkbox"] as const;

const uiStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), path: requestPathSchema }),
  z.object({
    action: z.literal("click_role"),
    role: z.enum(UI_CLICK_ROLES),
    name: z.string().min(1).max(200),
    exact: z.boolean().optional(),
  }),
  /** Leftover: resolved through the source catalog at grade time, never via getByText. */
  z.object({ action: z.literal("click_text"), text: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("click_in_row"),
    hasText: z.string().min(1).max(500),
    role: z.enum(UI_CLICK_ROLES).default("button"),
    name: z.string().min(1).max(200).optional(),
    hasNotName: z.string().min(1).max(200).optional(),
    index: z.number().int().min(0).max(20).optional(),
    capabilityId: z.string().max(120).optional(),
    source: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal("reload") }),
  z.object({
    action: z.literal("fill_role"),
    role: z.enum(UI_FILL_ROLES),
    name: z.string().max(200).optional(),
    exact: z.boolean().optional(),
    value: z.string().max(2000),
  }),
  z.object({
    action: z.literal("fill_placeholder"),
    placeholder: z.string().min(1).max(200),
    value: z.string().max(2000),
  }),
  z.object({
    action: z.literal("fill"),
    selector: z.string().min(1).max(400),
    value: z.string().max(2000),
  }),
  z.object({
    action: z.literal("expect_text"),
    text: z.string().min(1).max(500),
    /** Assert the text is absent instead of present. */
    absent: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("expect_in_row"),
    hasText: z.string().min(1).max(500),
    text: z.string().min(1).max(500),
    absent: z.boolean().optional(),
  }),
]);

const checkIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "id must be url-safe");

const specBase = {
  id: checkIdSchema,
  /** Must match a sentence in assessment.behavioralChecks to take effect. */
  text: z.string().min(1).max(2000),
};

export const behavioralCheckSpecSchema = z.discriminatedUnion("kind", [
  z.object({ ...specBase, kind: z.literal("agent") }),
  z.object({
    ...specBase,
    kind: z.literal("http"),
    acceptance: httpStepSchema,
  }),
  z.object({
    ...specBase,
    kind: z.literal("http_sequence"),
    acceptance: z.object({ steps: z.array(httpStepSchema).min(2).max(8) }),
  }),
  z.object({
    ...specBase,
    kind: z.literal("restart_persistence"),
    acceptance: z.object({
      /** Create something identifiable, restart the app, then read it back. */
      write: httpStepSchema,
      read: httpStepSchema,
    }),
  }),
  z.object({
    ...specBase,
    kind: z.literal("cli"),
    acceptance: z.object({
      command: z.string().min(1).max(2000),
      expect: cliExpectationSchema,
    }),
  }),
  z.object({
    ...specBase,
    kind: z.literal("ui"),
    acceptance: z.object({ steps: z.array(uiStepSchema).min(1).max(16) }),
  }),
]);

export type BehavioralCheckSpec = z.infer<typeof behavioralCheckSpecSchema>;
export type BehavioralCheckKind = BehavioralCheckSpec["kind"];
export type HttpStepSpec = z.infer<typeof httpStepSchema>;
export type HttpExpectation = z.infer<typeof httpExpectationSchema>;
export type CliExpectation = z.infer<typeof cliExpectationSchema>;
export type UiStepSpec = z.infer<typeof uiStepSchema>;

export const behavioralCheckSpecsSchema = z.array(behavioralCheckSpecSchema).max(30);

/**
 * Deterministic id for a check that has no spec of its own. Derived from the
 * sentence, so reordering the list does not renumber anything; editing the
 * sentence does produce a new id, which is correct — it is a different check.
 */
export function legacyCheckId(text: string): string {
  const digest = createHash("sha1").update(text.trim()).digest("hex").slice(0, 10);
  return `check-${digest}`;
}

/** When unset, deterministic acceptance runs. Set to false to force the agent judge everywhere. */
export function isDeterministicCheckingEnabled(): boolean {
  const raw = process.env.BEHAVIORAL_DETERMINISTIC_CHECKS_ENABLED;
  if (!raw?.trim()) return true;
  return raw === "1" || raw.toLowerCase() === "true";
}

export type SpecParseResult = {
  specs: BehavioralCheckSpec[];
  /** Specs that failed validation, with the reason, so a bad edit is visible rather than silent. */
  rejected: Array<{ index: number; reason: string }>;
};

/** Validate raw stored specs, dropping (and reporting) any that do not parse. */
export function parseBehavioralCheckSpecs(raw: unknown): SpecParseResult {
  if (!Array.isArray(raw)) return { specs: [], rejected: [] };
  const specs: BehavioralCheckSpec[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const seenIds = new Set<string>();

  raw.forEach((entry, index) => {
    const parsed = behavioralCheckSpecSchema.safeParse(entry);
    if (!parsed.success) {
      rejected.push({
        index,
        reason: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    if (seenIds.has(parsed.data.id)) {
      rejected.push({ index, reason: `duplicate id "${parsed.data.id}"` });
      return;
    }
    seenIds.add(parsed.data.id);
    specs.push(parsed.data);
  });

  return { specs, rejected };
}

type AssessmentLike = {
  behavioralChecks?: unknown;
  behavioralCheckSpecs?: unknown;
};

export type ResolvedCheckSpecs = {
  /** One entry per sentence in behavioralChecks, in the same order. */
  specs: BehavioralCheckSpec[];
  rejected: Array<{ index: number; reason: string }>;
  /** Specs stored for a sentence that is no longer on the assessment. */
  orphanedSpecIds: string[];
  /** True when the server-wide switch forced everything to the agent judge. */
  downgradedByFlag: boolean;
};

/**
 * The only way grading should learn how to verify a check.
 *
 * Always returns one spec per behavioral check, defaulting to `kind: "agent"`,
 * so an assessment that has never seen a spec behaves exactly as it does today.
 */
export function resolveBehavioralCheckSpecs(
  assessment: AssessmentLike
): ResolvedCheckSpecs {
  const checks = Array.isArray(assessment.behavioralChecks)
    ? assessment.behavioralChecks.filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0
      )
    : [];
  const { specs: stored, rejected } = parseBehavioralCheckSpecs(
    assessment.behavioralCheckSpecs
  );
  const deterministic = isDeterministicCheckingEnabled();

  const byText = new Map<string, BehavioralCheckSpec>();
  for (const spec of stored) {
    // First spec wins for a repeated sentence; a duplicate sentence is a single check.
    if (!byText.has(spec.text.trim())) byText.set(spec.text.trim(), spec);
  }

  const usedTexts = new Set<string>();
  const specs = checks.map((text) => {
    const trimmed = text.trim();
    const match = byText.get(trimmed);
    if (!match) {
      return { id: legacyCheckId(trimmed), text, kind: "agent" as const };
    }
    usedTexts.add(trimmed);
    if (!deterministic && match.kind !== "agent") {
      return { id: match.id, text, kind: "agent" as const };
    }
    // Carry the assessment's wording, not the spec's copy of it, so the sentence
    // the recruiter reads and the sentence grading judges are the same string.
    return { ...match, text } as BehavioralCheckSpec;
  });

  const orphanedSpecIds = stored
    .filter((s) => !usedTexts.has(s.text.trim()))
    .map((s) => s.id);

  return {
    specs,
    rejected,
    orphanedSpecIds,
    downgradedByFlag: !deterministic && stored.some((s) => s.kind !== "agent"),
  };
}

/** Whether a resolved spec can be settled without an LLM call. */
export function isDeterministicSpec(spec: BehavioralCheckSpec): boolean {
  return spec.kind !== "agent";
}

/**
 * Substitute `{{nonce}}` throughout a spec fragment. A value invented per run is
 * what separates "the app stored my note" from "the app returns a fixed list".
 */
export function applyNonce<T>(value: T, nonce: string): T {
  if (typeof value === "string") {
    return value.split(NONCE_TOKEN).join(nonce) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => applyNonce(v, nonce)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = applyNonce(v, nonce);
    }
    return out as unknown as T;
  }
  return value;
}

export function specUsesNonce(spec: BehavioralCheckSpec): boolean {
  return JSON.stringify(spec).includes(NONCE_TOKEN);
}
