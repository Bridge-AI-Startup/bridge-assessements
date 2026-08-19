import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle,
  Loader2,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPageUrl } from "@/utils";
import { API_BASE_URL } from "@/config/api";
import {
  createRuntimeSession,
  finalizeRuntime,
  getRuntimeLogs,
  getRuntimeStatus,
  pauseRuntime,
  restartRuntime,
  runRuntime,
  saveRuntimeConfig,
} from "@/api/runtimeSetup";

const EMPTY_CONFIG = {
  rootDir: ".",
  installCommand: "",
  buildCommand: "",
  startCommand: "",
  port: "",
  healthPath: "",
  executionProfile: "web_server",
  envVars: [],
  declaredEgressDomains: "",
};

function toForm(config) {
  if (!config) return { ...EMPTY_CONFIG };
  return {
    rootDir: config.rootDir || ".",
    installCommand: config.installCommand || "",
    buildCommand: config.buildCommand || "",
    startCommand: config.startCommand || "",
    port: config.port == null ? "" : String(config.port),
    healthPath: config.healthPath || "",
    executionProfile: config.executionProfile || "web_server",
    envVars: (config.envVars || []).map((row) => ({
      key: row.key || "",
      value: row.value || "",
      secret: Boolean(row.secret),
      // Secret values come back blank, so this is the only way to tell a stored
      // secret apart from one that was never filled in.
      hasValue: Boolean(row.hasValue),
    })),
    declaredEgressDomains: (config.declaredEgressDomains || []).join(", "),
  };
}

function fromForm(form) {
  const portRaw = String(form.port || "").trim();
  const port = portRaw ? Number(portRaw) : null;
  return {
    rootDir: form.rootDir || ".",
    installCommand: form.installCommand || "",
    buildCommand: form.buildCommand ? form.buildCommand : null,
    startCommand: form.startCommand || "",
    port: Number.isFinite(port) && port > 0 ? port : null,
    healthPath: form.healthPath || null,
    executionProfile: form.executionProfile || "unclear",
    envVars: (form.envVars || [])
      .filter((row) => row.key.trim())
      .map((row) => ({
        key: row.key.trim(),
        value: row.value || "",
        secret: Boolean(row.secret),
      })),
    declaredEgressDomains: String(form.declaredEgressDomains || "")
      .split(/[\s,]+/)
      .map((d) => d.trim())
      .filter(Boolean),
  };
}

function isLiveSetupSandbox(session) {
  return Boolean(
    session?.hasSandbox &&
      (session.status === "running" || session.status === "paused")
  );
}

const BUSY_RUN_PHASES = ["installing", "building", "starting", "waiting_health"];

function isBusyRunPhase(phase) {
  return BUSY_RUN_PHASES.includes(phase || "");
}

function phaseLabel(phase, sessionStatus) {
  if (sessionStatus === "paused") return "Paused";
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

/** What the empty preview pane says, tracking the state it is actually in. */
function previewPlaceholder({ booting, running, session, hasStartCommand }) {
  if (booting || session?.status === "provisioning") {
    return "Starting an isolated environment…";
  }
  if (running && !isBusyRunPhase(session?.runPhase)) {
    return "Installing dependencies…";
  }
  switch (session?.runPhase) {
    case "installing":
      return "Installing dependencies…";
    case "building":
      return "Building your project…";
    case "starting":
      return "Starting your app…";
    case "waiting_health":
      return session?.health?.summary || "Waiting for your app to respond…";
    default:
      break;
  }
  if (session?.runPhase === "failed" || session?.status === "dead") {
    return (
      session?.error ||
      "The last run failed. Check the logs, fix the config, and run again."
    );
  }
  if (!hasStartCommand) {
    return "Add a start command, then run your project here.";
  }
  if (isLiveSetupSandbox(session)) {
    return "Environment is ready. Run project to install and start your app.";
  }
  return "Run project to boot your code in an isolated sandbox.";
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="eyebrow text-[11px] text-muted-foreground">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "mt-1.5 w-full h-10 rounded-xl border border-input bg-white px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";

export default function RuntimeSetup() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [form, setForm] = useState(EMPTY_CONFIG);
  const [setup, setSetup] = useState(null);
  const [session, setSession] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState("saved");

  const logEndRef = useRef(null);
  const logSeqRef = useRef(0);
  const saveTimer = useRef(null);
  const pausedOnLeave = useRef(false);
  const skipPauseRef = useRef(false);

  const finalized = setup?.status === "finalized";
  const runPhaseBusy = isBusyRunPhase(session?.runPhase);
  const hasStartCommand = Boolean(String(form.startCommand || "").trim());
  // One CTA: booting the sandbox is an implementation detail, so Run project
  // provisions first when there is nothing live yet.
  const canRun =
    !booting && !running && !runPhaseBusy && hasStartCommand && !finalizing;
  const busy =
    booting ||
    running ||
    runPhaseBusy ||
    session?.status === "provisioning";
  skipPauseRef.current =
    finalized ||
    session?.status === "dead" ||
    session?.status === "provisioning" ||
    !session?.hasSandbox ||
    runPhaseBusy;

  // Polling continues at a slow cadence once the app is up: the poll is what
  // tells the server this box is being watched, and stopping it lets the idle
  // reaper pause a sandbox whose preview is on screen.
  const watchingPreview =
    session?.status === "running" && Boolean(session?.previewUrl);

  useEffect(() => {
    if (!token || finalized) return undefined;
    if (!busy && !watchingPreview) return undefined;
    let cancelled = false;
    const tick = async () => {
      const result = await getRuntimeStatus(token);
      if (cancelled || !result.success) return;
      setSession(result.data.session);
      if (result.data.setup) setSetup(result.data.setup);
      const phase = result.data.session?.runPhase;
      const status = result.data.session?.status;
      if (
        phase === "ready" ||
        phase === "failed" ||
        phase === "idle" ||
        status === "dead"
      ) {
        setRunning(false);
      }
    };
    const id = setInterval(tick, busy ? 2500 : 10000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, busy, finalized, watchingPreview]);

  const patch = useCallback((partial) => {
    setForm((prev) => ({ ...prev, ...partial }));
    setSaveState("dirty");
  }, []);

  const applyStatus = useCallback((data) => {
    if (data.config) setForm(toForm(data.config));
    if (data.setup) setSetup(data.setup);
    if (data.session !== undefined) setSession(data.session);
  }, []);

  useEffect(() => {
    if (!token) {
      navigate("/");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await getRuntimeStatus(token);
      if (cancelled) return;
      if (!result.success) {
        setError(result.error || "Runtime setup is not available.");
        setLoading(false);
        return;
      }
      applyStatus(result.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, navigate, applyStatus]);

  useEffect(() => {
    if (!token || saveState !== "dirty" || finalized) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const result = await saveRuntimeConfig(token, fromForm(form));
      setSaving(false);
      if (result.success) {
        setSaveState("saved");
        if (result.data.config) setForm(toForm(result.data.config));
      } else {
        setSaveState("error");
        setError(result.error);
      }
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [form, saveState, token, finalized]);

  useEffect(() => {
    if (!token) return undefined;
    const poll = async () => {
      const result = await getRuntimeLogs(token, logSeqRef.current);
      if (result.success && result.data.lines?.length) {
        logSeqRef.current = result.data.nextSeq;
        setLogs((prev) => [...prev, ...result.data.lines].slice(-400));
      }
    };
    const id = setInterval(poll, busy ? 1500 : 4000);
    poll();
    return () => clearInterval(id);
  }, [token, busy]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (!token) return undefined;
    const onLeave = () => {
      if (pausedOnLeave.current || skipPauseRef.current) return;
      pausedOnLeave.current = true;
      navigator.sendBeacon?.(
        `${API_BASE_URL}/submissions/token/${token}/runtime/pause`
      );
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      if (!pausedOnLeave.current && !skipPauseRef.current) {
        pauseRuntime(token);
      }
    };
  }, [token]);

  const onRestartEnvironment = async () => {
    setError(null);
    setBooting(true);
    setRunning(false);
    logSeqRef.current = 0;
    setLogs([]);
    const result = await restartRuntime(token);
    setBooting(false);
    if (!result.success) {
      setError(result.error);
      const status = await getRuntimeStatus(token);
      if (status.success) applyStatus(status.data);
      return;
    }
    applyStatus(result.data);
  };

  const onRun = async () => {
    setError(null);
    if (saveState === "dirty") {
      const saved = await saveRuntimeConfig(token, fromForm(form));
      if (!saved.success) {
        setError(saved.error);
        return;
      }
      setSaveState("saved");
    }

    if (!isLiveSetupSandbox(session)) {
      setBooting(true);
      logSeqRef.current = 0;
      setLogs([]);
      const booted = await createRuntimeSession(token);
      setBooting(false);
      if (!booted.success) {
        setError(booted.error);
        const status = await getRuntimeStatus(token);
        if (status.success) applyStatus(status.data);
        return;
      }
      applyStatus(booted.data);
    }

    setRunning(true);
    const result = await runRuntime(token);
    if (!result.success) {
      setRunning(false);
      setError(result.error);
      return;
    }
    applyStatus(result.data);
  };

  const onFinalize = async () => {
    const lastRunFailed = setup?.lastRunResult?.ok === false;
    const verified = Boolean(setup?.verified || setup?.lastRunResult?.ok);
    const message = verified
      ? "Finalize this setup? Recruiters will replay this config against your submitted code. You will not be able to change it."
      : [
          lastRunFailed
            ? "Your last run did not succeed."
            : "You haven't had a successful run yet.",
          "If you finalize now, recruiters will see this setup as unverified and may not be able to start your project.",
          "Finalize anyway?",
        ].join("\n\n");
    if (!window.confirm(message)) {
      return;
    }
    setFinalizing(true);
    setError(null);
    const result = await finalizeRuntime(token, { confirmUnverified: !verified });
    setFinalizing(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSetup(result.data.setup);
    if (result.data.config) setForm(toForm(result.data.config));
    setSession(null);
  };

  const healthOk = Boolean(session?.health?.ok);
  const previewUrl = session?.previewUrl;
  const statusText = useMemo(() => {
    if (finalized) return setup?.verified ? "Finalized · verified" : "Finalized";
    if (session?.status === "dead" || session?.runPhase === "failed") {
      return session?.error || session?.health?.summary || "Failed";
    }
    if (
      session?.runPhase === "waiting_health" &&
      session?.health?.summary
    ) {
      return session.health.summary;
    }
    return phaseLabel(session?.runPhase, session?.status);
  }, [finalized, setup, session]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF9F2] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#21201C]/50" />
      </div>
    );
  }

  if (finalized) {
    return (
      <div className="min-h-screen bg-[#FAF9F2] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-lg bg-white rounded-card border border-border shadow-[0_2px_18px_rgba(33,32,28,0.06)] p-8 text-center"
        >
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-medium tracking-[-0.012em] text-[#21201C]">
            Runtime setup finalized
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Recruiters can replay this exact install / start config against your
            submitted snapshot. You can close this tab.
          </p>
          <Button
            className="mt-6"
            onClick={() =>
              navigate(`${createPageUrl("CandidateSubmitted")}?token=${token}`)
            }
          >
            Back to submission
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F2] text-[#21201C]">
      <header className="border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="eyebrow text-[11px] text-muted-foreground">
              After submit
            </p>
            <h1 className="text-xl font-medium tracking-[-0.012em]">
              Runtime setup
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border border-border px-3 py-1 text-xs font-mono uppercase tracking-[0.03em] max-w-[28rem] truncate"
              title={statusText}
            >
              {statusText}
            </span>
            <span className="text-xs text-muted-foreground">
              {saving
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved"
                  : saveState === "error"
                    ? "Save failed"
                    : "Unsaved"}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={booting || running || runPhaseBusy || finalizing}
              title="Throw away this environment and provision a clean one from your submitted code"
              onClick={onRestartEnvironment}
            >
              {booting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Restart environment"
              )}
            </Button>
            <Button
              size="sm"
              disabled={!canRun}
              onClick={onRun}
              title={
                hasStartCommand ? undefined : "Add a start command first"
              }
            >
              {booting || running ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Run project
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || finalizing}
              onClick={onFinalize}
            >
              Finalize setup
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <section className="bg-white rounded-card border border-border p-5 space-y-4 h-fit">
          <p className="text-sm text-muted-foreground">
            Tell us how this project runs. We save as you type. Close the tab
            anytime — come back until you finalize.
          </p>
          <Field label="Root directory" hint="Monorepo subfolder, or .">
            <input
              className={inputClass}
              value={form.rootDir}
              onChange={(e) => patch({ rootDir: e.target.value })}
            />
          </Field>
          <Field label="Install command">
            <input
              className={inputClass}
              placeholder="npm ci"
              value={form.installCommand}
              onChange={(e) => patch({ installCommand: e.target.value })}
            />
          </Field>
          <Field label="Build command" hint="Optional">
            <input
              className={inputClass}
              placeholder="npm run build"
              value={form.buildCommand}
              onChange={(e) => patch({ buildCommand: e.target.value })}
            />
          </Field>
          <Field label="Start command">
            <input
              className={inputClass}
              placeholder="npm start"
              value={form.startCommand}
              onChange={(e) => patch({ startCommand: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port" hint="Blank = detect">
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="3000"
                value={form.port}
                onChange={(e) => patch({ port: e.target.value })}
              />
            </Field>
            <Field label="Health path">
              <input
                className={inputClass}
                placeholder="/health"
                value={form.healthPath}
                onChange={(e) => patch({ healthPath: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Execution profile">
            <select
              className={inputClass}
              value={form.executionProfile}
              onChange={(e) => patch({ executionProfile: e.target.value })}
            >
              <option value="web_server">Web server</option>
              <option value="cli_stdout">Script / CLI</option>
              <option value="unclear">Unclear</option>
            </select>
          </Field>
          <div>
            <div className="flex items-center justify-between">
              <span className="eyebrow text-[11px] text-muted-foreground">
                Environment variables
              </span>
              <button
                type="button"
                className="text-xs font-medium inline-flex items-center gap-1"
                onClick={() =>
                  patch({
                    envVars: [
                      ...form.envVars,
                      { key: "", value: "", secret: false },
                    ],
                  })
                }
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {form.envVars.map((row, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    className={inputClass + " mt-0"}
                    placeholder="KEY"
                    value={row.key}
                    onChange={(e) => {
                      const next = [...form.envVars];
                      next[idx] = { ...row, key: e.target.value };
                      patch({ envVars: next });
                    }}
                  />
                  <div className="relative flex-1 min-w-0">
                    <input
                      className={inputClass + " mt-0"}
                      placeholder={
                        row.secret && row.hasValue
                          ? "Leave blank to keep saved value"
                          : row.secret
                            ? "••••"
                            : "value"
                      }
                      type={row.secret ? "password" : "text"}
                      value={row.value}
                      onChange={(e) => {
                        const next = [...form.envVars];
                        next[idx] = { ...row, value: e.target.value };
                        patch({ envVars: next });
                      }}
                    />
                    {row.secret && row.hasValue && !row.value ? (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.03em] text-green-700">
                        Saved
                      </span>
                    ) : null}
                  </div>
                  <label className="text-[10px] font-mono uppercase tracking-[0.03em] whitespace-nowrap">
                    <input
                      type="checkbox"
                      className="mr-1"
                      checked={row.secret}
                      onChange={(e) => {
                        const next = [...form.envVars];
                        next[idx] = { ...row, secret: e.target.checked };
                        patch({ envVars: next });
                      }}
                    />
                    Secret
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      patch({
                        envVars: form.envVars.filter((_, i) => i !== idx),
                      })
                    }
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <Field
            label="Outbound domains"
            hint="Optional. Allowed at runtime after install (e.g. api.stripe.com)."
          >
            <input
              className={inputClass}
              placeholder="api.example.com, *.cdn.example.com"
              value={form.declaredEgressDomains}
              onChange={(e) =>
                patch({ declaredEgressDomains: e.target.value })
              }
            />
          </Field>
        </section>

        <section className="space-y-4 min-w-0">
          <div className="bg-white rounded-card border border-border overflow-hidden min-h-[280px] flex flex-col">
            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
              <span className="eyebrow text-[11px]">Preview</span>
              <span
                className={`text-xs font-mono uppercase tracking-[0.03em] ${
                  healthOk ? "text-green-700" : "text-muted-foreground"
                }`}
              >
                {healthOk ? "Healthy" : session?.health?.summary || "Not running"}
              </span>
            </div>
            {previewUrl && session?.status === "running" ? (
              <iframe
                title="Runtime preview"
                src={previewUrl}
                className="w-full flex-1 min-h-[320px] bg-white"
                sandbox="allow-scripts allow-forms allow-same-origin"
              />
            ) : (
              <div className="flex-1 min-h-[280px] flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
                {previewPlaceholder({
                  booting,
                  running,
                  session,
                  hasStartCommand,
                })}
              </div>
            )}
          </div>

          <div className="bg-[#21201C] rounded-card overflow-hidden min-h-[200px] max-h-[320px] flex flex-col">
            <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between">
              <span className="eyebrow text-[11px] text-white/70">Logs</span>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-[12px] leading-5 font-mono text-[#F4F2E9] whitespace-pre-wrap">
              {logs.length === 0
                ? "Logs will appear here when you run."
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
        </section>
      </div>
    </div>
  );
}
