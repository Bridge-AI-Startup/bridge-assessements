import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Copy, Check, Upload, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { interpretRawTranscript } from "@/api/proctoring";

const PLACEHOLDER = `Paste raw transcript JSONL here (one JSON object per line).
Example line:
{"ts":"2026-03-03T10:00:00.000Z","ts_end":"2026-03-03T10:00:05.000Z","screen":0,"region":"browser","app":"WebApp","text_content":"Task 1: Two Sum\\nTechnical Assessment..."}`;

function EnrichedEventCard({ event }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-sm space-y-1.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="font-mono text-xs">
          {event.ts}s – {event.ts_end}s
        </span>
        {event.regions_present?.length > 0 && (
          <span className="text-xs">
            [{event.regions_present.join(", ")}]
          </span>
        )}
        {event.ai_tool && (
          <span className="text-xs bg-amber-100 text-amber-800 px-1.5 rounded">
            {event.ai_tool}
          </span>
        )}
      </div>
      <p className="font-medium text-foreground">{event.behavioral_summary}</p>
      {event.intent && (
        <p className="text-muted-foreground italic">Intent: {event.intent}</p>
      )}
    </div>
  );
}

/** Build a plain-text readable summary for sharing (email, Slack, etc.). */
function toReadableSummary(result, strategyLabel) {
  const lines = [];
  lines.push(`Transcript summary (${strategyLabel})`);
  lines.push("—".repeat(40));
  if (result.session_narrative) {
    lines.push("");
    lines.push("Session narrative");
    lines.push(result.session_narrative);
    lines.push("");
  }
  const events = result.events ?? [];
  if (events.length > 0) {
    lines.push("Events");
    lines.push("—".repeat(20));
    events.forEach((ev, i) => {
      const hasTime =
        ev.ts != null && ev.ts_end != null && !Number.isNaN(ev.ts) && !Number.isNaN(ev.ts_end);
      const time = hasTime
        ? `${Number(ev.ts).toFixed(1)}s – ${Number(ev.ts_end).toFixed(1)}s`
        : "";
      if (time) lines.push(`[${i + 1}] ${time}`);
      if (ev.behavioral_summary) lines.push(ev.behavioral_summary);
      if (ev.intent) lines.push(`  → Intent: ${ev.intent}`);
      lines.push("");
    });
  }
  return lines.join("\n").trim();
}

function StrategyResult({ result, strategyLabel }) {
  const [copied, setCopied] = useState(false);
  const [readableCopied, setReadableCopied] = useState(false);
  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const copyReadable = () => {
    navigator.clipboard.writeText(toReadableSummary(result, strategyLabel));
    setReadableCopied(true);
    setTimeout(() => setReadableCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">{strategyLabel}</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={copyReadable} title="Copy readable summary for sharing (paste into Slack, email, etc.)">
              {readableCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-600 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <FileText className="h-3.5 w-3.5 mr-1" />
                  Copy readable
                </>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={copyJson} title="Copy full JSON">
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        {result.processing_stats && (
          <p className="text-xs text-muted-foreground">
            LLM calls: {result.processing_stats.llm_calls} · Tokens:{" "}
            {result.processing_stats.total_tokens} ·{" "}
            {(result.processing_stats.processing_time_ms / 1000).toFixed(1)}s
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {result.session_narrative && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Session narrative
            </p>
            <p className="text-sm rounded-md bg-muted/50 p-3">
              {result.session_narrative}
            </p>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Events ({result.events?.length ?? 0})
          </p>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {(result.events ?? []).map((ev, i) => (
              <EnrichedEventCard key={i} event={ev} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

/** Normalize JSON or JSONL file content into a single JSONL string (one JSON object per line). */
function normalizeToJsonl(content) {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const first = trimmed.charAt(0);
  if (first === "[") {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr.map((item) => JSON.stringify(item)).join("\n");
      }
    } catch {
      // fall through to return as-is
    }
  }
  return trimmed;
}

export default function TranscriptPlayground() {
  const [rawJsonl, setRawJsonl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const loadFile = useCallback(async (file) => {
    if (!file || (!file.name.endsWith(".json") && !file.name.endsWith(".jsonl"))) {
      return;
    }
    setError(null);
    try {
      const text = await readFileAsText(file);
      setRawJsonl(normalizeToJsonl(text));
    } catch (e) {
      setError("Could not read file: " + (e?.message || "unknown error"));
    }
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false);
  }, []);

  const onFileInputChange = useCallback(
    (e) => {
      const file = e.target?.files?.[0];
      if (file) loadFile(file);
      e.target.value = "";
    },
    [loadFile]
  );

  const handleProcess = async () => {
    setError(null);
    setResult(null);
    const trimmed = rawJsonl.trim();
    if (!trimmed) {
      setError("Paste some raw JSONL first.");
      return;
    }
    setLoading(true);
    try {
      const apiResult = await interpretRawTranscript(trimmed);
      if (!apiResult.success) {
        setError("error" in apiResult ? apiResult.error : "Request failed.");
        return;
      }
      setResult(apiResult.data);
    } catch (e) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-2xl font-bold text-gray-900">
            Raw transcript playground
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Paste raw JSONL from your cofounder (vision transcript). Get
            processed output from both strategies: chunked and stateful.
          </p>
        </motion.div>

        <div className="space-y-4 mb-6">
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`relative rounded-lg border-2 border-dashed transition-colors min-h-[200px] ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/40"
            }`}
          >
            <Textarea
              placeholder={PLACEHOLDER}
              value={rawJsonl}
              onChange={(e) => setRawJsonl(e.target.value)}
              className="min-h-[200px] font-mono text-sm resize-y border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 rounded-lg resize-none"
            />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center rounded-lg">
              {isDragging && (
                <span className="bg-background/90 text-sm font-medium px-3 py-2 rounded-md shadow-sm border">
                  Drop JSON / JSONL file
                </span>
              )}
            </div>
            <div className="absolute bottom-2 right-2 pointer-events-auto">
              <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                <span>or choose file</span>
                <input
                  type="file"
                  accept=".json,.jsonl,application/json"
                  onChange={onFileInputChange}
                  className="sr-only"
                />
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleProcess}
              disabled={loading}
              className="min-w-[200px]"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Processing…
                </>
              ) : (
                "Process with both strategies"
              )}
            </Button>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Tabs defaultValue="chunked" className="w-full">
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="chunked">Chunked</TabsTrigger>
                <TabsTrigger value="stateful">Stateful</TabsTrigger>
              </TabsList>
              <TabsContent value="chunked" className="mt-4">
                <StrategyResult
                  result={result.chunked}
                  strategyLabel="Chunked (2-pass)"
                />
              </TabsContent>
              <TabsContent value="stateful" className="mt-4">
                <StrategyResult
                  result={result.stateful}
                  strategyLabel="Stateful (1-pass)"
                />
              </TabsContent>
            </Tabs>
          </motion.div>
        )}
      </div>
    </div>
  );
}
