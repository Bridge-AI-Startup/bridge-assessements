import { Loader2, CheckCircle2, Circle, XCircle, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function stepIcon(status) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />;
  }
  if (status === "done") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />;
  }
  return <Circle className="h-3.5 w-3.5 shrink-0 text-gray-300" />;
}

function verdictIcon(verdict) {
  if (verdict === "pass") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />;
  }
  if (verdict === "fail") {
    return <XCircle className="h-4 w-4 shrink-0 text-red-600" />;
  }
  return <HelpCircle className="h-4 w-4 shrink-0 text-amber-600" />;
}

function verdictBadgeClass(verdict) {
  if (verdict === "pass") return "bg-green-100 text-green-700";
  if (verdict === "fail") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-800";
}

/**
 * Live trace while behavioral grading is pending — criteria + agent tool steps.
 */
export default function BehavioralGradingLiveTrace({ progress, behavioralChecks = [] }) {
  const checksTotal =
    progress?.checksTotal ?? (behavioralChecks.length > 0 ? behavioralChecks.length : 0);
  const completed = progress?.completedChecks ?? [];
  const currentIndex = progress?.checkIndex;
  const currentText =
    progress?.checkText ??
    (currentIndex != null ? behavioralChecks[currentIndex] : null);
  const agentSteps = progress?.agentSteps ?? [];
  const phaseLabel = progress?.phaseLabel ?? "Starting behavioral grading…";
  const doneCount = completed.length;
  const pct = checksTotal > 0 ? Math.round((doneCount / checksTotal) * 100) : 0;

  return (
    <div className="rounded-lg border border-amber-200 bg-gradient-to-b from-amber-50/80 to-white p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-700" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-950">Agent running in sandbox</p>
            <p className="text-xs text-amber-800/90 truncate">{phaseLabel}</p>
          </div>
        </div>
        {checksTotal > 0 && (
          <span className="text-xs text-amber-800 shrink-0 tabular-nums">
            {doneCount}/{checksTotal} checks
          </span>
        )}
      </div>

      {checksTotal > 0 && (
        <div className="h-1.5 w-full rounded-full bg-amber-100 overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {completed.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Completed
          </p>
          {completed.map((c) => (
            <div
              key={c.checkIndex}
              className="flex items-start gap-2 rounded border border-gray-100 bg-white px-2 py-1.5"
            >
              {verdictIcon(c.verdict)}
              <span className="flex-1 text-xs text-gray-700 leading-snug">{c.checkText}</span>
              <Badge className={`shrink-0 text-[10px] ${verdictBadgeClass(c.verdict)}`}>
                {c.verdict}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {(currentIndex != null || agentSteps.length > 0) && (
        <div className="rounded border border-amber-100 bg-white p-2.5 space-y-2">
          {currentText && (
            <p className="text-xs font-medium text-gray-900 leading-snug">
              <span className="text-gray-500 font-normal">Checking: </span>
              {currentText}
            </p>
          )}
          {agentSteps.length > 0 && (
            <ol className="space-y-2">
              {agentSteps.map((step, i) => (
                <li key={`${step.iteration}-${step.tool}-${i}`} className="flex gap-2">
                  {stepIcon(step.status)}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-gray-800">
                      <span className="font-mono text-gray-500">#{step.iteration}</span>{" "}
                      <span className="font-medium">{step.tool}</span>
                      {step.detail ? (
                        <span className="text-gray-600"> — {step.detail}</span>
                      ) : null}
                    </p>
                    {step.outputPreview && step.status === "done" && (
                      <pre className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-[10px] text-gray-600 font-mono">
                        {step.outputPreview}
                      </pre>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {!progress && behavioralChecks.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Queued checks
          </p>
          {behavioralChecks.map((text, i) => (
            <p key={i} className="text-xs text-gray-500 pl-2 border-l-2 border-gray-200">
              {text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
