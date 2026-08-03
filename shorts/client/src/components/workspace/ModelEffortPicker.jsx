import { useEffect, useRef, useState } from "react";
import { get } from "@/api/requests";

const STORAGE_KEY = "playClaudeModelEffort.v3";

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStored(model, effort) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ model, effort }));
  } catch {
    // ignore
  }
}

/**
 * Claude Code–style /model picker: model list + conditional effort slider.
 * `serverless` drops the effort control (the direct Messages call sends no
 * effort) and is what admits serverless-only models such as Fable 5, which the
 * E2B template's Claude Code CLI cannot run.
 */
export default function ModelEffortPicker({
  value,
  onChange,
  serverless = false,
  engineLabel = "Claude Code",
}) {
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await get("/models");
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        const list = (Array.isArray(body.models) ? body.models : []).filter(
          (m) => serverless || !m.serverlessOnly,
        );
        setModels(list);
        setDefaultModel(body.defaultModel || list[0]?.id || null);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverless]);

  useEffect(() => {
    if (!models.length) return;
    // Also runs when the selected model isn't offered here — e.g. Fable 5 kept
    // in localStorage from a serverless round, then reused on an E2B one.
    if (value?.model && models.some((m) => m.id === value.model)) return;
    const stored = loadStored();
    const modelId =
      (stored?.model && models.some((m) => m.id === stored.model)
        ? stored.model
        : null) ||
      defaultModel ||
      models[0].id;
    const opt = models.find((m) => m.id === modelId) || models[0];
    let effort = stored?.effort ?? opt.defaultEffort;
    if (opt.efforts.length === 0) effort = null;
    else if (effort && !opt.efforts.includes(effort)) {
      effort = opt.defaultEffort;
    }
    onChange({ model: opt.id, effort });
    // Intentionally only when models first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, defaultModel]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected =
    models.find((m) => m.id === value?.model) || models[0] || null;
  const efforts = selected?.efforts || [];
  const effortIndex = Math.max(
    0,
    efforts.indexOf(value?.effort || selected?.defaultEffort || "auto"),
  );

  function selectModel(id) {
    const opt = models.find((m) => m.id === id);
    if (!opt) return;
    const effort =
      opt.efforts.length === 0
        ? null
        : opt.efforts.includes(value?.effort)
          ? value.effort
          : opt.defaultEffort;
    const next = { model: opt.id, effort };
    saveStored(next.model, next.effort);
    onChange(next);
  }

  function setEffortByIndex(idx) {
    if (!selected || efforts.length === 0) return;
    const effort = efforts[Math.min(efforts.length - 1, Math.max(0, idx))];
    const next = { model: selected.id, effort };
    saveStored(next.model, next.effort);
    onChange(next);
  }

  if (!selected) {
    return (
      <span className="text-[11px] text-slate-400">Loading models…</span>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-full items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-50"
        title="Claude Code model and effort"
      >
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {engineLabel}
        </span>
        <span className="truncate font-medium">{selected.label}</span>
        {!serverless && value?.effort && efforts.length > 0 && (
          <span className="truncate text-slate-400">· {value.effort}</span>
        )}
        <span className="text-slate-400" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {engineLabel} · Model
          </p>
          <ul className="mb-2 space-y-0.5">
            {models.map((m) => {
              const active = m.id === selected.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => selectModel(m.id)}
                    className={`flex w-full flex-col rounded px-2 py-1.5 text-left ${
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <span className="text-xs font-medium">{m.label}</span>
                    <span
                      className={`text-[10px] ${
                        active ? "text-slate-300" : "text-slate-500"
                      }`}
                    >
                      {m.description}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {serverless ? null : efforts.length > 0 ? (
            <div className="border-t border-slate-100 px-1 pt-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Effort
                </p>
                <span className="text-[11px] font-medium text-slate-700">
                  {value?.effort || selected.defaultEffort}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={efforts.length - 1}
                step={1}
                value={effortIndex}
                onChange={(e) => setEffortByIndex(Number(e.target.value))}
                className="w-full accent-slate-900"
                aria-label="Effort level"
              />
              <div className="mt-0.5 flex justify-between text-[9px] text-slate-400">
                <span>{efforts[0]}</span>
                <span>{efforts[efforts.length - 1]}</span>
              </div>
            </div>
          ) : (
            <p className="border-t border-slate-100 px-1 pt-2 text-[10px] text-slate-400">
              No effort control for this model
            </p>
          )}
        </div>
      )}
    </div>
  );
}
