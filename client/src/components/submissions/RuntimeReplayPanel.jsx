import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Maximize2,
  Play,
  Square,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getRuntimeReplayLogs,
  getRuntimeReplayStatus,
  startRuntimeReplay,
  stopRuntimeReplay,
} from "@/api/runtimeSetup";

const BUSY_PHASES = [
  "installing",
  "building",
  "starting",
  "waiting_health",
  "provisioning",
];

function phaseLabel(phase, sessionStatus) {
  if (sessionStatus === "provisioning") return "Starting environment";
  switch (phase) {
    case "installing":
      return "Installing";
    case "building":
      return "Building";
    case "starting":
      return "Starting";
    case "waiting_health":
      return "Waiting for health";
    case "ready":
      return "Running";
    case "failed":
      return "Failed";
    default:
      return sessionStatus === "running" ? "Ready" : "Idle";
  }
}

function isBusy(session, starting) {
  if (starting) return true;
  if (!session) return false;
  if (session.status === "provisioning") return true;
  return BUSY_PHASES.includes(session.runPhase);
}

function envValue(row) {
  if (row?.secret) return "••••";
  return row?.value || "";
}

function ConfigRow({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
        {label}
      </p>
      <p className="mt-0.5 text-xs text-gray-800 font-mono break-all">{value}</p>
    </div>
  );
}

export function shouldShowRuntimeReplay(submission) {
  if (!submission) return false;
  if (submission.runtimeSetupEnabled === false) return false;
  if (submission.runtimeSetupEnabled === true) return true;
  return Boolean(submission.runtimeSetup || submission.runtimeConfig);
}

export default function RuntimeReplayPanel({ submission }) {
  const submissionId = submission?._id;
  const finalized = submission?.runtimeSetup?.status === "finalized";
  const setup = submission?.runtimeSetup;
  const initialConfig = submission?.runtimeConfig;

  const [config, setConfig] = useState(initialConfig || null);
  const [session, setSession] = useState(null);
  const [logs, setLogs] = useState([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [disabled, setDisabled] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const logEndRef = useRef(null);
  const logSeqRef = useRef(0);

  const busy = isBusy(session, starting);
  const previewUrl = session?.previewUrl;
  const healthOk = Boolean(session?.health?.ok);
  const previewLive = Boolean(previewUrl && session?.status === "running");

  useEffect(() => {
    setConfig(initialConfig || null);
    setSession(null);
    setLogs([]);
    setError(null);
    setStarting(false);
    setDisabled(false);
    setExpanded(false);
    logSeqRef.current = 0;
  }, [submissionId]);

  useEffect(() => {
    if (!previewLive) setExpanded(false);
  }, [previewLive]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded]);

  useEffect(() => {
    if (!submissionId || !finalized || disabled) return undefined;
    let cancelled = false;
    (async () => {
      const result = await getRuntimeReplayStatus(submissionId);
      if (cancelled) return;
      if (!result.success) {
        if (/not enabled/i.test(result.error || "")) {
          setDisabled(true);
          return;
        }
        return;
      }
      if (result.data.config) setConfig(result.data.config);
      if (result.data.session !== undefined) setSession(result.data.session);
    })();
    return () => {
      cancelled = true;
    };
  }, [submissionId, finalized, disabled]);

  useEffect(() => {
    if (!submissionId || !finalized || disabled || !busy) return undefined;
    let cancelled = false;
    const tick = async () => {
      const result = await getRuntimeReplayStatus(submissionId);
      if (cancelled || !result.success) return;
      if (result.data.config) setConfig(result.data.config);
      if (result.data.session !== undefined) setSession(result.data.session);
      const phase = result.data.session?.runPhase;
      const status = result.data.session?.status;
      if (
        phase === "ready" ||
        phase === "failed" ||
        phase === "idle" ||
        status === "dead"
      ) {
        setStarting(false);
      }
    };
    const id = setInterval(tick, 2500);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [submissionId, finalized, disabled, busy]);

  useEffect(() => {
    if (!submissionId || !finalized || disabled) return undefined;
    let cancelled = false;
    const poll = async () => {
      const result = await getRuntimeReplayLogs(submissionId, logSeqRef.current);
      if (cancelled || !result.success || !result.data.lines?.length) return;
      logSeqRef.current = result.data.nextSeq;
      setLogs((prev) => [...prev, ...result.data.lines].slice(-400));
    };
    const id = setInterval(poll, busy ? 1500 : 4000);
    poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [submissionId, finalized, disabled, busy]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const onRun = async () => {
    if (!submissionId) return;
    setError(null);
    setStarting(true);
    logSeqRef.current = 0;
    setLogs([]);
    const result = await startRuntimeReplay(submissionId);
    if (!result.success) {
      setStarting(false);
      setError(result.error);
      return;
    }
    if (result.data.config) setConfig(result.data.config);
    if (result.data.session !== undefined) setSession(result.data.session);
  };

  const onStop = async () => {
    if (!submissionId) return;
    setStarting(false);
    await stopRuntimeReplay(submissionId);
    setSession((prev) =>
      prev
        ? { ...prev, status: "dead", runPhase: "failed", previewUrl: null, hasSandbox: false }
        : prev
    );
  };

  if (disabled) return null;

  if (!finalized) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
          Run project
        </p>
        <p className="mt-1 text-sm text-gray-600">
          This candidate hasn&apos;t finished runtime setup.
        </p>
      </div>
    );
  }

  const envVars = config?.envVars || [];
  const domains = config?.declaredEgressDomains || [];
  const lastRun = setup?.lastRunResult;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
            Run project
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-[0.03em] text-gray-600 max-w-[24rem] truncate" title={session?.health?.summary || undefined}>
              {session?.runPhase === "waiting_health" && session?.health?.summary
                ? session.health.summary
                : session?.status === "dead" || session?.runPhase === "failed"
                  ? session?.error || session?.health?.summary || "Failed"
                  : phaseLabel(session?.runPhase, session?.status)}
            </span>
            {setup?.verified ? (
              <Badge className="bg-green-100 text-green-700">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Verified
              </Badge>
            ) : (
              <Badge className="bg-gray-100 text-gray-600">Finalized</Badge>
            )}
            {lastRun?.ok === false && lastRun?.error ? (
              <span className="text-[11px] text-red-600 truncate max-w-[16rem]">
                Last candidate run: {lastRun.error}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {session?.hasSandbox || busy || previewUrl ? (
            <Button variant="outline" size="sm" onClick={onStop} disabled={!session}>
              <Square className="w-3.5 h-3.5 mr-1.5" />
              Stop
            </Button>
          ) : null}
          <Button size="sm" onClick={onRun} disabled={busy}>
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Run project
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-gray-100 bg-gray-50 p-3">
        <ConfigRow label="Install" value={config?.installCommand} />
        <ConfigRow label="Build" value={config?.buildCommand} />
        <ConfigRow label="Start" value={config?.startCommand} />
        <ConfigRow
          label="Port / health"
          value={
            [config?.port, config?.healthPath].filter(Boolean).join(" · ") || null
          }
        />
        <ConfigRow label="Runtime" value={config?.runtime} />
        <ConfigRow label="Root" value={config?.rootDir} />
        {envVars.length > 0 ? (
          <div className="sm:col-span-2">
            <p className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
              Environment
            </p>
            <ul className="mt-1 space-y-0.5">
              {envVars.map((row) => (
                <li key={row.key} className="text-xs font-mono text-gray-800">
                  {row.key}={envValue(row)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {domains.length > 0 ? (
          <ConfigRow label="Outbound domains" value={domains.join(", ")} />
        ) : null}
      </div>

      <div
        className={
          expanded
            ? "fixed inset-0 z-[100] flex flex-col bg-[#FAF9F2]"
            : "rounded-md border border-gray-200 overflow-hidden min-h-[220px] flex flex-col bg-white"
        }
      >
        <div className="px-3 py-1.5 border-b border-gray-100 flex items-center justify-between gap-2 bg-white shrink-0">
          <span className="text-[10px] font-medium text-gray-500 uppercase font-mono tracking-[0.03em]">
            Preview
          </span>
          <div className="flex items-center gap-1">
            <span
              className={`text-[10px] font-mono uppercase tracking-[0.03em] ${
                healthOk ? "text-green-700" : "text-gray-500"
              }`}
            >
              {healthOk ? "Healthy" : session?.health?.summary || "Not running"}
            </span>
            {expanded ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setExpanded(false)}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Exit expand
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={!previewLive}
                  title="Expand preview"
                  aria-label="Expand preview"
                  onClick={() => setExpanded(true)}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={!previewLive}
                  title="Open in new window"
                  aria-label="Open in new window"
                  onClick={() => {
                    if (!previewUrl) return;
                    window.open(previewUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
        {previewLive ? (
          <iframe
            title="Candidate project preview"
            src={previewUrl}
            className={`w-full flex-1 bg-white ${expanded ? "min-h-0" : "min-h-[280px]"}`}
            sandbox="allow-scripts allow-forms allow-same-origin"
          />
        ) : (
          <div className="flex-1 min-h-[180px] flex items-center justify-center text-sm text-gray-500 p-6 text-center">
            {busy
              ? "Installing and starting the submitted project…"
              : "Run project to boot this snapshot in a fresh sandbox."}
          </div>
        )}
      </div>

      <div className="bg-[#21201C] rounded-md overflow-hidden min-h-[140px] max-h-[240px] flex flex-col">
        <div className="px-3 py-1.5 border-b border-white/10">
          <span className="text-[10px] font-medium text-white/70 uppercase font-mono tracking-[0.03em]">
            Logs
          </span>
        </div>
        <pre className="flex-1 overflow-auto p-3 text-[12px] leading-5 font-mono text-[#F4F2E9] whitespace-pre-wrap">
          {logs.length === 0
            ? "Logs appear here when the project runs."
            : logs.map((line) => (
                <span
                  key={line.seq}
                  className={
                    line.stream === "stderr"
                      ? "text-red-300"
                      : line.stream === "system"
                        ? "text-amber-200"
                        : ""
                  }
                >
                  {line.text}
                  {"\n"}
                </span>
              ))}
          <span ref={logEndRef} />
        </pre>
      </div>
    </div>
  );
}
