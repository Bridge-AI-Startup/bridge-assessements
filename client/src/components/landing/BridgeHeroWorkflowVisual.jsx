import { cn } from "@/lib/utils";
import {
  Sparkles,
  Search,
  Code2,
  Bug,
  RefreshCw,
  FlaskConical,
  CheckCircle2,
} from "lucide-react";

/**
 * Hero visual mockup: Bridge analyzing a candidate's workflow.
 * Premium landing-page style — workflow replay + timeline + insights.
 * Structure is animation-ready (events/insights in arrays for stagger/count-up).
 */

/** Event types Bridge detected during the session — shown as a strip, not over the code */
const WORKFLOW_EVENTS = [
  { id: "1", label: "AI Prompt", icon: Sparkles, color: "bg-amber-50 text-amber-700 border-amber-200" },
  { id: "2", label: "Research", icon: Search, color: "bg-blue-50 text-blue-700 border-blue-200" },
  { id: "3", label: "Debug Loop", icon: Bug, color: "bg-rose-50 text-rose-700 border-rose-200" },
  { id: "4", label: "Refactor", icon: RefreshCw, color: "bg-violet-50 text-violet-700 border-violet-200" },
  { id: "5", label: "Test Run", icon: FlaskConical, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
];

const TIMELINE_MARKERS = [
  { label: "Cursor prompt", time: "0:00", type: "ai" },
  { label: "Code edit", time: "2:14", type: "edit" },
  { label: "Google search", time: "4:32", type: "research" },
  { label: "Debugging", time: "6:08", type: "debug" },
  { label: "Refactor", time: "9:45", type: "refactor" },
  { label: "Test run", time: "12:20", type: "test" },
];

const INSIGHT_METRICS = [
  { label: "AI prompts", value: 4 },
  { label: "Research steps", value: 3 },
  { label: "Debug loops", value: 2 },
  { label: "Test runs", value: 5 },
  { label: "Code edits", value: 12 },
];

const STRENGTHS = [
  "Structured problem solving",
  "Efficient debugging",
  "Good use of AI",
];

const CODE_LINES = [
  { text: "function validateInput(data) {", highlight: false },
  { text: "  if (!data?.email) return { ok: false };", highlight: true },
  { text: "  const normalized = data.email.trim().toLowerCase();", highlight: false },
  { text: "  return /^[^@]+@[^@]+\\.[^@]+$/.test(normalized)", highlight: false },
  { text: "    ? { ok: true, email: normalized }", highlight: false },
  { text: "    : { ok: false };", highlight: false },
  { text: "}", highlight: false },
];

export default function BridgeHeroWorkflowVisual({ className }) {
  return (
    <div
      className={cn(
        "w-full max-w-5xl mx-auto rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.06)] overflow-hidden",
        className
      )}
    >
      {/* Top bar: session context */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
        </div>
        <span className="text-xs font-medium text-gray-500">
          Workflow Replay · Candidate session
        </span>
      </div>

      <div className="flex flex-col md:flex-row min-h-0">
        {/* Left: Code panel only — what the candidate was working on */}
        <div className="flex-1 min-w-0 p-4 md:p-5">
          <div className="rounded-xl border border-gray-200/80 bg-gray-50/50 overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200/80 bg-white">
              <span className="text-xs text-gray-500 font-medium">validate.js</span>
              <span className="text-[10px] text-gray-400">· modified</span>
            </div>
            <div className="px-4 py-3 font-mono text-[13px] leading-relaxed text-gray-700 bg-white">
              {CODE_LINES.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-4",
                    line.highlight && "bg-amber-50/70 -mx-4 px-4 border-l-2 border-amber-400/60"
                  )}
                >
                  <span className="select-none w-6 text-right text-gray-400 shrink-0">{i + 1}</span>
                  <span className={line.highlight ? "text-amber-900" : "text-gray-700"}>{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Insights panel */}
        <div className="w-full md:w-56 shrink-0 border-t md:border-t-0 md:border-l border-gray-100 bg-gray-50/40 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Candidate Insights
          </h3>
          <div className="space-y-2.5 mb-4">
            {INSIGHT_METRICS.map((m) => (
              <div
                key={m.label}
                className="flex justify-between items-baseline text-xs"
              >
                <span className="text-gray-600 capitalize">{m.label}</span>
                <span className="font-semibold text-gray-900 tabular-nums">
                  {m.value}
                </span>
              </div>
            ))}
          </div>
          <div className="pt-3 border-t border-gray-200/80">
            <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Strengths
            </h4>
            <ul className="space-y-1.5">
              {STRENGTHS.map((s) => (
                <li
                  key={s}
                  className="flex items-center gap-1.5 text-xs text-gray-700"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Detected events: what Bridge identified during the session */}
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
          Detected during session
        </span>
        <div className="flex flex-wrap gap-2 mt-2">
          {WORKFLOW_EVENTS.map((event) => (
            <span
              key={event.id}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium",
                event.color
              )}
            >
              <event.icon className="w-3 h-3 shrink-0" strokeWidth={2} />
              {event.label}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom: Session timeline — when each event happened */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white">
        <div className="flex items-center gap-2 mb-2">
          <Code2 className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
            Session timeline
          </span>
        </div>
        <div className="relative h-16 flex items-start">
          <div className="absolute left-0 right-0 top-2 h-0.5 bg-gray-200 rounded-full" />
          <div
            className="absolute left-0 top-2 h-0.5 bg-indigo-200/80 rounded-full"
            style={{ width: "78%" }}
          />
          {TIMELINE_MARKERS.map((marker, i) => {
            const pct = (i / (TIMELINE_MARKERS.length - 1)) * 100;
            return (
              <div
                key={i}
                className="absolute flex flex-col items-center text-center"
                style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
              >
                <div
                  className={cn(
                    "w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm shrink-0",
                    marker.type === "ai" && "bg-amber-400",
                    marker.type === "edit" && "bg-blue-400",
                    marker.type === "research" && "bg-sky-400",
                    marker.type === "debug" && "bg-rose-400",
                    marker.type === "refactor" && "bg-violet-400",
                    marker.type === "test" && "bg-emerald-400"
                  )}
                />
                <span className="mt-2 text-[10px] text-gray-500 font-medium tabular-nums block">
                  {marker.time}
                </span>
                <span className="text-[9px] text-gray-400 block w-[78px] leading-tight">
                  {marker.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
