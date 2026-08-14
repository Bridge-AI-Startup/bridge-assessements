import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  CheckCircle,
  Clock,
  TrendingDown,
  Search,
  Filter,
  Eye,
  ArrowUpRight,
  ArrowDownRight,
  MessageSquare,
  Trash2,
  Copy,
  Check,
  Send,
  Share2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  BarChart3,
  Loader2,
  Code2,
  Terminal,
  CheckCircle2,
  Circle,
  Play,
  Download,
  Archive,
  FileText,
  Camera,
  Pencil,
  MoreHorizontal,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Link, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  getSubmissionsForAssessment,
  deleteSubmission,
  sendInvites,
  generateShareLink,
  runBehavioralGrading,
  getBehavioralArtifactBlob,
  downloadSubmissionCodeArchive,
  exportAssessmentEvidenceZip,
} from "@/api/submission";
import { runSubmissionEvaluation } from "@/api/evaluation";
import VideoTimelineWithCriteria from "@/components/proctoring/VideoTimelineWithCriteria";
import BehavioralGradingLiveTrace from "@/components/submissions/BehavioralGradingLiveTrace";
import EvidenceMomentChips from "@/components/submissions/EvidenceMomentChips";
import WorkflowActivityTimeline from "@/components/submissions/WorkflowActivityTimeline";
import CommunicationCard from "@/components/submissions/CommunicationCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { BulkInviteContent } from "@/components/BulkInviteModal";
import { getAssessment } from "@/api/assessment";
import {
  getSessionBySubmission,
  getTranscriptContent,
  getProctoringVideoPlaybackUrl,
  downloadProctoringVideo,
  getCompanionTranscript,
} from "@/api/proctoring";
import { onAuthStateChanged } from "firebase/auth";
import {
  getCaptureSessionBySubmission,
  getWorkflowAnalysis,
  workflowVideoUrl,
} from "@/api/workflowCapture";
import { auth } from "@/firebase/firebase";

/** Format seconds since session start as m:ss (e.g. 65 -> "1:05"). */
function formatSecondsSinceStart(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * After this long, an evaluation still marked "pending" is assumed abandoned
 * rather than slow. Comfortably past the server's own worst case (an ~8 minute
 * transcript budget plus ~4 minutes of grading), so a genuinely long run is
 * never restarted underneath itself.
 */
const STALE_PENDING_MS = 20 * 60 * 1000;

/**
 * Headline for a capture that did not run cleanly through to submission.
 *
 * Deliberately descriptive rather than accusatory — capture also stops because
 * a laptop slept or a network dropped, and the reviewer is the one who decides
 * what it means. The server's own `note` carries the specifics.
 */
const CAPTURE_STATUS_LABEL = {
  stopped_early: "Capture stopped before the work was submitted",
  sparse: "Only part of this session appears to have been captured",
  missing: "No workflow activity was captured",
};

/** Proctoring / recording rubric average on 0–10; null if no evaluable criteria. */
function getRecordingRubricAvg10(sub) {
  const evaluable =
    sub.evaluationReport?.criteria_results?.filter((r) => r.evaluable) ?? [];
  if (evaluable.length === 0) return null;
  const sum = evaluable.reduce((s, r) => s + r.score, 0);
  return sum / evaluable.length;
}

function getRecordingRubric0to100(sub) {
  const avg = getRecordingRubricAvg10(sub);
  return avg == null ? null : avg * 10;
}

/**
 * True when there is anything to open the review surface for. A candidate who
 * never started has no recording, no code and no scores, so the row stays inert
 * rather than opening an empty dialog.
 */
function hasReviewableEvidence(sub) {
  if (!sub) return false;
  return Boolean(
    sub.startedAt ||
      sub.submittedAt ||
      sub.status === "submitted" ||
      sub.status === "in-progress" ||
      sub.status === "expired" ||
      sub.optedOut ||
      sub.evaluationReport ||
      sub.behavioralGradingStatus
  );
}

/** True when workflow rubric scores exist (used to default the evaluation modal tab). */
function hasEvaluableWorkflowReport(sub) {
  const n =
    sub?.evaluationReport?.criteria_results?.filter((r) => r.evaluable)
      ?.length ?? 0;
  return n > 0;
}

/** Behavioral checks → 0–100 (pass=1, inconclusive=0.5, fail=0), when grading completed. */
function getBehavioralPass0to100(sub) {
  if (sub.behavioralGradingStatus !== "completed") return null;
  // Setup failure = grading environment problem, not candidate performance;
  // the mostly-inconclusive verdicts it produces must not average in as ~50%.
  if (sub.behavioralGradingReport?.failureCategory === "setup") return null;
  const cases = sub.behavioralGradingReport?.cases;
  if (!Array.isArray(cases) || cases.length === 0) return null;
  let pts = 0;
  for (const c of cases) {
    if (c.verdict === "pass") pts += 1;
    else if (c.verdict === "inconclusive") pts += 0.5;
  }
  return (pts / cases.length) * 100;
}

/**
 * Combined employer-facing score (0–100): mean of available signals —
 * process rubric (how they worked) and behavioral pass rate (did the thing work).
 */
function getCombinedScore0to100(sub) {
  const parts = [
    getRecordingRubric0to100(sub),
    getBehavioralPass0to100(sub),
  ].filter((v) => v != null);
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function getCombinedScoreBreakdownParts(sub) {
  const segs = [];
  const rec = getRecordingRubric0to100(sub);
  const beh = getBehavioralPass0to100(sub);
  if (rec != null) segs.push(`Process ${(rec / 10).toFixed(1)}/10`);
  if (beh != null) segs.push(`Behavioral ${Math.round(beh)}%`);
  return segs;
}

/** Failed / passed behavioral checks for the Summary "did it work" card. */
function getBehavioralCheckHighlights(sub) {
  const status = sub?.behavioralGradingStatus;
  if (!status) return null;
  if (status === "pending") return { status: "pending" };
  if (status === "failed") {
    return { status: "failed", error: sub.behavioralGradingError || null };
  }
  if (status !== "completed") return { status };
  if (sub.behavioralGradingReport?.failureCategory === "setup") {
    return { status: "setup" };
  }
  const cases = sub.behavioralGradingReport?.cases;
  if (!Array.isArray(cases) || cases.length === 0) return { status: "empty" };
  const failed = cases
    .filter((c) => c.verdict === "fail")
    .map((c) => c.checkText)
    .filter(Boolean);
  const passed = cases.filter((c) => c.verdict === "pass").length;
  const inconclusive = cases.filter((c) => c.verdict === "inconclusive").length;
  return {
    status: "completed",
    passed,
    failed,
    inconclusive,
    total: cases.length,
  };
}

/**
 * Capture-trust warning. Silent when the record is clean. Lives above the
 * rubric so a reviewer cannot read an 8 and only then learn citations dropped.
 */
function EvidenceIntegrityBanner({ report }) {
  const integrity = report?.evidenceIntegrity;
  if (!integrity) return null;
  const capture = integrity.capture;
  const incomplete = capture && capture.status !== "complete";
  const dropped = integrity.citationsDropped ?? 0;
  const invalidated = integrity.invalidatedCriteria ?? [];
  if (!incomplete && dropped === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
      {incomplete && (
        <div className="flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-900">
              {CAPTURE_STATUS_LABEL[capture.status] ??
                "Capture may be incomplete"}
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">
              {capture.note}
            </p>
          </div>
        </div>
      )}
      {dropped > 0 && (
        <div className="flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-900">
              {dropped} cited moment
              {dropped === 1 ? "" : "s"} could not be matched to captured
              activity
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">
              {integrity.citationsKept ?? 0} citation
              {(integrity.citationsKept ?? 0) === 1 ? "" : "s"} verified and
              kept.
              {invalidated.length > 0
                ? ` Scores withheld for: ${invalidated.join(", ")}.`
                : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact product result on Summary — which checks failed, without the sandbox log. */
function BehavioralProductCard({ highlights, onSeeCode }) {
  if (!highlights) return null;
  const failed = highlights.failed || [];
  const shown = failed.slice(0, 3);
  const extra = failed.length - shown.length;

  let body = null;
  if (highlights.status === "pending") {
    body = (
      <p className="text-sm text-gray-600">Checks are still running.</p>
    );
  } else if (highlights.status === "failed") {
    body = (
      <p className="text-sm text-amber-800">
        {highlights.error || "Product checks could not finish."}
      </p>
    );
  } else if (highlights.status === "setup") {
    body = (
      <p className="text-sm text-amber-800">
        Checks could not be run — the grading environment failed to start the
        project.
      </p>
    );
  } else if (highlights.status === "empty") {
    body = (
      <p className="text-sm text-gray-600">No product checks on this assessment.</p>
    );
  } else if (highlights.status === "completed") {
    body = (
      <>
        <p className="text-sm text-gray-800">
          {highlights.passed} of {highlights.total} check
          {highlights.total === 1 ? "" : "s"} passed
          {highlights.inconclusive > 0
            ? ` · ${highlights.inconclusive} inconclusive`
            : ""}
        </p>
        {shown.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {shown.map((text) => (
              <li key={text} className="text-xs text-gray-700 leading-snug">
                <span className="text-red-700 font-medium">Failed · </span>
                {text}
              </li>
            ))}
            {extra > 0 ? (
              <li className="text-xs text-gray-500">
                +{extra} more on Code
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-gray-500">All checks passed.</p>
        )}
      </>
    );
  } else {
    return null;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
          What they built
        </p>
        {typeof onSeeCode === "function" ? (
          <button
            type="button"
            onClick={onSeeCode}
            className="text-[11px] font-medium text-gray-600 hover:text-gray-900 hover:underline shrink-0"
          >
            Details on Code
          </button>
        ) : null}
      </div>
      <div className="mt-2">{body}</div>
    </div>
  );
}

/** True if agent ran inline / heredoc style commands — compare citations to read_file / seed, not probe stdout alone. */
function behavioralAgentTraceLooksProbed(agentTrace) {
  if (!Array.isArray(agentTrace)) return false;
  return agentTrace.some(
    (t) =>
      t.tool === "run_command" &&
      typeof t.detail === "string" &&
      (/python\s+-c\b/i.test(t.detail) ||
        /<<['"]?\w+['"]?/i.test(t.detail) ||
        /\bnode\s+-e\b/i.test(t.detail))
  );
}

/**
 * Human-readable view of the stateful/chunked enriched transcript
 * (session narrative + timeline of behavioral events).
 */
function EnrichedTranscriptView({ enriched }) {
  const narrative = enriched?.session_narrative?.trim();
  const events = Array.isArray(enriched?.events) ? enriched.events : [];
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 max-h-[40vh] overflow-y-auto space-y-4">
      {narrative ? (
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase font-mono tracking-[0.03em] mb-1">Session summary</p>
          <p className="text-sm text-gray-800 leading-relaxed">{narrative}</p>
        </div>
      ) : null}
      {events.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase font-mono tracking-[0.03em] mb-2">Activity timeline</p>
          <ul className="space-y-3">
            {events.map((evt, idx) => (
              <li key={idx} className="border-l-2 border-blue-200 pl-3 py-0.5">
                <span className="text-xs text-gray-500 font-medium">
                  {formatSecondsSinceStart(evt.ts)} – {formatSecondsSinceStart(evt.ts_end)}
                  {evt.ai_tool ? ` · ${evt.ai_tool}` : ""}
                </span>
                <p className="text-sm text-gray-800 mt-0.5">{evt.behavioral_summary}</p>
                {evt.intent ? (
                  <p className="text-xs text-gray-500 mt-0.5 italic">{evt.intent}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!narrative && events.length === 0 ? (
        <p className="text-sm text-gray-500">No activity summary available.</p>
      ) : null}
    </div>
  );
}

/** Evidence blocks + screenshots for one behavioral grading case (inline or modal). */
function BehavioralCaseEvidenceBody({
  caseResult,
  behavioralArtifactsLoading,
  behavioralArtifactUrls,
}) {
  return (
    <>
      <div className="space-y-2">
        {(caseResult.evidence || []).map((entry, i) => (
          <div
            key={entry.id || i}
            className="bg-gray-50 border border-gray-100 rounded p-2 text-xs"
          >
            <p className="font-medium text-gray-800">
              {entry.type} {entry.success ? "✓" : "✗"}
            </p>
            {entry.type === "judge" && entry.rationale && (
              <div className="mt-1 space-y-1">
                <p className="text-gray-700 leading-snug">{entry.rationale}</p>
                {Array.isArray(entry.citations) && entry.citations.length > 0 && (
                  <ul className="list-disc pl-4 text-gray-600 space-y-0.5">
                    {entry.citations.map((c, ci) => (
                      <li key={ci} className="break-words">
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
                {entry.type === "judge" &&
                  behavioralAgentTraceLooksProbed(entry.agentTrace) && (
                    <p className="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2 leading-snug">
                      A probe-style run_command was used (e.g. python -c). Treat
                      citations as proof of the candidate&apos;s repo only if the
                      same text appears in read_file output or the seed source
                      excerpt—expand Agent tool trace and compare.
                    </p>
                  )}
                {Array.isArray(entry.agentTrace) && entry.agentTrace.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-gray-600 font-medium">
                      Agent tool trace ({entry.agentTrace.length} steps)
                    </summary>
                    <div className="mt-2 space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded p-2 bg-white">
                      {entry.agentTrace.map((step, si) => (
                        <div
                          key={si}
                          className="border-b border-gray-100 pb-2 last:border-0 last:pb-0"
                        >
                          <p className="text-[10px] text-gray-500">
                            #{step.iteration} {step.tool} {step.success ? "✓" : "✗"}
                          </p>
                          <p className="font-mono text-[10px] text-gray-800 break-all">
                            {step.detail}
                          </p>
                          <pre className="mt-1 whitespace-pre-wrap text-[10px] text-gray-600 max-h-24 overflow-y-auto">
                            {step.outputPreview}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
            {entry.input?.command && (
              <p className="text-gray-700 mt-1">{entry.input.command}</p>
            )}
            {entry.type === "judge" && entry.input?.entryCommand && (
              <p className="text-gray-600 mt-1 font-mono text-[11px]">
                {entry.input.entryCommand}
                {entry.input?.mainSourcePath ? ` · ${entry.input.mainSourcePath}` : ""}
              </p>
            )}
            {entry.stdoutSnippet && (
              <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-600">
                {entry.stdoutSnippet}
              </pre>
            )}
            {entry.error && <p className="text-red-600 mt-1">{entry.error}</p>}
          </div>
        ))}
      </div>
      {caseResult.artifacts?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600 mb-2">Screenshots</p>
          {behavioralArtifactsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading screenshots...
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {caseResult.artifacts.map((artifactKey) => (
                <div
                  key={artifactKey}
                  className="border border-gray-200 rounded overflow-hidden"
                >
                  {behavioralArtifactUrls[artifactKey] ? (
                    <img
                      src={behavioralArtifactUrls[artifactKey]}
                      alt="Behavioral evidence screenshot"
                      className="w-full h-40 object-cover"
                    />
                  ) : (
                    <div className="h-40 flex items-center justify-center text-xs text-gray-500 bg-gray-50">
                      Screenshot unavailable
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function behavioralSetupTone(setup) {
  if (!setup?.status) return "neutral";
  if (setup.status === "ready") return "ok";
  if (setup.status === "degraded") return "warn";
  return "fail";
}

function BehavioralSetupPanel({ report }) {
  const setup = report?.setup;
  if (!setup?.summary) return null;
  const tone = behavioralSetupTone(setup);
  const border =
    tone === "ok"
      ? "border-green-200 bg-green-50 text-green-900"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-red-200 bg-red-50 text-red-900";
  return (
    <div className={`rounded-md border p-3 text-sm space-y-2 ${border}`}>
      <p className="font-medium">
        Environment setup: {setup.status}
        {report?.failureCategory ? (
          <span className="font-normal text-xs ml-2 opacity-80">
            ({report.failureCategory})
          </span>
        ) : null}
      </p>
      <p className="text-xs leading-snug whitespace-pre-wrap">{setup.summary}</p>
      {Array.isArray(setup.failedSteps) && setup.failedSteps.length > 0 ? (
        <ul className="text-xs space-y-1 list-disc pl-4">
          {setup.failedSteps.slice(0, 4).map((step, i) => (
            <li key={`${step.purpose}-${i}`}>
              [{step.purpose}] exit {step.exitCode ?? "?"} —{" "}
              {(step.command || "").slice(0, 100)}
              {step.stderrSnippet ? (
                <span className="block text-[11px] opacity-80 mt-0.5">
                  {step.stderrSnippet}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {setup.healthWait?.logTail ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">Start log tail</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] opacity-90">
            {setup.healthWait.logTail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

/** Plain-text export for debugging / sharing with support or AI. */
function formatBehavioralGradingDebugExport(submission, assessment) {
  const lines = [];
  const push = (line = "") => lines.push(line);
  const report = submission?.behavioralGradingReport;
  const runbook = report?.runbook;

  push("=== BridgeAI Behavioral Grading Export ===");
  push(`Exported: ${new Date().toISOString()}`);
  push("");

  push("--- Submission ---");
  push(`Submission ID: ${submission?._id ?? "?"}`);
  push(`Candidate: ${submission?.candidateName || "(none)"}`);
  push(`Email: ${submission?.candidateEmail || "(none)"}`);
  push(`Status: ${submission?.status ?? "?"}`);
  push(`Code source: ${submission?.codeSource ?? "?"}`);
  if (submission?.githubLink) push(`GitHub: ${submission.githubLink}`);
  push(`Behavioral grading: ${submission?.behavioralGradingStatus ?? "not run"}`);
  if (submission?.behavioralGradingError) {
    push(`Grading error: ${submission.behavioralGradingError}`);
  }
  if (
    submission?.behavioralGradingStatus === "pending" &&
    submission?.behavioralGradingProgress
  ) {
    push("");
    push("--- Live progress (in flight) ---");
    const p = submission.behavioralGradingProgress;
    if (p.phaseLabel) push(`Phase: ${p.phaseLabel}`);
    if (p.checkText) push(`Current check: ${p.checkText}`);
    if (Array.isArray(p.agentSteps) && p.agentSteps.length > 0) {
      push("Agent steps so far:");
      p.agentSteps.forEach((s) => {
        push(
          `  #${s.iteration} ${s.tool} [${s.status}] ${s.detail ?? ""}`,
        );
        if (s.outputPreview) {
          push(
            s.outputPreview
              .split("\n")
              .map((l) => `    ${l}`)
              .join("\n"),
          );
        }
      });
    }
    if (Array.isArray(p.completedChecks) && p.completedChecks.length > 0) {
      push("Completed checks:");
      p.completedChecks.forEach((c) => {
        push(`  [${c.verdict}] ${c.checkText}`);
      });
    }
  }
  push("");

  if (assessment) {
    push("--- Assessment ---");
    push(`Title: ${assessment.title ?? "?"}`);
    push(`Assessment ID: ${assessment._id ?? assessment.id ?? "?"}`);
    if (Array.isArray(assessment.behavioralChecks)) {
      push("Configured checks:");
      assessment.behavioralChecks.forEach((c, i) => push(`  ${i + 1}. ${c}`));
    }
    push("");
  }

  if (report?.sandbox) {
    push("--- Sandbox ---");
    push(`Sandbox ID: ${report.sandbox.sandboxId ?? "?"}`);
    push(`Timeout (ms): ${report.sandbox.timeoutMs ?? "?"}`);
    push("");
  }

  if (report?.startedAt || report?.completedAt) {
    push("--- Timing ---");
    if (report.startedAt) push(`Started: ${report.startedAt}`);
    if (report.completedAt) push(`Completed: ${report.completedAt}`);
    push("");
  }

  if (runbook) {
    push("--- Runbook ---");
    push(`Execution profile: ${runbook.executionProfile ?? "?"}`);
    push(`README requirement: ${runbook.readmeRequirementPassed ? "pass" : "fail"}`);
    if (runbook.readmeRequirementDetail?.summary) {
      push(`README detail: ${runbook.readmeRequirementDetail.summary}`);
    }
    if (runbook.sandboxAppOrigin) {
      push(`In-sandbox origin: ${runbook.sandboxAppOrigin}`);
      if (runbook.sandboxAppDiscovery) {
        push(`Port discovery: ${runbook.sandboxAppDiscovery}`);
      }
    }
    if (runbook.baseUrl) push(`Browser base URL: ${runbook.baseUrl}`);
    if (runbook.summary) {
      push("Steps:");
      runbook.summary.split("\n").forEach((line) => push(`  ${line}`));
    }
    push("");
  }

  if (report?.setup) {
    const setup = report.setup;
    push("--- Environment setup ---");
    push(`Status: ${setup.status ?? "?"}`);
    if (setup.summary) push(setup.summary);
    if (Array.isArray(setup.failedSteps) && setup.failedSteps.length > 0) {
      push("Failed runbook steps:");
      setup.failedSteps.forEach((step) => {
        push(
          `  [${step.purpose}] exit ${step.exitCode ?? "?"} — ${step.command ?? ""}`,
        );
        if (step.stderrSnippet) push(`    stderr: ${step.stderrSnippet}`);
      });
    }
    if (setup.healthWait) {
      const hw = setup.healthWait;
      push(
        `Health wait: ready=${hw.ready} attempts=${hw.attempts ?? "?"} elapsedMs=${hw.elapsedMs ?? "?"}`,
      );
      if (hw.lastError) push(`  lastError: ${hw.lastError}`);
      if (hw.logTail) {
        push("  start log tail:");
        push(hw.logTail);
      }
    }
    push("");
  }

  if (Array.isArray(runbook?.evidence) && runbook.evidence.length > 0) {
    push("--- Runbook command evidence ---");
    runbook.evidence.forEach((entry, i) => {
      if (entry?.type !== "command") return;
      const input = entry.input || {};
      push(
        `[${i + 1}] [${input.purpose ?? "?"}] ${entry.success ? "OK" : "FAIL"} exit ${entry.exitCode ?? "?"}`,
      );
      const cmd = input.executedCommand || input.command;
      if (cmd) push(`  $ ${cmd}`);
      if (entry.stdoutSnippet) push(`  stdout:\n${entry.stdoutSnippet}`);
      if (entry.stderrSnippet) push(`  stderr:\n${entry.stderrSnippet}`);
      push("");
    });
  }

  const cases = report?.cases;
  if (Array.isArray(cases) && cases.length > 0) {
    push("--- Behavioral checks ---");
    cases.forEach((caseResult, idx) => {
      push("");
      push(`### Check ${idx + 1}: ${(caseResult.verdict || "?").toUpperCase()}`);
      push(caseResult.checkText || "(no text)");
      if (caseResult.checkIndex != null) {
        push(`(assessment index: ${caseResult.checkIndex})`);
      }

      (caseResult.evidence || []).forEach((entry) => {
        if (entry?.type !== "judge") return;
        push("");
        push("Rationale:");
        push(entry.rationale || "(none)");
        if (Array.isArray(entry.citations) && entry.citations.length > 0) {
          push("");
          push("Citations:");
          entry.citations.forEach((c, ci) => push(`  ${ci + 1}. ${c}`));
        }
        if (Array.isArray(entry.agentTrace) && entry.agentTrace.length > 0) {
          push("");
          push(`Agent tool trace (${entry.agentTrace.length} steps):`);
          entry.agentTrace.forEach((step) => {
            push("");
            push(
              `#${step.iteration} ${step.tool} ${step.success ? "OK" : "FAIL"}`,
            );
            if (step.detail) push(`  command/detail: ${step.detail}`);
            if (step.outputPreview) {
              push("  output:");
              push(
                step.outputPreview
                  .split("\n")
                  .map((l) => `    ${l}`)
                  .join("\n"),
              );
            }
          });
        }
        if (entry.input?.entryCommand) {
          push("");
          push(`Seed entry: ${entry.input.entryCommand}`);
          if (entry.input.mainSourcePath) {
            push(`Seed source: ${entry.input.mainSourcePath}`);
          }
        }
      });

      if (caseResult.artifacts?.length > 0) {
        push("");
        push(`Screenshot artifact keys: ${caseResult.artifacts.join(", ")}`);
      }
    });
  } else if (!submission?.behavioralGradingError) {
    push("--- Behavioral checks ---");
    push("(no case results)");
  }

  if (report?.failureCategory) {
    push("");
    push(`Failure category: ${report.failureCategory}`);
  }
  if (report?.reportArtifactKey) {
    push(`Report artifact: ${report.reportArtifactKey}`);
  }

  push("");
  push("=== end export ===");
  return lines.join("\n");
}

function CopyBehavioralReportButton({
  submission,
  assessment,
  variant = "outline",
  size = "sm",
  className = "",
  label = "Copy report",
}) {
  const [copied, setCopied] = React.useState(false);
  const { toast } = useToast();

  const hasExportable =
    submission?.behavioralGradingReport ||
    submission?.behavioralGradingError ||
    submission?.behavioralGradingStatus === "pending";

  if (!submission || !hasExportable) return null;

  const handleCopy = async () => {
    const text = formatBehavioralGradingDebugExport(submission, assessment);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: "Copied",
        description: "Behavioral grading report copied to clipboard.",
      });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Could not copy to clipboard.",
      });
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => void handleCopy()}
    >
      {copied ? (
        <>
          <Check className="w-4 h-4 mr-2" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-4 h-4 mr-2" />
          {label}
        </>
      )}
    </Button>
  );
}

/** S3 signed URLs last 1h; refresh a bit early, never on a timer while playing. */
const PLAYBACK_URL_TTL_MS = 50 * 60 * 1000;
const PLAYBACK_ERROR_REFRESH_MIN_MS = 15 * 1000;

function revokeIfBlobUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function sessionIdString(session) {
  if (!session?._id) return "";
  if (typeof session._id === "string") return session._id;
  return session._id.toString?.() ?? String(session._id);
}

function playbackCacheFresh(cache, submissionId) {
  return Boolean(
    cache &&
      cache.submissionId === submissionId &&
      cache.url &&
      Date.now() - cache.fetchedAt < PLAYBACK_URL_TTL_MS
  );
}

export default function SubmissionsDashboard() {
  const buildStackBlitzUrl = (githubUrl) => {
    try {
      const parsed = new URL(githubUrl);
      const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      if (hostname !== "github.com") return null;

      const [owner, rawRepo] = parsed.pathname
        .split("/")
        .filter(Boolean);
      const repo = rawRepo?.replace(/\.git$/i, "");
      if (!owner || !repo) return null;

      const previewUrl = new URL(
        `https://stackblitz.com/github/${owner}/${repo}`
      );
      previewUrl.searchParams.set("embed", "1");
      previewUrl.searchParams.set("file", "README.md");
      previewUrl.searchParams.set("terminal", "1");
      previewUrl.searchParams.set("view", "preview");
      previewUrl.searchParams.set("ctl", "1");
      return previewUrl.toString();
    } catch {
      return null;
    }
  };

  const [searchParams] = useSearchParams();
  const assessmentId = searchParams.get("assessmentId");

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [submissions, setSubmissions] = useState([]);
  const [assessment, setAssessment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [exportingEvidence, setExportingEvidence] = useState(false);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedEvaluationSubmission, setSelectedEvaluationSubmission] =
    useState(null);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [showRunProjectModal, setShowRunProjectModal] = useState(false);
  const [runProjectPreviewUrl, setRunProjectPreviewUrl] = useState("");
  const [evaluationTab, setEvaluationTab] = useState("summary");
  const [isDropoffAnalysisExpanded, setIsDropoffAnalysisExpanded] =
    useState(false);
  const [evaluatingSubmissionId, setEvaluatingSubmissionId] = useState(null);
  // Workflow capture (hooks-first evidence). Separate from the proctoring
  // state because a submission can have one, both, or neither.
  const [workflowSession, setWorkflowSession] = useState(null);
  const [workflowAnalysis, setWorkflowAnalysis] = useState(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [episodesBuilding, setEpisodesBuilding] = useState(false);
  // Seek requested from the activity timeline; consumed by the video player.
  const [recordingSeekSec, setRecordingSeekSec] = useState(null);
  const [companionMessages, setCompanionMessages] = useState(null);
  const [companionLoading, setCompanionLoading] = useState(false);
  const [recordingSession, setRecordingSession] = useState(null);
  const [recordingTranscript, setRecordingTranscript] = useState(null);
  const [recordingTranscriptLoading, setRecordingTranscriptLoading] = useState(false);
  const [recordingVideoLoading, setRecordingVideoLoading] = useState(false);
  const [recordingTranscriptError, setRecordingTranscriptError] = useState(null);
  const [recordingVideoObjectUrl, setRecordingVideoObjectUrl] = useState(null);
  const [behavioralGradingSubmissionId, setBehavioralGradingSubmissionId] =
    useState(null);
  const [behavioralArtifactUrls, setBehavioralArtifactUrls] = useState({});
  const [behavioralArtifactsLoading, setBehavioralArtifactsLoading] =
    useState(false);
  const [expandedBehavioralCases, setExpandedBehavioralCases] = useState(
    () => new Set()
  );
  const behavioralArtifactsLoadedForIdRef = React.useRef(null);
  const recordingVideoObjectUrlRef = React.useRef(null);
  const recordingPlaybackRef = React.useRef(null);
  const recordingPlaybackRefreshAtRef = React.useRef(0);
  const refreshRecordingPlaybackRef = React.useRef(null);
  const recordingMergePollRef = React.useRef(null);
  const pendingRefetchedRef = React.useRef(false);
  const autoEvalAttemptedRef = React.useRef(new Set());
  const reviewTabOverrideRef = React.useRef(false);
  const { toast } = useToast();

  // Resolved on the assessment (all rows on this page share it). Leftover
  // `workflow` / `none` have no screen to watch, so the Recording tab stays off.
  const evidenceModeForReview =
    selectedEvaluationSubmission?.evidenceMode ||
    assessment?.evidenceMode ||
    "screen";
  const recordsScreen =
    evidenceModeForReview !== "workflow" && evidenceModeForReview !== "none";
  const activityTimelineOnRecording = evidenceModeForReview === "both";

  const handleOpenRunProjectModal = (githubUrl) => {
    const previewUrl = buildStackBlitzUrl(githubUrl);
    if (!previewUrl) {
      window.open(githubUrl, "_blank", "noopener,noreferrer");
      toast({
        title: "Opened GitHub repository",
        description:
          "Could not create a live preview URL, so the repository was opened directly.",
      });
      return;
    }
    setRunProjectPreviewUrl(previewUrl);
    setShowRunProjectModal(true);
  };

  const handleDownloadCodeArchive = async (submission) => {
    if (!submission?._id) return;
    const result = await downloadSubmissionCodeArchive(submission._id);
    if (!result.success) {
      toast({
        title: "Download failed",
        description: result.error || "Could not download code archive.",
        variant: "destructive",
      });
      return;
    }
    const url = URL.createObjectURL(result.data);
    const anchor = document.createElement("a");
    const baseName =
      submission.codeUpload?.originalFilename ||
      `submission-${submission._id}.zip`;
    anchor.href = url;
    anchor.download = baseName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportAllEvidence = async () => {
    if (!assessmentId) return;
    setExportingEvidence(true);
    try {
      const result = await exportAssessmentEvidenceZip(assessmentId);
      if (!result.success) {
        toast({
          title: "Export failed",
          description: result.error || "Could not export evidence.",
          variant: "destructive",
        });
        return;
      }
      const url = URL.createObjectURL(result.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `assessment-${assessmentId}-submission-evidence.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Evidence exported",
        description:
          "ZIP includes submission metadata, evaluation and behavioral reports, and grading artifacts.",
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e?.message || "Could not export evidence.",
        variant: "destructive",
      });
    } finally {
      setExportingEvidence(false);
    }
  };

  // Reset behavioral artifact cache when evaluation target changes
  useEffect(() => {
    setExpandedBehavioralCases(new Set());
    behavioralArtifactsLoadedForIdRef.current = null;
    setBehavioralArtifactUrls((prev) => {
      Object.values(prev).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      return {};
    });
  }, [selectedEvaluationSubmission?._id]);

  useEffect(() => {
    return () => {
      Object.values(behavioralArtifactUrls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [behavioralArtifactUrls]);

  // Review always opens on Summary — the scores and the verdict are what a
  // reviewer came for. Deep links (openReview(sub, "recording")) set the tab
  // themselves; the ref keeps this reset from stomping on them.
  useEffect(() => {
    if (showEvaluationModal && selectedEvaluationSubmission?._id) {
      if (reviewTabOverrideRef.current) {
        reviewTabOverrideRef.current = false;
        return;
      }
      setEvaluationTab("summary");
    }
  }, [showEvaluationModal, selectedEvaluationSubmission?._id]);

  // Load workflow capture (if any) whenever the evaluation modal opens.
  // Independent of the proctoring load: a workflow submission has no proctoring
  // session, and a "both" submission has both.
  useEffect(() => {
    let cancelled = false;
    const submissionId = selectedEvaluationSubmission?._id;
    if (!showEvaluationModal || !submissionId) {
      setWorkflowSession(null);
      setWorkflowAnalysis(null);
      return;
    }
    (async () => {
      setWorkflowLoading(true);
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const session = await getCaptureSessionBySubmission(submissionId, token);
        if (cancelled) return;
        setWorkflowSession(session);
        if (session?._id) {
          const analysis = await getWorkflowAnalysis(session._id, token);
          if (!cancelled) setWorkflowAnalysis(analysis);
        } else {
          setWorkflowAnalysis(null);
        }
      } catch {
        // No capture is an ordinary state; the panel renders nothing.
        if (!cancelled) {
          setWorkflowSession(null);
          setWorkflowAnalysis(null);
        }
      } finally {
        if (!cancelled) setWorkflowLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showEvaluationModal, selectedEvaluationSubmission?._id]);

  // In-session voice companion — this is the "agent communication" the
  // candidate actually had during the assessment.
  useEffect(() => {
    let cancelled = false;
    const submissionId = selectedEvaluationSubmission?._id;
    if (!showEvaluationModal || !submissionId) {
      setCompanionMessages(null);
      return;
    }
    (async () => {
      setCompanionLoading(true);
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const sessionResult = await getSessionBySubmission(submissionId, token);
        if (cancelled) return;
        if (!sessionResult.success || !sessionResult.data?._id) {
          setCompanionMessages([]);
          return;
        }
        const companionResult = await getCompanionTranscript(
          sessionResult.data._id,
          undefined,
          token
        );
        if (cancelled) return;
        setCompanionMessages(
          companionResult.success
            ? companionResult.data?.messages || []
            : []
        );
      } catch {
        if (!cancelled) setCompanionMessages([]);
      } finally {
        if (!cancelled) setCompanionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showEvaluationModal, selectedEvaluationSubmission?._id]);

  // Load proctoring session + signed playback URL when Review opens, not only
  // when the Recording tab is selected. Evidence chips on Summary switch to
  // Recording and seek; if the URL is fetched only after that tab mounts, the
  // player is still empty. Bytes still load only when <video> mounts.
  // Playback URL is fetched once per submission (cached ~50 min) — never on an
  // interval. A previous version re-ran this effect when the list poll replaced
  // `evaluationReport`, revoked the URL, and pulled the whole WebM again.
  const handleRecordingPlaybackError = React.useCallback(() => {
    refreshRecordingPlaybackRef.current?.();
  }, []);

  useEffect(() => {
    if (
      !showEvaluationModal ||
      !recordsScreen ||
      !selectedEvaluationSubmission?._id ||
      !currentUser
    ) {
      if (recordingMergePollRef.current) {
        clearInterval(recordingMergePollRef.current);
        recordingMergePollRef.current = null;
      }
      return;
    }
    const submissionId = String(selectedEvaluationSubmission?._id ?? "");
    if (!submissionId) {
      setRecordingTranscriptLoading(false);
      return;
    }

    const applyPlaybackUrl = (url) => {
      recordingVideoObjectUrlRef.current = url;
      setRecordingVideoObjectUrl(url);
    };

    const fetchPlaybackUrl = async (sessionIdForVideo, token, { force = false } = {}) => {
      if (
        !force &&
        playbackCacheFresh(recordingPlaybackRef.current, submissionId)
      ) {
        applyPlaybackUrl(recordingPlaybackRef.current.url);
        return recordingPlaybackRef.current.url;
      }
      const videoResult = await getProctoringVideoPlaybackUrl(
        sessionIdForVideo,
        token
      );
      if (videoResult.success && videoResult.data) {
        recordingPlaybackRef.current = {
          submissionId,
          sessionId: sessionIdForVideo,
          url: videoResult.data,
          fetchedAt: Date.now(),
        };
        applyPlaybackUrl(videoResult.data);
        return videoResult.data;
      }
      return null;
    };

    refreshRecordingPlaybackRef.current = async () => {
      const now = Date.now();
      if (now - recordingPlaybackRefreshAtRef.current < PLAYBACK_ERROR_REFRESH_MIN_MS) {
        return;
      }
      recordingPlaybackRefreshAtRef.current = now;
      const cached = recordingPlaybackRef.current;
      if (cached?.submissionId !== submissionId || !cached.sessionId) return;
      const sessionIdForVideo = cached.sessionId;
      if (!currentUser) return;
      try {
        const token = await currentUser.getIdToken();
        await fetchPlaybackUrl(sessionIdForVideo, token, { force: true });
      } catch (e) {
        console.warn("[proctoring-video] playback URL refresh failed:", e?.message ?? e);
      }
    };

    if (playbackCacheFresh(recordingPlaybackRef.current, submissionId)) {
      applyPlaybackUrl(recordingPlaybackRef.current.url);
    } else if (recordingPlaybackRef.current?.submissionId !== submissionId) {
      revokeIfBlobUrl(recordingVideoObjectUrlRef.current);
      recordingVideoObjectUrlRef.current = null;
      setRecordingVideoObjectUrl(null);
      setRecordingSession(null);
    }

    if (recordingMergePollRef.current) {
      clearInterval(recordingMergePollRef.current);
      recordingMergePollRef.current = null;
    }
    setRecordingTranscriptError(null);
    setRecordingTranscriptLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const token = await currentUser.getIdToken();
        const sessionResult = await getSessionBySubmission(submissionId, token);
        if (cancelled) return;
        if (!sessionResult.success || !sessionResult.data) {
          setRecordingTranscriptLoading(false);
          return;
        }
        const session = sessionResult.data;
        if (String(session.submissionId) !== String(submissionId)) {
          setRecordingTranscriptLoading(false);
          return;
        }
        setRecordingSession(session);
        // Video OCR only exists for leftover `screen` assessments. `both`
        // never transcribes — the hook stream is the text index of the footage.
        if (
          evidenceModeForReview === "screen" &&
          session.transcript?.status === "completed" &&
          session.transcript?.storageKey &&
          !selectedEvaluationSubmission?.enrichedTranscript
        ) {
          const transcriptResult = await getTranscriptContent(session._id);
          if (cancelled) return;
          if (transcriptResult.success && transcriptResult.data) {
            const lines = transcriptResult.data
              .split("\n")
              .filter((l) => l.trim());
            const segments = lines
              .map((line) => {
                try {
                  const cleaned = line
                    .trim()
                    .replace(/^```(?:json|jsonl)?/, "")
                    .replace(/^```$/, "")
                    .trim();
                  return cleaned ? JSON.parse(cleaned) : null;
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
            setRecordingTranscript(segments);
          }
        }
        const employerCanWatchRecording =
          session.status === "completed" ||
          session.mergedVideo?.status === "ready";
        const mergeInFlight = session.mergedVideo?.status === "merging";
        const sessionIdForVideo = sessionIdString(session);

        if (employerCanWatchRecording && !mergeInFlight && sessionIdForVideo) {
          if (!playbackCacheFresh(recordingPlaybackRef.current, submissionId)) {
            setRecordingVideoLoading(true);
            await fetchPlaybackUrl(sessionIdForVideo, token);
          }
          if (!cancelled) setRecordingVideoLoading(false);
        } else {
          setRecordingVideoLoading(false);
        }

        if (!cancelled && mergeInFlight) {
          recordingMergePollRef.current = setInterval(async () => {
            if (cancelled) return;
            try {
              const tok = await currentUser.getIdToken();
              const sr = await getSessionBySubmission(submissionId, tok);
              if (!sr.success || !sr.data || cancelled) return;
              setRecordingSession(sr.data);
              const stillMerging = sr.data.mergedVideo?.status === "merging";
              if (stillMerging) return;
              if (recordingMergePollRef.current) {
                clearInterval(recordingMergePollRef.current);
                recordingMergePollRef.current = null;
              }
              const canWatchNow =
                sr.data.status === "completed" ||
                sr.data.mergedVideo?.status === "ready";
              if (canWatchNow && !playbackCacheFresh(recordingPlaybackRef.current, submissionId)) {
                setRecordingVideoLoading(true);
                await fetchPlaybackUrl(sessionIdString(sr.data), tok);
                if (!cancelled) setRecordingVideoLoading(false);
              }
            } catch (e) {
              console.warn("[proctoring-video] merge poll failed:", e?.message ?? e);
            }
          }, 4000);
        }
      } catch (err) {
        if (!cancelled) {
          // A missing proctoring session is an ordinary state, not an error:
          // workflow-mode submissions never create one. Surfacing the raw
          // "404 Not Found: {...}" string to an employer was a bug.
          const msg = String(err?.message ?? "");
          const isMissingSession = /404|not found/i.test(msg);
          setRecordingTranscriptError(
            isMissingSession ? null : msg || "Failed to load screen transcript"
          );
        }
      } finally {
        if (!cancelled) {
          setRecordingTranscriptLoading(false);
          setRecordingVideoLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (recordingMergePollRef.current) {
        clearInterval(recordingMergePollRef.current);
        recordingMergePollRef.current = null;
      }
    };
  }, [
    showEvaluationModal,
    recordsScreen,
    selectedEvaluationSubmission?._id,
    currentUser?.uid,
    evidenceModeForReview,
  ]);

  useEffect(() => {
    if (evaluationTab === "recording" && !recordsScreen) {
      setEvaluationTab("summary");
    }
  }, [evaluationTab, recordsScreen]);

  // Wait for auth state to be ready
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (!user) {
        window.location.href = createPageUrl("Login");
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch assessment and submissions
  const loadSubmissions = React.useCallback(async () => {
    if (!assessmentId || !currentUser) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch assessment details
      const token = await currentUser.getIdToken();
      const assessmentResult = await getAssessment(assessmentId, token);

      if (!assessmentResult.success) {
        setError("Failed to load assessment");
        setIsLoading(false);
        return;
      }

      setAssessment(assessmentResult.data);

      // Fetch submissions
      const submissionsResult = await getSubmissionsForAssessment(
        assessmentId,
        token
      );

      if (submissionsResult.success) {
        setSubmissions(submissionsResult.data || []);
      } else {
        setError(submissionsResult.error || "Failed to load submissions");
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [assessmentId, currentUser]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  // Silent refetch for the manual reload button (no full-page loading state)
  const handleManualRefresh = React.useCallback(async () => {
    if (!assessmentId || !currentUser || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const token = await currentUser.getIdToken();
      const result = await getSubmissionsForAssessment(assessmentId, token);
      if (result.success) setSubmissions(result.data || []);
    } catch {
      // best-effort refresh; keep existing data on failure
    } finally {
      setIsRefreshing(false);
    }
  }, [assessmentId, currentUser, isRefreshing]);

  // Keep the review dialog in sync when the list refreshes (e.g. behavioral
  // poll). Only swap the object when something a reviewer can see actually
  // changed — an unconditional swap handed every child a new reference on each
  // poll, which is what made the recording reload underneath the reviewer.
  useEffect(() => {
    if (!selectedEvaluationSubmission?._id) return;
    const fresh = submissions.find(
      (s) => s._id === selectedEvaluationSubmission._id
    );
    if (!fresh || fresh === selectedEvaluationSubmission) return;
    const signature = (s) =>
      JSON.stringify([
        s.status,
        s.evaluationStatus,
        s.evaluationError,
        s.behavioralGradingStatus,
        s.behavioralGradingError,
        s.behavioralGradingProgress,
        s.behavioralGradingReport?.cases?.length ?? null,
        Boolean(s.evaluationReport),
        s.evaluationReport?.criteria_results?.length ?? null,
      ]);
    if (signature(fresh) === signature(selectedEvaluationSubmission)) return;
    setSelectedEvaluationSubmission(fresh);
  }, [submissions, selectedEvaluationSubmission]);

  // When any submission is waiting for automatic evaluation, do a single
  // delayed refetch instead of polling. The effect re-runs on every
  // setSubmissions, so a ref latch guarantees exactly one scheduled refetch
  // per pending episode (avoids the runaway interval that never hit its cap).
  useEffect(() => {
    const submittedRecently = (s) =>
      s.submittedAt &&
      Date.now() - new Date(s.submittedAt).getTime() < 15 * 60 * 1000;
    const hasPendingBehavioral = submissions.some(
      (s) => s.behavioralGradingStatus === "pending"
    );
    const hasPending = submissions.some(
      (s) =>
        (s.status === "submitted" &&
        !s.evaluationReport?.criteria_results?.length &&
        (s.evaluationStatus === "pending" ||
            (s.evaluationStatus !== "failed" && submittedRecently(s)))) ||
        hasPendingBehavioral
    );

    if (!hasPending || !assessmentId || !currentUser) {
      pendingRefetchedRef.current = false; // reset when nothing pending
      return;
    }
    if (pendingRefetchedRef.current) return; // one-shot already scheduled
    pendingRefetchedRef.current = true;

    const timer = setTimeout(async () => {
      try {
        const token = await currentUser.getIdToken();
        const result = await getSubmissionsForAssessment(assessmentId, token);
        if (result.success) setSubmissions(result.data || []);
      } catch {}
    }, 8000);

    return () => clearTimeout(timer);
  }, [submissions, assessmentId, currentUser]);

  const handleRunEvaluation = React.useCallback(
    async (submission, { silent = false } = {}) => {
      if (!currentUser || !submission?._id) return;
      setEvaluatingSubmissionId(submission._id);
      try {
        const token = await currentUser.getIdToken();
        const result = await runSubmissionEvaluation(submission._id, token);
        if (result.success) {
          const submissionsResult = await getSubmissionsForAssessment(
            assessmentId,
            token
          );
          if (submissionsResult.success) {
            setSubmissions(submissionsResult.data || []);
            setSelectedEvaluationSubmission((prev) => {
              if (!prev || prev._id !== submission._id) return prev;
              return (
                submissionsResult.data?.find((s) => s._id === submission._id) ??
                prev
              );
            });
          }
          if (!silent) {
            toast({
              title: "Evaluation started",
              description: "Scores will show up here when they are ready.",
            });
          }
        } else if (!silent) {
          toast({
            title: "Evaluation failed",
            description:
              ("error" in result ? result.error : null) || "Evaluation failed",
            variant: "destructive",
          });
        }
      } catch (error) {
        if (!silent) {
          toast({
            title: "Evaluation failed",
            description: error?.message || "An unexpected error occurred.",
            variant: "destructive",
          });
        }
      } finally {
        setEvaluatingSubmissionId((id) =>
          id === submission._id ? null : id
        );
      }
    },
    [currentUser, assessmentId, toast]
  );

  // Re-kick evaluation for recent or recoverable failures so the employer
  // never has to click "Run evaluation" after a submit.
  useEffect(() => {
    if (!currentUser || !assessmentId || submissions.length === 0) return;
    const target = submissions.find((s) => {
      if (autoEvalAttemptedRef.current.has(s._id)) return false;
      if (s.status !== "submitted") return false;
      if (hasEvaluableWorkflowReport(s)) return false;
      if (s.evaluationStatus === "completed") return false;
      // "pending" normally means a run is genuinely in flight, so leaving it
      // alone is right — but nothing ever clears it if the server restarts
      // mid-evaluation (it runs unawaited in the background, and deploys are
      // routine). Those submissions sat on "Scoring…" forever with no report
      // and no failure. Past the point where any real run would have finished,
      // treat it as abandoned and start again.
      if (s.evaluationStatus === "pending") {
        return Boolean(
          s.submittedAt &&
            Date.now() - new Date(s.submittedAt).getTime() > STALE_PENDING_MS
        );
      }
      const err = s.evaluationError || "";
      if (/no evaluation criteria/i.test(err)) return false;
      const recent =
        s.submittedAt &&
        Date.now() - new Date(s.submittedAt).getTime() < 15 * 60 * 1000;
      const recoverable = /workflow capture session/i.test(err);
      if (s.evaluationStatus === "failed") return recoverable || recent;
      return Boolean(recent);
    });
    if (!target) return;
    autoEvalAttemptedRef.current.add(target._id);
    handleRunEvaluation(target, { silent: true });
  }, [submissions, currentUser, assessmentId, handleRunEvaluation]);

  // Calculate stats from real data
  const stats = React.useMemo(() => {
    const totalInvited = submissions.length;

    // Started includes: in-progress, submitted, expired, and opted-out (if they started)
    const started = submissions.filter(
      (s) =>
        s.status === "in-progress" ||
        s.status === "submitted" ||
        s.status === "expired" ||
        (s.status === "opted-out" && s.startedAt)
    ).length;

    // Completed only includes submitted (not expired)
    const completed = submissions.filter(
      (s) => s.status === "submitted"
    ).length;

    const expired = submissions.filter((s) => s.status === "expired").length;
    const optedOut = submissions.filter((s) => s.status === "opted-out").length;

    // Calculate average time spent (in minutes) - only for completed submissions
    const completedSubmissions = submissions.filter(
      (s) => s.status === "submitted" && s.timeSpent && s.timeSpent > 0
    );
    const avgTimeSpentMinutes =
      completedSubmissions.length > 0
        ? Math.round(
            completedSubmissions.reduce(
              (sum, s) => sum + (s.timeSpent || 0),
              0
            ) / completedSubmissions.length
          )
        : 0;

    const formatTime = (minutes) => {
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    return {
      totalInvited,
      started,
      completed,
      expired,
      optedOut,
      avgTimeSpent: formatTime(avgTimeSpentMinutes),
    };
  }, [submissions]);

  const dropoffRate =
    stats.started > 0
      ? Math.round(((stats.started - stats.completed) / stats.started) * 100)
      : 0;
  const startRate =
    stats.totalInvited > 0
      ? Math.round((stats.started / stats.totalInvited) * 100)
      : 0;
  const completionRate =
    stats.started > 0 ? Math.round((stats.completed / stats.started) * 100) : 0;

  // Analyze dropoff feedback
  const dropoffAnalysis = React.useMemo(() => {
    const optedOutSubmissions = submissions.filter(
      (s) => s.status === "opted-out" && s.optOutReason
    );

    if (optedOutSubmissions.length === 0) {
      return null;
    }

    const reasons = optedOutSubmissions.map((s) =>
      s.optOutReason.toLowerCase().trim()
    );

    // Common themes/categories
    const themes = {
      time: {
        keywords: [
          "time",
          "busy",
          "schedule",
          "deadline",
          "hours",
          "long",
          "too much time",
          "not enough time",
        ],
        count: 0,
        examples: [],
      },
      complexity: {
        keywords: [
          "too hard",
          "too difficult",
          "complex",
          "challenging",
          "overwhelming",
          "advanced",
        ],
        count: 0,
        examples: [],
      },
      unclear: {
        keywords: [
          "unclear",
          "confusing",
          "unclear instructions",
          "not clear",
          "vague",
          "ambiguous",
        ],
        count: 0,
        examples: [],
      },
      notInterested: {
        keywords: [
          "not interested",
          "not a fit",
          "not right",
          "different",
          "not for me",
        ],
        count: 0,
        examples: [],
      },
      technical: {
        keywords: [
          "technical",
          "tech stack",
          "framework",
          "language",
          "tools",
          "environment",
        ],
        count: 0,
        examples: [],
      },
      other: {
        keywords: [],
        count: 0,
        examples: [],
      },
    };

    // Categorize reasons
    reasons.forEach((reason, index) => {
      let categorized = false;
      const originalReason = optedOutSubmissions[index].optOutReason;

      for (const [themeName, theme] of Object.entries(themes)) {
        if (themeName === "other") continue;

        if (theme.keywords.some((keyword) => reason.includes(keyword))) {
          theme.count++;
          if (theme.examples.length < 3) {
            theme.examples.push(originalReason);
          }
          categorized = true;
          break;
        }
      }

      if (!categorized) {
        themes.other.count++;
        if (themes.other.examples.length < 3) {
          themes.other.examples.push(originalReason);
        }
      }
    });

    // Generate suggestions based on themes
    const suggestions = [];

    if (themes.time.count > 0) {
      suggestions.push({
        priority: themes.time.count >= 2 ? "high" : "medium",
        issue: "Time concerns",
        suggestion:
          "Consider reducing the time limit or breaking the assessment into smaller parts. Make the expected time commitment clear upfront.",
        count: themes.time.count,
      });
    }

    if (themes.complexity.count > 0) {
      suggestions.push({
        priority: themes.complexity.count >= 2 ? "high" : "medium",
        issue: "Assessment too complex",
        suggestion:
          "Review the difficulty level. Consider providing starter code or scaffolding to help candidates get started faster.",
        count: themes.complexity.count,
      });
    }

    if (themes.unclear.count > 0) {
      suggestions.push({
        priority: "high",
        issue: "Unclear instructions",
        suggestion:
          "Clarify the project description and requirements. Add more specific examples and expected deliverables.",
        count: themes.unclear.count,
      });
    }

    if (themes.technical.count > 0) {
      suggestions.push({
        priority: "medium",
        issue: "Technical stack mismatch",
        suggestion:
          "Ensure the required technologies are clearly stated in the job description and assessment. Consider offering flexibility in tech stack.",
        count: themes.technical.count,
      });
    }

    if (themes.notInterested.count > 0) {
      suggestions.push({
        priority: "low",
        issue: "Not a good fit",
        suggestion:
          "This is expected - some candidates will self-select out. Ensure your job description accurately represents the role.",
        count: themes.notInterested.count,
      });
    }

    // Sort suggestions by priority and count
    suggestions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return b.count - a.count;
    });

    return {
      totalWithFeedback: optedOutSubmissions.length,
      themes,
      suggestions,
      allReasons: optedOutSubmissions.map((s) => s.optOutReason),
    };
  }, [submissions]);

  const filteredSubmissions = submissions.filter((sub) => {
    const name = sub.candidateName || "";
    const email = sub.candidateEmail || "";
    const matchesSearch =
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.toLowerCase().includes(searchQuery.toLowerCase());
    // Map filter values to actual status values
    let filterStatus = statusFilter;
    if (statusFilter === "completed") filterStatus = "submitted";
    if (statusFilter === "not_started") filterStatus = "pending";
    if (statusFilter === "in_progress") filterStatus = "in-progress";
    if (statusFilter === "opted_out") filterStatus = "opted-out";
    const matchesStatus = statusFilter === "all" || sub.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getSubmissionScore = (sub) => {
    const combined = getCombinedScore0to100(sub);
    if (combined == null) return -1;
    return combined;
  };

  const sortedSubmissions = [...filteredSubmissions].sort((a, b) => {
    const scoreA = getSubmissionScore(a);
    const scoreB = getSubmissionScore(b);
    return scoreB - scoreA;
  });

  const formatTimeSpent = (minutes) => {
    if (!minutes) return "—";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getStatusBadge = (status, submission) => {
    const styles = {
      submitted: "bg-green-100 text-green-700",
      "in-progress": "bg-blue-100 text-blue-700",
      pending: "bg-gray-100 text-gray-600",
      expired: "bg-red-100 text-red-700",
      "opted-out": "bg-orange-100 text-orange-700",
    };
    const labels = {
      submitted: "Completed",
      "in-progress": "In Progress",
      pending: "Not Started",
      expired: "Expired",
      "opted-out": submission?.startedAt
        ? "Opted Out (After Start)"
        : "Opted Out (Before Start)",
    };
    return (
      <Badge className={styles[status] || "bg-gray-100 text-gray-600"}>
        {labels[status] || status}
      </Badge>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // Episodes are persisted on the session when capture closes; the analysis
  // response only carries them when explicitly requested. Prefer whichever
  // source actually has them.
  const episodesForReview =
    (workflowAnalysis?.episodes?.length
      ? workflowAnalysis.episodes
      : workflowSession?.episodes) || [];

  /**
   * Jump the recording to a captured moment (rubric chip or activity row).
   * Switches to the Recording tab and hands the player an offset. The player
   * holds the offset until HAVE_METADATA, then seeks (and plays) so a chip
   * click from Summary works on the first open, not only after a refresh.
   */
  const handleSeekRecording = (offsetSeconds) => {
    if (!recordsScreen) return;
    if (offsetSeconds == null || !Number.isFinite(offsetSeconds)) return;
    setEvaluationTab("recording");
    // New object identity on every click so repeat clicks on the same moment
    // still register as a change for the player's effect.
    setRecordingSeekSec({ sec: offsetSeconds, at: performance.now() });
  };

  /** Build the episode summary on demand (costs one LLM call server-side). */
  const handleBuildEpisodes = async () => {
    if (!workflowSession?._id || !currentUser) return;
    setEpisodesBuilding(true);
    try {
      const token = await currentUser.getIdToken();
      const analysis = await getWorkflowAnalysis(workflowSession._id, token, {
        withEpisodes: true,
      });
      if (analysis) setWorkflowAnalysis(analysis);
      if (!analysis?.episodes?.length) {
        toast({
          title: "No episodes built",
          description:
            "This session did not have enough captured activity to summarise.",
        });
      }
    } catch (e) {
      toast({
        title: "Could not build episodes",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setEpisodesBuilding(false);
    }
  };

  // The single way into candidate review. Everything that used to open a side
  // panel, an evaluation modal or a recording jump now
  // calls this; `tab` only pre-selects a section of the same surface.
  const openReview = (submission, tab) => {
    if (!submission) return;
    setRecordingSeekSec(null);
    if (tab) {
      reviewTabOverrideRef.current = true;
      const mode =
        submission?.evidenceMode || assessment?.evidenceMode || "screen";
      const canShowRecording = mode !== "workflow" && mode !== "none";
      setEvaluationTab(
        tab === "recording" && !canShowRecording ? "summary" : tab
      );
    }
    setSelectedEvaluationSubmission(submission);
    setShowEvaluationModal(true);
  };

  const [submissionToDelete, setSubmissionToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [shareModalSubmission, setShareModalSubmission] = useState(null);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [shareEmailSending, setShareEmailSending] = useState(false);
  const [shareEmailSent, setShareEmailSent] = useState(false);

  const [dashboardTab, setDashboardTab] = useState("candidates");
  const [shareTab, setShareTab] = useState("single");
  const [shareCandidateName, setShareCandidateName] = useState("");
  const [shareCandidateEmail, setShareCandidateEmail] = useState("");
  const [generatedShareLink, setGeneratedShareLink] = useState("");
  const [generatedShareSubmissionId, setGeneratedShareSubmissionId] = useState("");
  const [isGeneratingShareLink, setIsGeneratingShareLink] = useState(false);
  const [shareLinkCopiedInModal, setShareLinkCopiedInModal] = useState(false);
  const [shareEmailSendingForGenerated, setShareEmailSendingForGenerated] = useState(false);
  const [shareEmailSentForGenerated, setShareEmailSentForGenerated] = useState(false);

  const handleDeleteClick = (submission) => {
    setSubmissionToDelete(submission);
  };

  const handleDeleteConfirm = async () => {
    if (!submissionToDelete || !currentUser) return;

    setIsDeleting(true);
    try {
      const token = await currentUser.getIdToken();
      const result = await deleteSubmission(submissionToDelete._id, token);

      if (result.success) {
        // Remove the submission from the list
        setSubmissions((prev) =>
          prev.filter((s) => s._id !== submissionToDelete._id)
        );
        setSubmissionToDelete(null);
      } else {
        setError(result.error || "Failed to delete submission");
      }
    } catch (err) {
      console.error("Error deleting submission:", err);
      setError(err.message || "An error occurred while deleting");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setSubmissionToDelete(null);
  };

  const applyBehavioralPendingLocally = (submissionId) => {
    const checksTotal = assessment?.behavioralChecks?.length ?? 0;
    const pendingPatch = {
      behavioralGradingStatus: "pending",
      behavioralGradingError: null,
      behavioralGradingReport: null,
      behavioralGradingProgress: {
        phase: "sandbox",
        phaseLabel: "Queued — provisioning E2B sandbox…",
        checkIndex: null,
        checksTotal,
        agentSteps: [],
        completedChecks: [],
      },
    };
    setSubmissions((prev) =>
      prev.map((s) =>
        s._id === submissionId ? { ...s, ...pendingPatch } : s
      )
    );
    setSelectedEvaluationSubmission((prev) =>
      prev?._id === submissionId ? { ...prev, ...pendingPatch } : prev
    );
  };

  const handleRunBehavioralGrading = async (submission) => {
    if (!currentUser) {
      toast({
        title: "Not signed in",
        description: "Please sign in to run behavioral grading.",
        variant: "destructive",
      });
      return;
    }

    if (submission.behavioralGradingStatus === "pending") {
      return;
    }

    setBehavioralGradingSubmissionId(submission._id);
    applyBehavioralPendingLocally(submission._id);
    if (selectedEvaluationSubmission?._id === submission._id) {
      setExpandedBehavioralCases(new Set());
    }
    try {
      const token = await currentUser.getIdToken();
      const result = await runBehavioralGrading(submission._id, token);
      if (!result.success) {
      toast({
          title: "Could not start behavioral grading",
          description: result.error || "Please try again.",
          variant: "destructive",
        });
        setBehavioralGradingSubmissionId(null);
        await loadSubmissions();
        return;
      }

      toast({
        title: "Behavioral grading queued",
        description: "Agent is running checks in the sandbox — trace updates live below.",
      });
      await loadSubmissions();
    } catch (error) {
      toast({
        title: "Could not start behavioral grading",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
      setBehavioralGradingSubmissionId(null);
      await loadSubmissions();
    }
  };

  useEffect(() => {
    if (!behavioralGradingSubmissionId) return;
    const sub = submissions.find((s) => s._id === behavioralGradingSubmissionId);
    if (sub && sub.behavioralGradingStatus !== "pending") {
      setBehavioralGradingSubmissionId(null);
    }
  }, [submissions, behavioralGradingSubmissionId]);

  const hasPendingBehavioralGrading = submissions.some(
    (s) => s.behavioralGradingStatus === "pending"
  );

  useEffect(() => {
    if (!hasPendingBehavioralGrading || !assessmentId || !currentUser) return;

    const interval = setInterval(async () => {
      try {
        const token = await currentUser.getIdToken();
        const result = await getSubmissionsForAssessment(assessmentId, token);
        if (result.success) setSubmissions(result.data || []);
      } catch {
        /* ignore poll errors */
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [hasPendingBehavioralGrading, assessmentId, currentUser]);

  const loadBehavioralArtifacts = async (submission) => {
    if (!currentUser) return;
    const keys = (
      submission.behavioralGradingReport?.cases || []
    ).flatMap((c) => c.artifacts || []);
    if (!keys.length) {
      setBehavioralArtifactUrls({});
      behavioralArtifactsLoadedForIdRef.current = submission._id;
      return;
    }
    if (behavioralArtifactsLoadedForIdRef.current === submission._id) {
      return;
    }

    setBehavioralArtifactsLoading(true);
    try {
      const token = await currentUser.getIdToken();
      const nextUrls = {};
      for (const key of keys) {
        const result = await getBehavioralArtifactBlob(submission._id, key, token);
        if (result.success && result.data) {
          nextUrls[key] = URL.createObjectURL(result.data);
        }
      }
      setBehavioralArtifactUrls(nextUrls);
      behavioralArtifactsLoadedForIdRef.current = submission._id;
    } finally {
      setBehavioralArtifactsLoading(false);
    }
  };

  const getCandidateLink = (submission) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}${createPageUrl("CandidateAssessment")}?token=${
      submission.token
    }`;
  };

  const openShareModal = (submission) => {
    setShareModalSubmission(submission);
    setShareLinkCopied(false);
    setShareEmailSending(false);
    setShareEmailSent(false);
  };

  const closeShareModal = () => {
    setShareModalSubmission(null);
    setShareLinkCopied(false);
    setShareEmailSending(false);
    setShareEmailSent(false);
  };

  const handleCopyLinkInModal = async () => {
    if (!shareModalSubmission) return;
    const link = getCandidateLink(shareModalSubmission);
    try {
      await navigator.clipboard.writeText(link);
      setShareLinkCopied(true);
      toast({ title: "Link copied", description: "Invite link copied to clipboard." });
      setTimeout(() => setShareLinkCopied(false), 2000);
    } catch {
      toast({
        title: "Failed to copy",
        description: "Failed to copy link to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleSendInviteEmail = async () => {
    if (!shareModalSubmission?._id || !currentUser) return;
    setShareEmailSending(true);
    try {
      const result = await sendInvites([shareModalSubmission._id]);
      if (result.success) {
        setShareEmailSent(true);
        toast({ title: "Invite sent", description: "Invite email sent to candidate." });
      } else {
        toast({
          title: "Failed to send email",
          description: result.error || "Could not send invite email.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Failed to send email",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setShareEmailSending(false);
    }
  };

  const resetShareModalState = () => {
    setGeneratedShareLink("");
    setGeneratedShareSubmissionId("");
    setShareCandidateName("");
    setShareCandidateEmail("");
    setShareEmailSentForGenerated(false);
  };

  const handleGenerateShareLink = async () => {
    if (!shareCandidateName.trim() || !assessmentId || !currentUser) return;
    setIsGeneratingShareLink(true);
    try {
      const token = await currentUser.getIdToken();
      const result = await generateShareLink(
        {
          assessmentId,
          candidateName: shareCandidateName.trim(),
          ...(shareCandidateEmail.trim() && { candidateEmail: shareCandidateEmail.trim() }),
        },
        token
      );
      if (result.success) {
        setGeneratedShareLink(result.data.shareLink);
        setGeneratedShareSubmissionId(result.data.submissionId);
        loadSubmissions();
      } else {
        const errorMsg = "error" in result ? result.error : "Failed to generate link";
        if (errorMsg.includes("SUBSCRIPTION_LIMIT_REACHED")) {
          toast({
            title: "Limit reached",
            description: "You've reached a plan limit. Upgrade to continue.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Failed to generate link",
            description: errorMsg,
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      toast({
        title: "Failed to generate link",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingShareLink(false);
    }
  };

  const handleCopyGeneratedShareLink = async () => {
    if (!generatedShareLink) return;
    try {
      await navigator.clipboard.writeText(generatedShareLink);
      setShareLinkCopiedInModal(true);
      toast({ title: "Link copied", description: "Assessment link copied to clipboard." });
      setTimeout(() => setShareLinkCopiedInModal(false), 2000);
    } catch {
      toast({
        title: "Failed to copy",
        description: "Could not copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleSendEmailForGeneratedLink = async () => {
    if (!generatedShareSubmissionId) return;
    setShareEmailSendingForGenerated(true);
    try {
      const result = await sendInvites([generatedShareSubmissionId]);
      if (result.success) {
        setShareEmailSentForGenerated(true);
        toast({ title: "Invite sent", description: "Invite email sent to candidate." });
      } else {
        toast({
          title: "Failed to send email",
          description: "error" in result ? result.error : "Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Failed to send email",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setShareEmailSendingForGenerated(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F2]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm mb-1">
          <Link
            to={createPageUrl("Home")}
              className="text-gray-500 hover:text-[#21201C]"
          >
            ← Back to Assessments
          </Link>
            {assessmentId ? (
              <>
                <span className="text-gray-300 hidden sm:inline" aria-hidden>
                  ·
                </span>
                <Link
                  to={
                    createPageUrl("AssessmentEditor") + `?id=${assessmentId}`
                  }
                  className="text-gray-500 hover:text-[#21201C] inline-flex items-center gap-1"
                >
                  <Pencil className="w-3.5 h-3.5 shrink-0" />
                  Edit assessment
                </Link>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-medium tracking-[-0.012em] text-[#21201C]">
              {assessment ? assessment.title : "Submissions Dashboard"}
            </h1>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              title="Refresh submissions"
              aria-label="Refresh submissions"
              className="h-7 w-7 text-gray-400 hover:text-[#21201C]"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <p className="text-gray-500 text-sm">
            {assessment
              ? `Track candidate progress and review submissions for "${assessment.title}"`
              : "Track candidate progress and review submissions"}
          </p>
        </motion.div>

        <Tabs
          value={dashboardTab}
          onValueChange={setDashboardTab}
          className="w-full space-y-6"
        >
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-lg bg-gray-100/90 p-1 sm:inline-flex sm:w-auto sm:gap-0">
            <TabsTrigger value="candidates" className="text-sm">
              Candidates
            </TabsTrigger>
            <TabsTrigger value="insights" className="text-sm">
              Insights
            </TabsTrigger>
            <TabsTrigger value="invites" className="text-sm">
              Invites
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="candidates"
            className="mt-0 space-y-6 focus-visible:outline-none"
          >
        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
        >
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-2xl font-medium tracking-[-0.012em] text-gray-900">
              {stats.totalInvited}
            </p>
            <p className="text-sm text-gray-500">Total Invited</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-5 h-5 text-blue-500" />
              <span className="text-xs text-green-600 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                {startRate}%
              </span>
            </div>
            <p className="text-2xl font-medium tracking-[-0.012em] text-gray-900">{stats.started}</p>
            <p className="text-sm text-gray-500">Started</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-xs text-green-600 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                {completionRate}%
              </span>
            </div>
            <p className="text-2xl font-medium tracking-[-0.012em] text-gray-900">
              {stats.completed}
            </p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingDown className="w-5 h-5 text-red-500" />
              <span className="text-xs text-red-600 flex items-center gap-0.5">
                <ArrowDownRight className="w-3 h-3" />
                {dropoffRate}%
              </span>
            </div>
            <p className="text-2xl font-medium tracking-[-0.012em] text-red-600">
              {stats.started - stats.completed}
            </p>
            <p className="text-sm text-gray-500">Dropoff</p>
          </div>
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="sticky top-0 z-20 bg-[#FAF9F2]/95 backdrop-blur-sm border border-gray-200 rounded-xl p-4 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search candidates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#21201C]/20"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In Progress</option>
              <option value="not_started">Not Started</option>
              <option value="opted_out">Opted Out</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          {assessmentId && (
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:ml-auto">
              <Button
                type="button"
                variant="outline"
                disabled={exportingEvidence || isLoading}
                onClick={handleExportAllEvidence}
                className="flex items-center gap-2 w-full sm:w-auto justify-center border-gray-300"
              >
                {exportingEvidence ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
                Export submission evidence
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setDashboardTab("invites");
                  setShareTab("single");
                  resetShareModalState();
                }}
                className="bg-[#21201C] hover:bg-[#35332D] flex items-center gap-2 w-full sm:w-auto justify-center"
              >
                <Share2 className="w-4 h-4" />
                Share assessment
              </Button>
            </div>
          )}
        </motion.div>
        <p className="text-xs text-gray-500 -mt-2 mb-1">
          Click a candidate to review their scores, recording, code, and
          conversations.
        </p>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading State */}
        {isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="w-8 h-8 border-2 border-[#21201C]/30 border-t-[#21201C] rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-500">Loading submissions...</p>
          </div>
        ) : sortedSubmissions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No submissions yet
            </h3>
            <p className="text-gray-500">
              {submissions.length === 0
                ? "No candidates have been invited to this assessment yet."
                : "No submissions match your search criteria."}
            </p>
          </div>
        ) : (
          /* Submissions Table */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                    Candidate
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                    Status
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                    Time Spent
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                    Combined
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedSubmissions.map((submission) => {
                  const candidateName = submission.candidateName || "Unknown";
                  const candidateEmail = submission.candidateEmail || "";
                  const initials = candidateName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);

                  const reviewable = hasReviewableEvidence(submission);

                  return (
                    <tr
                      key={submission._id}
                      role={reviewable ? "button" : undefined}
                      tabIndex={reviewable ? 0 : undefined}
                      aria-label={
                        reviewable ? `Review ${candidateName}` : undefined
                      }
                      onKeyDown={(e) => {
                        if (
                          reviewable &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault();
                          openReview(submission);
                        }
                      }}
                      onClick={
                        reviewable ? () => openReview(submission) : undefined
                      }
                      className={`transition-colors ${
                        reviewable
                          ? "hover:bg-gray-50 cursor-pointer"
                          : ""
                      }`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#21201C] flex items-center justify-center text-white text-sm font-medium">
                            {initials}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {candidateName}
                            </p>
                            {candidateEmail && (
                              <p className="text-xs text-gray-500">
                                {candidateEmail}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(submission.status, submission)}
                          {submission.optedOut && submission.optOutReason && (
                            <p
                              className="text-xs text-gray-500 italic max-w-xs truncate"
                              title={submission.optOutReason}
                            >
                              "{submission.optOutReason}"
                            </p>
                          )}
                          {submission.behavioralGradingStatus && (
                            <Badge
                              className={`w-fit ${
                                submission.behavioralGradingStatus === "completed"
                                  ? submission.behavioralGradingReport?.setup
                                      ?.status === "failed"
                                    ? "bg-red-100 text-red-700"
                                    : submission.behavioralGradingReport?.setup
                                          ?.status === "degraded"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-green-100 text-green-700"
                                  : submission.behavioralGradingStatus === "failed"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              Behavioral: {submission.behavioralGradingStatus}
                              {submission.behavioralGradingStatus === "completed" &&
                              submission.behavioralGradingReport?.setup?.status &&
                              submission.behavioralGradingReport.setup.status !==
                                "ready"
                                ? ` (${submission.behavioralGradingReport.setup.status})`
                                : ""}
                            </Badge>
                          )}
                          {submission.behavioralGradingStatus === "failed" &&
                            submission.behavioralGradingError && (
                              <p
                                className="text-xs text-red-600 max-w-xs truncate"
                                title={submission.behavioralGradingError}
                              >
                                {submission.behavioralGradingError}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">
                        {formatTimeSpent(submission.timeSpent)}
                      </td>
                      <td className="px-5 py-4">
                        {(() => {
                          const combinedScore =
                            getCombinedScore0to100(submission);
                          const breakdown = getCombinedScoreBreakdownParts(
                            submission
                          ).join(" · ");
                          const hasEvaluationReport =
                            hasEvaluableWorkflowReport(submission);
                          // Show loading while waiting for first score signal (recording rubric, behavioral, or trace)
                          const submittedRecently =
                            submission.submittedAt &&
                            Date.now() - new Date(submission.submittedAt).getTime() < 15 * 60 * 1000; // 15 min
                          const evaluationPending =
                            submission.status === "submitted" &&
                            combinedScore == null &&
                            !hasEvaluationReport &&
                            (submission.evaluationStatus === "pending" ||
                              evaluatingSubmissionId === submission._id ||
                              (submission.evaluationStatus !== "failed" &&
                                submittedRecently));
                          if (combinedScore != null) {
                            return (
                              <div className="flex flex-col gap-0.5">
                                {/* The denominator is not decoration: this is a
                                    0–100 score sitting directly above "Process
                                    1.0/10", so a bare "10" reads as full marks
                                    when it is the worst possible result. */}
                                <span className="text-lg font-bold text-gray-900 tabular-nums">
                                  {Math.round(combinedScore)}
                                  <span className="text-xs font-medium text-gray-400">
                                    /100
                                  </span>
                                </span>
                                <span
                                  className="text-[10px] text-gray-500 leading-snug max-w-[11rem] truncate"
                                  title={
                                    breakdown ||
                                    "Average of available score signals (0–100 each)"
                                  }
                                >
                                  {breakdown || "Combined"}
                                </span>
                              </div>
                            );
                          }
                          if (evaluationPending) {
                            return (
                              <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                                <span>Scoring…</span>
                              </div>
                            );
                          }
                          if (
                            submission.status === "submitted" &&
                            !hasEvaluationReport &&
                            submission.evaluationStatus === "failed"
                          ) {
                            return (
                              <span className="text-xs text-amber-700">
                                Scoring failed
                              </span>
                            );
                          }
                          return (
                            <span className="text-xs text-gray-400">—</span>
                          );
                        })()}
                      </td>
                      <td
                        className="px-5 py-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          {reviewable && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openReview(submission)}
                            >
                              Review
                            </Button>
                          )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                          <Button
                              variant="outline"
                            size="sm"
                              className="h-8 w-8 p-0"
                              title="More actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Open menu</span>
                          </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              onClick={() => openShareModal(submission)}
                            >
                              <Send className="mr-2 h-4 w-4" />
                              Share or email invite
                            </DropdownMenuItem>
                            {submission.status === "submitted" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  handleRunBehavioralGrading(submission)
                                }
                                disabled={
                                  behavioralGradingSubmissionId ===
                                  submission._id
                                }
                              >
                                {behavioralGradingSubmissionId ===
                                submission._id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="mr-2 h-4 w-4" />
                                )}
                                Run behavioral grading
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600 focus:bg-red-50"
                            onClick={() => handleDeleteClick(submission)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete submission
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        )}
          </TabsContent>

          <TabsContent
            value="insights"
            className="mt-0 space-y-6 focus-visible:outline-none"
          >
            {dropoffAnalysis && dropoffAnalysis.totalWithFeedback > 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
                className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-xl border border-orange-200 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setIsDropoffAnalysisExpanded(!isDropoffAnalysisExpanded)
                  }
                  className="w-full p-6 flex items-center justify-between hover:bg-orange-100/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <TrendingDown className="w-6 h-6 text-orange-600" />
                    <h2 className="text-xl font-medium tracking-[-0.012em] text-gray-900">
                      Dropoff feedback analysis
                    </h2>
                    <Badge className="bg-orange-100 text-orange-700">
                      {dropoffAnalysis.totalWithFeedback} feedback
                      {dropoffAnalysis.totalWithFeedback !== 1 ? "s" : ""}
                    </Badge>
            </div>
                  {isDropoffAnalysisExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-600" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-600" />
                  )}
                </button>

                {isDropoffAnalysisExpanded && (
                  <div className="px-6 pb-6">
                    {dropoffAnalysis.suggestions.length > 0 && (
                      <div className="mb-6">
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">
                          Recommendations
                        </h3>
                        <div className="space-y-3">
                          {dropoffAnalysis.suggestions.map((suggestion, index) => (
                            <div
                              key={index}
                              className={`p-4 rounded-lg border-l-4 ${
                                suggestion.priority === "high"
                                  ? "bg-red-50 border-red-500"
                                  : suggestion.priority === "medium"
                                    ? "bg-yellow-50 border-yellow-500"
                                    : "bg-blue-50 border-blue-500"
                              }`}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className="text-sm font-semibold text-gray-900">
                                      {suggestion.issue}
                                    </span>
                                    <Badge
                                      className={
                                        suggestion.priority === "high"
                                          ? "bg-red-100 text-red-700"
                                          : suggestion.priority === "medium"
                                            ? "bg-yellow-100 text-yellow-700"
                                            : "bg-blue-100 text-blue-700"
                                      }
                                    >
                                      {suggestion.priority} priority
                                    </Badge>
                                    <span className="text-xs text-gray-500">
                                      ({suggestion.count} mention
                                      {suggestion.count !== 1 ? "s" : ""})
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-700">
                                    {suggestion.suggestion}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">
                        Common themes
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Object.entries(dropoffAnalysis.themes)
                          .filter(([, theme]) => theme.count > 0)
                          .map(([themeName, theme]) => (
                            <div
                              key={themeName}
                              className="bg-white rounded-lg border border-orange-200 p-3"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-gray-900 capitalize">
                                  {themeName === "notInterested"
                                    ? "Not interested"
                                    : themeName}
                                </span>
                                <Badge className="bg-orange-100 text-orange-700">
                                  {theme.count}
                                </Badge>
                              </div>
                              {theme.examples.length > 0 && (
                                <div className="space-y-1">
                                  {theme.examples.slice(0, 2).map((example, idx) => (
                                    <p
                                      key={idx}
                                      className="text-xs text-gray-600 italic truncate"
                                      title={example}
                                    >
                                      &ldquo;{example}&rdquo;
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-600 text-sm">
                  No opt-out feedback to analyze yet.
                </p>
                <p className="text-xs text-gray-400 mt-2 max-w-md mx-auto">
                  When candidates opt out and leave a reason, themes and
                  recommendations will appear here.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="invites"
            className="mt-0 focus-visible:outline-none"
          >
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900">
                Invite candidates
              </h2>
              <p className="text-sm text-gray-500 mt-1 mb-6">
                Generate a link for one candidate or import multiple at once.
              </p>
              {!assessmentId ? (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Open this page from an assessment to generate invite links.
                </p>
              ) : (
            <Tabs
              value={shareTab}
              onValueChange={(v) => {
                setShareTab(v);
                resetShareModalState();
              }}
            >
              <TabsList className="w-full mb-4">
                <TabsTrigger value="single" className="flex-1">
                  Single candidate
                </TabsTrigger>
                <TabsTrigger value="bulk" className="flex-1">
                  Multiple candidates
                </TabsTrigger>
              </TabsList>

              <TabsContent value="single">
                <div className="space-y-4 py-2">
                  {!generatedShareLink ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Candidate name *
                        </label>
                        <Input
                          value={shareCandidateName}
                              onChange={(e) =>
                                setShareCandidateName(e.target.value)
                              }
                          placeholder="Enter candidate's full name"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Candidate email{" "}
                          <span className="text-gray-400 font-normal">
                            (optional — required to send invite)
                          </span>
                        </label>
                        <Input
                          value={shareCandidateEmail}
                              onChange={(e) =>
                                setShareCandidateEmail(e.target.value)
                              }
                          placeholder="candidate@example.com"
                          type="email"
                          onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  shareCandidateName.trim()
                                )
                              handleGenerateShareLink();
                          }}
                        />
                      </div>
                          <div className="flex justify-end gap-2 flex-wrap pt-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                                setDashboardTab("candidates");
                            resetShareModalState();
                          }}
                        >
                              Back to candidates
                        </Button>
                        <Button
                          onClick={handleGenerateShareLink}
                          disabled={
                            !shareCandidateName.trim() || isGeneratingShareLink
                          }
                          className="bg-[#21201C] hover:bg-[#35332D]"
                        >
                          {isGeneratingShareLink
                            ? "Generating..."
                            : "Generate link"}
                        </Button>
                          </div>
                    </>
                  ) : (
                    <>
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm text-green-800 mb-2">
                          Link generated successfully!
                        </p>
                        <div className="flex items-center gap-2">
                          <Input
                            value={generatedShareLink}
                            readOnly
                            className="flex-1 bg-white text-sm"
                          />
                          <Button
                            onClick={handleCopyGeneratedShareLink}
                            size="sm"
                            variant="outline"
                            className="flex-shrink-0"
                          >
                            {shareLinkCopiedInModal ? (
                              <>
                                <Check className="w-4 h-4 mr-2" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4 mr-2" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      {shareCandidateEmail.trim() && (
                            <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg gap-3 flex-wrap">
                          <span className="text-sm text-gray-600">
                            Send invite email to{" "}
                            <span className="font-medium text-gray-900">
                              {shareCandidateEmail.trim()}
                            </span>
                          </span>
                          <Button
                            onClick={handleSendEmailForGeneratedLink}
                            disabled={
                              shareEmailSendingForGenerated ||
                              shareEmailSentForGenerated
                            }
                            size="sm"
                                className="bg-[#21201C] hover:bg-[#35332D] flex-shrink-0"
                          >
                            {shareEmailSentForGenerated ? (
                              <>
                                <Check className="w-4 h-4 mr-2" />
                                Sent!
                              </>
                            ) : shareEmailSendingForGenerated ? (
                              "Sending..."
                            ) : (
                              "Send email"
                            )}
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-gray-500">
                            Share this link with the candidate. They can access
                            and complete the assessment.
                      </p>
                          <div className="flex justify-end pt-2">
                        <Button
                          onClick={() => {
                                setDashboardTab("candidates");
                            resetShareModalState();
                          }}
                          className="bg-[#21201C] hover:bg-[#35332D]"
                        >
                          Done
                        </Button>
                          </div>
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="bulk">
                <BulkInviteContent
                  assessmentId={assessmentId}
                  onSuccess={() => loadSubmissions()}
                  onDone={() => {
                        setDashboardTab("candidates");
                    resetShareModalState();
                  }}
                />
              </TabsContent>
            </Tabs>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Delete Confirmation Modal */}
        <Dialog
          open={!!submissionToDelete}
          onOpenChange={(open) => {
            if (!open) handleDeleteCancel();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Candidate Submission</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the submission from{" "}
                <strong>
                  {submissionToDelete?.candidateName || "this candidate"}
                </strong>
                ? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-3 mt-4">
              <Button
                variant="outline"
                onClick={handleDeleteCancel}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Share assessment link modal — copy link or send invite email (per row) */}
        <Dialog
          open={!!shareModalSubmission}
          onOpenChange={(open) => {
            if (!open) closeShareModal();
          }}
        >
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Share assessment link</DialogTitle>
              <DialogDescription>
                Copy the link or send an invite email to{" "}
                {shareModalSubmission?.candidateName || "the candidate"}.
              </DialogDescription>
            </DialogHeader>
            {shareModalSubmission && (
              <div className="space-y-4 py-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={getCandidateLink(shareModalSubmission)}
                    readOnly
                    className="flex-1 bg-gray-50 text-sm font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyLinkInModal}
                    className="flex-shrink-0"
                  >
                    {shareLinkCopied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                {shareModalSubmission.candidateEmail ? (
                  <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg gap-3">
                    <span className="text-sm text-gray-600">
                      Send invite email to{" "}
                      <span className="font-medium text-gray-900">
                        {shareModalSubmission.candidateEmail}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSendInviteEmail}
                      disabled={shareEmailSending || shareEmailSent}
                      className="bg-[#21201C] hover:bg-[#35332D] flex-shrink-0"
                    >
                      {shareEmailSent ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Sent
                        </>
                      ) : shareEmailSending ? (
                        "Sending..."
                      ) : (
                        "Send email"
                      )}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    No email on file for this candidate. Add an email when
                    generating the link to enable sending invite emails.
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={closeShareModal}
                    className="bg-[#21201C] hover:bg-[#35332D]"
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Evaluation Modal */}
        <Dialog
          open={showEvaluationModal}
          onOpenChange={(open) => {
            if (!open) {
              setShowEvaluationModal(false);
              setSelectedEvaluationSubmission(null);
              setRecordingSeekSec(null);
            }
          }}
        >
          <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden">
            <DialogHeader className="pr-8">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="truncate">
                    {selectedEvaluationSubmission?.candidateName ||
                      "Candidate review"}
                  </DialogTitle>
                  <DialogDescription className="truncate">
                    {selectedEvaluationSubmission?.candidateEmail ||
                      "No email on file"}
                  </DialogDescription>
                </div>
                {selectedEvaluationSubmission ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="shrink-0">
                        Actions
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {selectedEvaluationSubmission.githubLink ? (
                        <DropdownMenuItem asChild>
                          <a
                            href={selectedEvaluationSubmission.githubLink}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Open GitHub repo
                          </a>
                        </DropdownMenuItem>
                      ) : null}
                      {selectedEvaluationSubmission.codeSource === "upload" ? (
                        <DropdownMenuItem
                          onClick={() =>
                            handleDownloadCodeArchive(
                              selectedEvaluationSubmission
                            )
                          }
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download archive
                        </DropdownMenuItem>
                      ) : null}
                      {selectedEvaluationSubmission.status === "submitted" ? (
                        <DropdownMenuItem
                          onClick={() =>
                            handleRunBehavioralGrading(
                              selectedEvaluationSubmission
                            )
                          }
                          disabled={
                            behavioralGradingSubmissionId ===
                            selectedEvaluationSubmission._id
                          }
                        >
                          <Play className="mr-2 h-4 w-4" />
                          Re-run behavioral grading
                        </DropdownMenuItem>
                      ) : null}
                      {selectedEvaluationSubmission.status === "submitted" ? (
                        <DropdownMenuItem
                          onClick={() =>
                            handleRunEvaluation(selectedEvaluationSubmission)
                          }
                          disabled={
                            evaluatingSubmissionId ===
                            selectedEvaluationSubmission._id
                          }
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Re-run scoring
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        onClick={() =>
                          openShareModal(selectedEvaluationSubmission)
                        }
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Share link or email
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600 focus:bg-red-50"
                        onClick={() => {
                          const target = selectedEvaluationSubmission;
                          setShowEvaluationModal(false);
                          setSelectedEvaluationSubmission(null);
                          handleDeleteClick(target);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete submission
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </DialogHeader>

            {/* Scoreboard — stays put across tabs, so the numbers never
                depend on which section you happen to be looking at. */}
            {selectedEvaluationSubmission ? (
              <div className="border-y border-gray-200 -mx-6 px-6 py-3">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  {(() => {
                    const combined = getCombinedScore0to100(
                      selectedEvaluationSubmission
                    );
                    const breakdown = getCombinedScoreBreakdownParts(
                      selectedEvaluationSubmission
                    ).join(" · ");
                    const processAvg = getRecordingRubricAvg10(
                      selectedEvaluationSubmission
                    );
                    const behPct = getBehavioralPass0to100(
                      selectedEvaluationSubmission
                    );
                    return (
                      <>
                        <div>
                          <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                            Combined
                          </p>
                          <p className="text-2xl font-medium tracking-[-0.012em] text-gray-900 tabular-nums leading-tight">
                            {combined != null ? Math.round(combined) : "—"}
                            {combined != null ? (
                              <span className="text-sm font-medium text-gray-400">
                                /100
                              </span>
                            ) : null}
                          </p>
                          {breakdown ? (
                            <p className="text-[10px] text-gray-500 leading-snug max-w-[16rem]">
                              {breakdown}
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                            Process
                          </p>
                          <p className="text-lg font-semibold text-gray-900 tabular-nums leading-tight">
                            {processAvg != null
                              ? `${processAvg.toFixed(1)}/10`
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                            Behavioral
                          </p>
                          <p className="text-lg font-semibold text-gray-900 tabular-nums leading-tight">
                            {behPct != null ? `${Math.round(behPct)}%` : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                            Time spent
                          </p>
                          <p className="text-lg font-semibold text-gray-900 leading-tight">
                            {formatTimeSpent(
                              selectedEvaluationSubmission.timeSpent
                            )}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 ml-auto">
                          {getStatusBadge(
                            selectedEvaluationSubmission.status,
                            selectedEvaluationSubmission
                          )}
                          {selectedEvaluationSubmission.behavioralGradingStatus ? (
                            <Badge
                              className={
                                selectedEvaluationSubmission.behavioralGradingStatus ===
                                "completed"
                                  ? "bg-green-100 text-green-700"
                                  : selectedEvaluationSubmission.behavioralGradingStatus ===
                                      "failed"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-amber-100 text-amber-800"
                              }
                            >
                              Behavioral:{" "}
                              {
                                selectedEvaluationSubmission.behavioralGradingStatus
                              }
                            </Badge>
                          ) : null}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : null}

            <Tabs
              value={evaluationTab}
              onValueChange={setEvaluationTab}
              className="mt-2"
            >
              <TabsList className="w-full justify-start">
                <TabsTrigger
                  value="summary"
                  title="Scores, rubric verdicts, and what happened in the session"
                >
                  Summary
                </TabsTrigger>
                {recordsScreen ? (
                  <TabsTrigger
                    value="recording"
                    title="Screen recording and captured activity"
                  >
                    Recording
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="execution" title="Behavioral grading and the submitted code">
                  Code
                </TabsTrigger>
                <TabsTrigger
                  value="agent"
                  title="In-session voice companion"
                >
                  Conversations
                </TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4">
                <div className="max-h-[58vh] overflow-y-auto pr-1 space-y-4">
                  <EvidenceIntegrityBanner
                    report={
                      selectedEvaluationSubmission?.evaluationReport
                    }
                  />

                  {selectedEvaluationSubmission ? (
                    <BehavioralProductCard
                      highlights={getBehavioralCheckHighlights(
                        selectedEvaluationSubmission
                      )}
                      onSeeCode={() => setEvaluationTab("execution")}
                    />
                  ) : null}

                  {/* Rubric verdicts (when assessment had evaluation criteria) */}
                  {selectedEvaluationSubmission?.evaluationReport ? (
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Rubric
                      </h3>

                      {/* Session summary from evaluation report */}
                      {selectedEvaluationSubmission?.evaluationReport?.session_summary && (
                        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                          <p className="text-xs font-medium text-gray-500 uppercase font-mono tracking-[0.03em] mb-2">
                            Session summary
                          </p>
                          <p className="text-sm text-gray-700 leading-relaxed">
                            {selectedEvaluationSubmission.evaluationReport.session_summary}
                          </p>
                        </div>
                      )}

                      {selectedEvaluationSubmission.evaluationReport
                        .criteria_results?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase font-mono tracking-[0.03em] mb-3">
                            Criteria results
                          </p>
                          <div className="space-y-3">
                            {selectedEvaluationSubmission.evaluationReport.criteria_results.map(
                              (r, i) => {
                                const scoreColor =
                                  r.evaluable
                                    ? r.score >= 7
                                      ? "border-l-emerald-500 bg-emerald-50/50"
                                      : r.score >= 4
                                        ? "border-l-amber-500 bg-amber-50/50"
                                        : "border-l-gray-400 bg-gray-50"
                                    : "border-l-gray-300 bg-gray-50";
                                const scoreTextColor = r.evaluable
                                  ? r.score >= 7
                                    ? "text-emerald-700"
                                    : r.score >= 4
                                      ? "text-amber-700"
                                      : "text-gray-700"
                                  : "text-gray-500";
                                return (
                                <div
                                  key={i}
                                  className={`rounded-lg border border-gray-200 border-l-4 p-4 shadow-sm ${scoreColor}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="font-semibold text-gray-900">
                                      {r.criterion}
                                    </p>
                                    <span className={`text-xl font-medium tracking-[-0.012em] tabular-nums shrink-0 ${scoreTextColor}`}>
                                      {r.evaluable ? `${r.score}` : "—"}/10
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-2 mt-1 mb-2">
                                    <span className="text-xs text-gray-500">
                                      Confidence: {r.confidence}
                                    </span>
                                    {!r.evaluable && (
                                      <span className="text-amber-600 text-xs">
                                        Not evaluable
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-700 leading-relaxed">
                                    {r.verdict}
                                  </p>
                                  {r.evidence?.length > 0 && (
                                    <EvidenceMomentChips
                                      evidence={r.evidence}
                                      onSeek={
                                        recordsScreen
                                          ? handleSeekRecording
                                          : null
                                      }
                                    />
                                  )}
                                </div>
                                );
                              }
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Spoken reasoning (voice companion): what they said aloud,
                      claim-checked against the captured timeline. Renders
                      nothing for reports without a communication section. */}
                  <CommunicationCard
                    communication={
                      selectedEvaluationSubmission?.evaluationReport
                        ?.communication
                    }
                    onSeek={recordsScreen ? handleSeekRecording : null}
                  />

                  {/* Workflow capture: the hooks-first evidence path. Present
                      for workflow/both submissions; absent for screen-only,
                      where this renders nothing at all. */}
                  {workflowSession && (
                    <div className="mb-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
                        <h4 className="text-sm font-semibold text-gray-900">
                          How they worked
                        </h4>
                        <span className="text-xs text-gray-500">
                          {workflowSession.stats?.promptCount ?? 0} prompts ·{" "}
                          {workflowSession.stats?.toolUseCount ?? 0} tool calls ·{" "}
                          {workflowSession.stats?.totalEvents ?? 0} events
                        </span>
                        {workflowSession.video?.chunks?.length > 0 && (
                          <a
                            href={workflowVideoUrl(workflowSession._id)}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-xs font-medium text-blue-600 hover:underline"
                          >
                            Open recording
                          </a>
                        )}
                      </div>

                      {workflowLoading && !workflowAnalysis ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500 px-4 py-4">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading captured workflow…
                        </div>
                      ) : (
                        <>
                          {/* Counted, not judged — the factual floor beside the scores */}
                          {workflowAnalysis?.metrics && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100 border-b border-gray-100">
                              {[
                                [
                                  "read : edit",
                                  workflowAnalysis.metrics.readEditRatio == null
                                    ? "—"
                                    : `${workflowAnalysis.metrics.readEditRatio} : 1`,
                                ],
                                [
                                  "writes tested",
                                  workflowAnalysis.metrics.verifiedWriteRatio == null
                                    ? "—"
                                    : `${Math.round(workflowAnalysis.metrics.verifiedWriteRatio * 100)}%`,
                                ],
                                [
                                  "low-effort prompts",
                                  workflowAnalysis.metrics.lowEffortPromptRatio == null
                                    ? "—"
                                    : `${Math.round(workflowAnalysis.metrics.lowEffortPromptRatio * 100)}%`,
                                ],
                                [
                                  "code from agent",
                                  workflowAnalysis.metrics.authorship?.agentShare == null
                                    ? "—"
                                    : `${Math.round(workflowAnalysis.metrics.authorship.agentShare * 100)}%`,
                                ],
                              ].map(([label, value]) => (
                                <div key={label} className="bg-white px-3 py-2">
                                  <div className="text-sm font-semibold text-gray-900">
                                    {value}
                                  </div>
                                  <div className="text-[11px] text-gray-500">{label}</div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* A dash here means "the candidate never did this",
                              not "we failed to measure it" — three of the four
                              metrics are ratios over file writes, so a session
                              where the agent only read and ran commands is all
                              dashes and looks broken without this line. */}
                          {workflowAnalysis?.metrics &&
                          workflowAnalysis.metrics.readEditRatio == null &&
                          workflowAnalysis.metrics.verifiedWriteRatio == null &&
                          workflowAnalysis.metrics.authorship?.agentShare ==
                            null ? (
                            <p className="px-4 py-2 text-[11px] text-gray-500 border-b border-gray-100">
                              No file edits were captured in this session — the
                              agent only read files and ran commands, so the
                              edit-based ratios have nothing to measure.
                            </p>
                          ) : null}

                          {/* Prompting conversation stays here only when there
                              is no Recording tab (leftover workflow-only).
                              Under `both` it sits under the player instead. */}
                          {workflowAnalysis?.timeline?.length > 0 &&
                          !activityTimelineOnRecording ? (
                            <WorkflowActivityTimeline
                              timeline={workflowAnalysis.timeline}
                              onSeek={null}
                              className="border-0 border-b border-gray-100 rounded-none"
                            />
                          ) : null}

                          {/* Episodes: the narrative layer a reviewer actually
                              reads. Persisted on the session when capture ends;
                              the analysis response only carries them when this
                              page explicitly asks for them (an LLM call). */}
                          {episodesForReview.length > 0 ? (
                            <div className="divide-y divide-gray-100 max-h-[40vh] overflow-y-auto">
                              {episodesForReview.map((ep) => (
                                <div key={ep.index} className="px-4 py-3">
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-xs text-gray-400 tabular-nums">
                                      {ep.index}
                                    </span>
                                    <span className="text-sm font-medium text-gray-900">
                                      {ep.label}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wide text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">
                                      {ep.kind}
                                    </span>
                                    <span className="ml-auto text-xs text-gray-400 tabular-nums">
                                      {Math.floor(ep.startSeconds / 60)}:
                                      {String(Math.floor(ep.startSeconds % 60)).padStart(2, "0")}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-600 mt-1 pl-6">
                                    {ep.summary}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="px-4 py-4 space-y-2">
                              <p className="text-sm text-gray-500">
                                {workflowSession.status === "completed"
                                  ? "No episode summary has been built for this session yet."
                                  : "This capture session was never closed, so its episode summary was not built automatically."}
                              </p>
                              {(workflowSession.stats?.totalEvents ?? 0) > 0 ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleBuildEpisodes}
                                  disabled={episodesBuilding}
                                >
                                  {episodesBuilding ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                      Building…
                                    </>
                                  ) : (
                                    "Build episode summary"
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {!selectedEvaluationSubmission?.evaluationReport &&
                  selectedEvaluationSubmission?.evaluationStatus === "pending" ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-8">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Evaluation running…
                    </div>
                  ) : !selectedEvaluationSubmission?.evaluationReport && selectedEvaluationSubmission ? (
                    <div className="py-8 text-center">
                      <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p className="text-gray-500 mb-3">
                        No rubric scores for this candidate yet.
                      </p>
                      {selectedEvaluationSubmission.evaluationError && (
                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 max-w-md mx-auto">
                          {selectedEvaluationSubmission.evaluationError}
                        </p>
                      )}
                      {!selectedEvaluationSubmission.evaluationError && (
                        <p className="text-xs text-gray-400 mb-4">
                          Scoring starts automatically after submit. If it
                          has not appeared yet, it may still be running.
                        </p>
                      )}
                      <Button
                        onClick={() =>
                          handleRunEvaluation(selectedEvaluationSubmission)
                        }
                        disabled={
                          evaluatingSubmissionId ===
                          selectedEvaluationSubmission?._id
                        }
                      >
                        {evaluatingSubmissionId ===
                        selectedEvaluationSubmission?._id
                          ? "Running…"
                          : "Run scoring"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="execution" className="mt-4">
                <div className="max-h-[58vh] overflow-y-auto pr-1 space-y-4">
                  {/* Submitted code + sandbox behavioral checks */}
                  {selectedEvaluationSubmission?.githubLink ||
                  selectedEvaluationSubmission?.codeSource === "upload" ? (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                            <Code2 className="w-4 h-4 text-emerald-600" />
                            Final code
                          </h3>
                          <p className="text-xs text-gray-500 mt-1">
                            We clone the candidate&apos;s repository, run their code and tests, and score the output against the assessment.
                          </p>
                        </div>
                        {selectedEvaluationSubmission?.githubLink ? (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={selectedEvaluationSubmission.githubLink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              GitHub
                            </a>
                          </Button>
                        ) : null}
                        {selectedEvaluationSubmission?.codeSource === "upload" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleDownloadCodeArchive(selectedEvaluationSubmission)
                            }
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download archive
                          </Button>
                        ) : null}
                      </div>

                      {/* Behavioral grading summary (real pipeline data) */}
                      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
                              Behavioral grading
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              <Badge
                                className={
                                  selectedEvaluationSubmission?.behavioralGradingStatus ===
                                  "completed"
                                    ? "bg-green-100 text-green-700"
                                    : selectedEvaluationSubmission?.behavioralGradingStatus ===
                                      "failed"
                                    ? "bg-red-100 text-red-700"
                                    : selectedEvaluationSubmission?.behavioralGradingStatus ===
                                      "pending"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-gray-100 text-gray-600"
                                }
                              >
                                {selectedEvaluationSubmission?.behavioralGradingStatus
                                  ? `Status: ${selectedEvaluationSubmission.behavioralGradingStatus}`
                                  : "Not run yet"}
                              </Badge>
                              {selectedEvaluationSubmission?.behavioralGradingReport
                                ?.runbook && (
                                <Badge
                                  className={
                                    selectedEvaluationSubmission
                                      .behavioralGradingReport?.runbook
                                      ?.readmeRequirementPassed
                                      ? "bg-green-100 text-green-700"
                                      : "bg-red-100 text-red-700"
                                  }
                                  title={
                                    selectedEvaluationSubmission
                                      .behavioralGradingReport?.runbook
                                      ?.readmeRequirementDetail?.summary ||
                                    ""
                                  }
                                >
                                  README:{" "}
                                  {selectedEvaluationSubmission
                                    .behavioralGradingReport?.runbook
                                    ?.readmeRequirementPassed
                                    ? "pass"
                                    : "fail"}
                                </Badge>
                              )}
                            </div>
                            {selectedEvaluationSubmission?.behavioralGradingReport
                              ?.runbook?.readmeRequirementDetail?.summary &&
                              !selectedEvaluationSubmission
                                ?.behavioralGradingReport?.runbook
                                ?.readmeRequirementPassed && (
                                <p className="mt-1 text-[11px] text-gray-600 leading-snug max-w-xl">
                                  {
                                    selectedEvaluationSubmission
                                      .behavioralGradingReport.runbook
                                      .readmeRequirementDetail.summary
                                  }
                                </p>
                              )}
                            {selectedEvaluationSubmission?.behavioralGradingError && (
                              <p className="mt-2 text-xs text-red-600">
                                {selectedEvaluationSubmission.behavioralGradingError}
                              </p>
                            )}
                            <div className="mt-2">
                              <BehavioralSetupPanel
                                report={
                                  selectedEvaluationSubmission?.behavioralGradingReport
                                }
                              />
                            </div>
                            {selectedEvaluationSubmission
                              ?.behavioralGradingReport?.runbook?.summary ? (
                              <p className="mt-2 text-[11px] text-gray-500 leading-snug max-w-xl">
                                {
                                  selectedEvaluationSubmission
                                    .behavioralGradingReport.runbook.summary
                                }
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <CopyBehavioralReportButton
                              submission={selectedEvaluationSubmission}
                              assessment={assessment}
                              label="Copy report"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleRunBehavioralGrading(
                                  selectedEvaluationSubmission
                                )
                              }
                              disabled={
                                behavioralGradingSubmissionId ===
                                selectedEvaluationSubmission?._id
                              }
                            >
                              {behavioralGradingSubmissionId ===
                              selectedEvaluationSubmission?._id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                "Run"
                              )}
                            </Button>
                          </div>
                        </div>
                        {(() => {
                          const showBehavioralLiveTrace =
                            selectedEvaluationSubmission?.behavioralGradingStatus ===
                              "pending" ||
                            (behavioralGradingSubmissionId ===
                              selectedEvaluationSubmission?._id &&
                              !selectedEvaluationSubmission?.behavioralGradingReport
                                ?.cases?.length);
                          return showBehavioralLiveTrace ? (
                            <BehavioralGradingLiveTrace
                              progress={
                                selectedEvaluationSubmission.behavioralGradingProgress
                              }
                              behavioralChecks={assessment?.behavioralChecks ?? []}
                            />
                          ) : null;
                        })()}
                        {(selectedEvaluationSubmission?.behavioralGradingReport
                          ?.cases || []
                        ).length > 0 &&
                          selectedEvaluationSubmission?.behavioralGradingStatus !==
                            "pending" &&
                          behavioralGradingSubmissionId !==
                            selectedEvaluationSubmission?._id && (
                          <div className="space-y-2">
                            {(selectedEvaluationSubmission.behavioralGradingReport
                              ?.cases || []
                            ).map((c, idx) => (
                              <Collapsible
                                key={`${c.checkText}-${idx}`}
                                open={expandedBehavioralCases.has(String(idx))}
                                onOpenChange={(open) => {
                                  setExpandedBehavioralCases((prev) => {
                                    const next = new Set(prev);
                                    const key = String(idx);
                                    if (open) next.add(key);
                                    else next.delete(key);
                                    return next;
                                  });
                                  if (open && selectedEvaluationSubmission) {
                                    void loadBehavioralArtifacts(
                                      selectedEvaluationSubmission
                                    );
                                  }
                                }}
                              >
                                <div className="rounded border border-gray-100 bg-gray-50 overflow-hidden">
                                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-gray-100/80 transition-colors">
                                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                      <ChevronRight
                                        className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${
                                          expandedBehavioralCases.has(String(idx))
                                            ? "rotate-90"
                                            : ""
                                        }`}
                                      />
                                      <span className="truncate text-xs text-gray-700">
                                        {c.checkText}
                                      </span>
                                    </span>
                                    <Badge
                                      className={
                                        c.verdict === "pass"
                                          ? "bg-green-100 text-green-700"
                                          : c.verdict === "fail"
                                          ? "bg-red-100 text-red-700"
                                          : "bg-amber-100 text-amber-800"
                                      }
                                    >
                                      {c.verdict}
                                    </Badge>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent className="border-t border-gray-100 bg-white px-2 py-2 max-h-[50vh] overflow-y-auto space-y-2">
                                    <BehavioralCaseEvidenceBody
                                      caseResult={c}
                                      behavioralArtifactsLoading={
                                        behavioralArtifactsLoading
                                      }
                                      behavioralArtifactUrls={
                                        behavioralArtifactUrls
                                      }
                                    />
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Pipeline steps from real grading status */}
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em] mb-2">
                          Pipeline
                        </p>
                        <div className="flex flex-wrap gap-4 sm:gap-6">
                          {[
                            {
                              label: "Code submitted",
                              done: Boolean(
                                selectedEvaluationSubmission?.githubLink ||
                                  selectedEvaluationSubmission?.codeSource ===
                                    "upload"
                              ),
                            },
                            {
                              label: "Behavioral grading queued",
                              done: Boolean(
                                selectedEvaluationSubmission?.behavioralGradingStatus
                              ),
                            },
                            {
                              label: "Behavioral grading completed",
                              done:
                                selectedEvaluationSubmission?.behavioralGradingStatus ===
                                "completed",
                            },
                            {
                              label: "Evidence generated",
                              done:
                                (selectedEvaluationSubmission?.behavioralGradingReport
                                  ?.cases || []).length > 0,
                            },
                          ].map((step, i) => (
                            <div key={i} className="flex items-center gap-2">
                              {step.done ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              ) : (
                                <Circle className="w-4 h-4 text-gray-300 shrink-0" />
                              )}
                              <span className="text-sm text-gray-700">
                                {step.label}
                              </span>
                              {i < 3 && (
                                <ChevronRight className="w-3.5 h-3.5 text-gray-400 hidden sm:inline" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Execution log from real evidence */}
                      <div className="rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800/80">
                          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-xs font-medium text-gray-400">
                            Execution log
                          </span>
                        </div>
                        <pre className="p-3 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap">
                          {(() => {
                            const entries =
                              selectedEvaluationSubmission?.behavioralGradingReport
                                ?.runbook?.evidence || [];
                            if (!entries.length) {
                              return "No behavioral execution logs available yet.";
                            }

                            return entries
                              .map((entry) => {
                                const command = entry?.input?.command
                                  ? `$ ${entry.input.command}`
                                  : "";
                                const out = entry?.stdoutSnippet || "";
                                const err = entry?.stderrSnippet || "";
                                return [command, out, err]
                                  .filter(Boolean)
                                  .join("\n");
                              })
                              .filter(Boolean)
                              .join("\n\n");
                          })()}
                        </pre>
                      </div>
                      {selectedEvaluationSubmission?.githubLink ? (
                        <div className="mt-4 w-full">
                          <Button
                            variant="default"
                            size="default"
                            className="w-full gap-2 font-semibold shadow-sm"
                            onClick={() =>
                              handleOpenRunProjectModal(
                                selectedEvaluationSubmission.githubLink
                              )
                            }
                          >
                            <span className="inline-flex items-center gap-2">
                              <Play className="h-4 w-4 shrink-0" />
                              Run project
                            </span>
                          </Button>
                        </div>
                      ) : null}

                    </div>
                  ) : (
                    <div className="py-10 text-center">
                      <Code2 className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p className="text-gray-600 text-sm">
                        No code archive or repository found for this submission.
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Final code appears once a submission source is provided.
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="recording" className="mt-4">
                <div className="max-h-[58vh] overflow-y-auto pr-1 space-y-4">
                  {/* Screen recording — available once session completes / merged */}
                  {selectedEvaluationSubmission &&
                  (recordingVideoObjectUrl ||
                    (recordingSession &&
                      (selectedEvaluationSubmission.evaluationReport ||
                        recordingSession.status === "completed" ||
                        recordingSession.mergedVideo?.status === "ready" ||
                        recordingSession.mergedVideo?.status ===
                          "merging"))) ? (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Screen recording
                      </h3>
                      {recordingSession?.mergedVideo?.status === "merging" ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-900">
                          Preparing recording… This may take a minute. You can
                          refresh this tab or come back shortly.
                        </div>
                      ) : (
                        <>
                          {(() => {
                            const report =
                              selectedEvaluationSubmission.evaluationReport;
                            const criteriaResults = report?.criteria_results ?? [];
                            const highlights = [];
                            for (const r of criteriaResults) {
                              if (!Array.isArray(r.evidence)) continue;
                              for (const ev of r.evidence) {
                                const ts = Number(ev.ts);
                                const tsEnd = Number(ev.ts_end ?? ev.ts);
                                if (!Number.isFinite(ts)) continue;
                                highlights.push({
                                  startSec: ts,
                                  endSec:
                                    Number.isFinite(tsEnd) && tsEnd > ts
                                      ? tsEnd
                                      : undefined,
                                  label:
                                    ev.observation?.slice(0, 80) ?? "Evidence",
                                  category: r.criterion ?? "Evidence",
                                  description: ev.observation ?? null,
                                  score: r.score,
                                });
                              }
                            }
                            const durationHintSec =
                              recordingSession?.mergedVideo?.durationSeconds > 0
                                ? recordingSession.mergedVideo.durationSeconds
                                : recordingSession?.stats?.videoStats
                                      ?.durationSeconds > 0
                                  ? recordingSession.stats.videoStats
                                      .durationSeconds
                                  : recordingSession?.videoChunks?.length > 0
                                    ? (() => {
                                        let sum = 0;
                                        for (const c of recordingSession.videoChunks) {
                                          const start = c.startTime
                                            ? new Date(c.startTime).getTime()
                                            : NaN;
                                          const end = (
                                            c.endTime
                                              ? new Date(c.endTime)
                                              : c.startTime
                                                ? new Date(c.startTime)
                                                : null
                                          )?.getTime();
                                          if (
                                            Number.isFinite(start) &&
                                            Number.isFinite(end) &&
                                            end >= start
                                          )
                                            sum += (end - start) / 1000;
                                        }
                                        return sum > 0 ? sum : undefined;
                                      })()
                                    : undefined;
                            return (
                              <div className="mb-2 space-y-1">
                                {recordingVideoLoading &&
                                !recordingVideoObjectUrl ? (
                                  <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden w-full">
                                    <div className="relative aspect-video bg-gray-900 flex flex-col items-center justify-center gap-3">
                                      <Loader2
                                        className="w-10 h-10 text-white/80 animate-spin"
                                        aria-hidden
                                      />
                                      <p className="text-sm text-white/90 font-medium">
                                        Loading video…
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <VideoTimelineWithCriteria
                                    key={
                                      selectedEvaluationSubmission._id ??
                                      recordingSession?._id
                                    }
                                    highlights={highlights}
                                    videoUrl={recordingVideoObjectUrl ?? null}
                                    durationHintSec={durationHintSec}
                                    seekToSec={recordingSeekSec?.sec ?? null}
                                    seekNonce={recordingSeekSec?.at ?? null}
                                    onPlaybackError={handleRecordingPlaybackError}
                                    className="w-full"
                                  />
                                )}
                              </div>
                            );
                          })()}
                          <p className="text-xs text-gray-500 pt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                            {recordingVideoObjectUrl && recordingSession ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!currentUser) return;
                                  const token = await currentUser.getIdToken();
                                  downloadProctoringVideo(
                                    recordingSession._id,
                                    token
                                  );
                                }}
                                className="text-[#21201C] hover:underline"
                              >
                                Download recording
                              </button>
                            ) : null}
                          </p>
                        </>
                      )}
                    </div>
                  ) : recordingTranscriptLoading || recordingVideoLoading ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-10">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading recording…
                    </div>
                  ) : (
                    <div className="py-10 text-center">
                      <Camera className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p className="text-gray-600 text-sm">
                        No screen recording for this candidate.
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Recording appears here when the candidate consented
                        to share their screen.
                      </p>
                    </div>
                  )}

                  {/* Under `both` this is the prompting conversation +
                      screen beats — click a line to seek. Not on Summary. */}
                  {activityTimelineOnRecording &&
                  workflowAnalysis?.timeline?.length > 0 ? (
                    <WorkflowActivityTimeline
                      timeline={workflowAnalysis.timeline}
                      onSeek={handleSeekRecording}
                    />
                  ) : activityTimelineOnRecording && workflowLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading captured activity…
                    </div>
                  ) : null}

                  {/* Leftover `screen` assessments still have a video OCR
                      transcript. Current modes never generate one. */}
                  {evidenceModeForReview === "screen" &&
                    selectedEvaluationSubmission && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#21201C]" />
                        Screen transcript
                      </h3>
                      {selectedEvaluationSubmission.enrichedTranscript ? (
                        <EnrichedTranscriptView enriched={selectedEvaluationSubmission.enrichedTranscript} />
                      ) : recordingTranscriptLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading…
                        </div>
                      ) : recordingTranscriptError ? (
                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          {recordingTranscriptError}
                        </p>
                      ) : !recordingSession ? (
                        <p className="text-sm text-gray-500">
                          No proctoring session for this submission.
                        </p>
                      ) : recordingSession.transcript?.status !== "completed" ? (
                        <p className="text-sm text-gray-500">
                          Screen transcript not available yet.
                        </p>
                      ) : Array.isArray(recordingTranscript) && recordingTranscript.length > 0 ? (
                        <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 max-h-[40vh] overflow-y-auto space-y-2">
                          <p className="text-xs text-gray-500 mb-2">Raw transcript (human-readable summary not yet generated)</p>
                          {recordingTranscript.map((seg, idx) => (
                            <div
                              key={idx}
                              className="text-xs border-b border-gray-200 pb-2 last:border-0 last:pb-0"
                            >
                              <span className="text-gray-500 font-medium">
                                {seg.ts && new Date(seg.ts).toLocaleTimeString()}
                                {seg.app ? ` · ${seg.app}` : ""}
                                {seg.region ? ` · ${seg.region}` : ""}
                              </span>
                              <p className="mt-0.5 text-gray-700 break-words">
                                {(seg.text_content || seg.description || "").slice(0, 300)}
                                {(seg.text_content || seg.description || "").length > 300 ? "…" : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          No transcript segments.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="agent" className="mt-4">
                <div className="max-h-[58vh] overflow-y-auto pr-1 space-y-6">
                  {(() => {
                    const hasCompanion =
                      Array.isArray(companionMessages) &&
                      companionMessages.length > 0;
                    const optedOut = Boolean(
                      selectedEvaluationSubmission?.optedOut
                    );

                    if (companionLoading) {
                      return (
                        <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading conversations…
                        </div>
                      );
                    }

                    if (!hasCompanion && !optedOut) {
                      return (
                        <div className="py-10 text-center">
                          <MessageSquare className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                          <p className="text-gray-600 text-sm">
                            No conversations for this submission.
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            Nothing was recorded from the in-session voice
                            companion.
                          </p>
                        </div>
                      );
                    }

                    const bubble = (role, text, key) => {
                      const isAgent =
                        role === "agent" ||
                        role === "assistant" ||
                        role === "companion";
                      return (
                        <div
                          key={key}
                          className={`flex gap-3 ${isAgent ? "justify-start" : "justify-end"}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-lg p-3 ${
                              isAgent
                                ? "bg-white border border-gray-200"
                                : "bg-[#21201C] text-white"
                            }`}
                          >
                            <p className="text-xs font-medium mb-1 opacity-70">
                              {isAgent ? "Agent" : "Candidate"}
                            </p>
                            <p
                              className={
                                isAgent
                                  ? "text-sm text-gray-700 whitespace-pre-wrap"
                                  : "text-sm text-white whitespace-pre-wrap"
                              }
                            >
                              {text}
                            </p>
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div className="space-y-6">
                        {optedOut && (
                          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                            <p className="text-sm font-medium text-orange-900">
                              Candidate opted out
                              {selectedEvaluationSubmission.startedAt
                                ? " after starting the assessment"
                                : " before starting the assessment"}
                            </p>
                            {selectedEvaluationSubmission.optOutReason && (
                              <p className="text-sm text-orange-800 mt-1">
                                {selectedEvaluationSubmission.optOutReason}
                              </p>
                            )}
                            {selectedEvaluationSubmission.optedOutAt && (
                              <p className="text-xs text-orange-700 mt-1">
                                {formatDate(
                                  selectedEvaluationSubmission.optedOutAt
                                )}
                              </p>
                            )}
                          </div>
                        )}

                        {hasCompanion && (
                          <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                              <MessageSquare className="w-4 h-4 text-[#21201C]" />
                              In-session voice companion
                            </h3>
                            <p className="text-xs text-gray-500">
                              What the candidate said out loud while working.
                            </p>
                            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-3">
                              {companionMessages.map((msg, index) =>
                                bubble(msg.role, msg.text, `c-${index}`)
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </TabsContent>
            </Tabs>

          </DialogContent>
        </Dialog>

        {/* Run project popup */}
        <Dialog
          open={showRunProjectModal}
          onOpenChange={(open) => {
            setShowRunProjectModal(open);
            if (!open) {
              setRunProjectPreviewUrl("");
            }
          }}
        >
          <DialogContent className="max-w-[95vw] h-[88vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Play className="w-4 h-4" />
                Run project preview
              </DialogTitle>
              <DialogDescription>
                Live environment for the submitted repository. It may take a few
                seconds to install dependencies and boot.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-2 flex-1 min-h-0 rounded-md border border-gray-200 overflow-hidden bg-white">
              {runProjectPreviewUrl ? (
                <iframe
                  title="Project runtime preview"
                  src={runProjectPreviewUrl}
                  className="w-full h-full"
                  allow="clipboard-write; fullscreen"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-gray-500">
                  Unable to build preview URL for this repository.
                </div>
              )}
            </div>

            {selectedEvaluationSubmission?.githubLink && (
              <DialogFooter>
                <Button variant="outline" asChild>
                  <a
                    href={selectedEvaluationSubmission.githubLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open repository in GitHub
                  </a>
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
