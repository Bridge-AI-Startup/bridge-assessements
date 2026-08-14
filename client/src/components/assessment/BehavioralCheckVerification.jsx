/**
 * "How is this verified?" — the per-check verification editor.
 *
 * A behavioral check is a plain sentence. By default an AI reviewer decides
 * whether the submission satisfies it, which is the only option for something
 * like "the layout still works on a phone". But when the assessment already tells
 * the candidate the exact request to expose, the same sentence can be settled by
 * making that request — no model, no judgment, and the recruiter sees the raw
 * response.
 *
 * That is the whole reason this editor exists, so it says so, and it warns when
 * an employer is about to require an interface their instructions never named.
 */

import { useState } from "react";
import { ChevronDown, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const KINDS = [
  {
    value: "agent",
    label: "AI reviewer",
    blurb: "A reviewer agent inspects the running app and the code, then decides.",
  },
  {
    value: "http",
    label: "One request",
    blurb: "Send a single request and check the response.",
  },
  {
    value: "http_sequence",
    label: "Request sequence",
    blurb: "Send requests in order — for example create something, then list it.",
  },
  {
    value: "restart_persistence",
    label: "Write, restart, read back",
    blurb:
      "Write something, restart the app, then read it back. Proves data actually persisted.",
  },
];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const emptyStep = () => ({
  request: { method: "GET", path: "/" },
  expect: { status: [200] },
});

const inputClass =
  "text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#21201C]/20 focus:border-[#21201C]";

/** Steps of a spec as a flat list, whatever shape the kind stores them in. */
function stepsOf(spec) {
  if (!spec) return [];
  if (spec.kind === "http") return [spec.acceptance];
  if (spec.kind === "http_sequence") return spec.acceptance?.steps ?? [];
  if (spec.kind === "restart_persistence") {
    return [spec.acceptance?.write, spec.acceptance?.read].filter(Boolean);
  }
  return [];
}

/** Rebuild a spec of `kind` from a flat step list, padding what the shape needs. */
function withSteps(spec, kind, steps) {
  const base = { id: spec?.id, text: spec?.text };
  const padded = [...steps];
  if (kind === "http") return { ...base, kind, acceptance: padded[0] ?? emptyStep() };
  if (kind === "http_sequence") {
    while (padded.length < 2) padded.push(emptyStep());
    return { ...base, kind, acceptance: { steps: padded } };
  }
  while (padded.length < 2) padded.push(emptyStep());
  return {
    ...base,
    kind,
    acceptance: { write: padded[0], read: padded[1] },
  };
}

function summarize(spec) {
  if (!spec || spec.kind === "agent") return "AI reviewer";
  const steps = stepsOf(spec);
  const first = steps[0];
  const head = first
    ? `${first.request?.method ?? "GET"} ${first.request?.path ?? "/"}`
    : "no request";
  const more = steps.length > 1 ? ` + ${steps.length - 1} more` : "";
  const label = spec.kind === "restart_persistence" ? "restart · " : "";
  return `${label}${head}${more}`;
}

/** Status codes edit as free text so a half-typed "20" is not thrown away. */
function statusText(step) {
  return (step?.expect?.status ?? []).join(", ");
}

function parseStatuses(raw) {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 100 && n <= 599);
}

function StepEditor({ step, label, onChange, onRemove }) {
  const set = (patch) => onChange({ ...step, ...patch });
  const setRequest = (patch) =>
    set({ request: { ...step.request, ...patch } });
  const setExpect = (patch) => set({ expect: { ...step.expect, ...patch } });

  return (
    <div className="rounded-lg border border-gray-200 bg-white/70 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-[10px] text-gray-500">{label}</span>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-gray-500 hover:text-red-600 h-7 w-7 p-0"
            aria-label={`Remove ${label}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <select
          value={step.request?.method ?? "GET"}
          onChange={(e) => setRequest({ method: e.target.value })}
          className={`${inputClass} w-28`}
          aria-label="Method"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={step.request?.path ?? ""}
          onChange={(e) => setRequest({ path: e.target.value })}
          placeholder="/notes"
          className={`${inputClass} flex-1`}
          aria-label="Path"
        />
      </div>
      {step.request?.method !== "GET" && (
        <textarea
          value={
            typeof step.request?.json === "string"
              ? step.request.json
              : step.request?.json != null
                ? JSON.stringify(step.request.json)
                : ""
          }
          onChange={(e) => setRequest({ json: e.target.value })}
          rows={2}
          placeholder={'JSON body, e.g. {"title": "{{nonce}}"}'}
          className={`${inputClass} w-full font-mono text-xs`}
          aria-label="JSON body"
        />
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-1">
            Expected status
          </span>
          <input
            type="text"
            defaultValue={statusText(step)}
            onBlur={(e) => setExpect({ status: parseStatuses(e.target.value) })}
            placeholder="200, 201"
            className={`${inputClass} w-full`}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-1">
            Response must contain
          </span>
          <input
            type="text"
            value={(step.expect?.bodyContains ?? []).join(" | ")}
            onChange={(e) =>
              setExpect({
                bodyContains: e.target.value
                  .split("|")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="{{nonce}}"
            className={`${inputClass} w-full`}
          />
        </label>
      </div>
    </div>
  );
}

export default function BehavioralCheckVerification({ spec, onChange }) {
  const [open, setOpen] = useState(false);
  const kind = spec?.kind ?? "agent";
  const steps = stepsOf(spec);
  const active = kind !== "agent";

  const setKind = (nextKind) => {
    if (nextKind === "agent") {
      onChange(null);
      return;
    }
    onChange(withSteps(spec, nextKind, steps));
  };

  const setStep = (idx, next) => {
    const nextSteps = steps.map((s, i) => (i === idx ? next : s));
    onChange(withSteps(spec, kind, nextSteps));
  };

  const stepLabel = (idx) => {
    if (kind === "restart_persistence") return idx === 0 ? "Write" : "Read back";
    if (kind === "http_sequence") return `Step ${idx + 1}`;
    return "Request";
  };

  return (
    <div className="ml-3.5 mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-800"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span>How is this verified?</span>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
            active
              ? "bg-[#21201C] text-white"
              : "bg-gray-100 text-gray-600 border border-gray-200"
          }`}
        >
          {summarize(spec)}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
          <div className="space-y-1.5">
            {KINDS.map((k) => (
              <label
                key={k.value}
                className="flex items-start gap-2 text-xs text-gray-700"
              >
                <input
                  type="radio"
                  checked={kind === k.value}
                  onChange={() => setKind(k.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-gray-800">{k.label}</span>
                  <span className="block text-gray-500">{k.blurb}</span>
                </span>
              </label>
            ))}
          </div>

          {active && (
            <>
              <p className="flex gap-1.5 text-[11px] leading-relaxed text-gray-500">
                <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Only pin a request your assessment instructions already ask
                  for — a candidate cannot pass an interface you never named.
                  Write <code className="font-mono">{"{{nonce}}"}</code> where a
                  value should be invented at grading time, so an app returning
                  canned data cannot pass.
                </span>
              </p>
              {steps.map((step, idx) => (
                <StepEditor
                  key={idx}
                  step={step}
                  label={stepLabel(idx)}
                  onChange={(next) => setStep(idx, next)}
                  onRemove={
                    kind === "http_sequence" && steps.length > 2
                      ? () =>
                          onChange(
                            withSteps(
                              spec,
                              kind,
                              steps.filter((_, i) => i !== idx)
                            )
                          )
                      : undefined
                  }
                />
              ))}
              {kind === "http_sequence" && steps.length < 8 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onChange(withSteps(spec, kind, [...steps, emptyStep()]))
                  }
                  className="text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add request
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
