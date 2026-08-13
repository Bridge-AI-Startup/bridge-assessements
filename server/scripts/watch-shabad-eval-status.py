#!/usr/bin/env python3
"""Live status for Shabad eval (submission 6a7601cc0aa5d90129cd2c16).

Modes:
  watch   — clear-screen terminal dashboard (default), refreshes every 2s
  once    — print one status line to stdout
  canvas  — rewrite the Cursor canvas with current metrics
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

TERMINALS_DIR = Path(
    "/Users/adityamittal/.cursor/projects/"
    "Users-adityamittal-Coding-Projects-bridge-assessements/terminals"
)
CANVAS = Path(
    "/Users/adityamittal/.cursor/projects/"
    "Users-adityamittal-Coding-Projects-bridge-assessements/canvases/"
    "shabad-eval-status.canvas.tsx"
)
SUBMISSION_ID = "6a7601cc0aa5d90129cd2c16"
SESSION_ID = "6a78ee900aa5d90129cd2e58"
TOTAL_FALLBACK = 2832
# Optional override: SHABAD_EVAL_TERMINAL=/path/to/N.txt
_ENV_TERMINAL = os.environ.get("SHABAD_EVAL_TERMINAL")


def find_eval_terminal() -> Path | None:
    """Pick the newest eval terminal for this submission (prefer still-running)."""
    if _ENV_TERMINAL:
        p = Path(_ENV_TERMINAL)
        if p.exists():
            return p

    if not TERMINALS_DIR.is_dir():
        return None

    scored: list[tuple[int, float, Path]] = []
    for p in TERMINALS_DIR.glob("*.txt"):
        try:
            raw = p.read_text(errors="replace")
        except OSError:
            continue
        if SUBMISSION_ID not in raw and SESSION_ID not in raw:
            continue
        # Must look like the eval harness (not the watcher itself)
        if "[eval]" not in raw and "generateTranscript" not in raw:
            continue
        if "watch-shabad-eval-status" in raw and "[eval]" not in raw:
            continue
        has_exit = bool(re.search(r"^exit_code:\s*", raw, re.M))
        running = 0 if has_exit else 1
        try:
            mtime = p.stat().st_mtime
        except OSError:
            mtime = 0.0
        scored.append((running, mtime, p))

    if not scored:
        return None
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return scored[0][2]


# Resolved lazily on each read so a restarted eval is picked up automatically.
TERMINAL: Path | None = None


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _fmt_duration(seconds: float | None) -> str:
    if seconds is None or seconds < 0:
        return "—"
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}h {m}m"
    if m:
        return f"{m}m {sec}s"
    return f"{sec}s"


def _fmt_rate(rate: float | None, unit: str = "frames") -> str:
    if not rate:
        return "—"
    return f"{rate * 60:.1f} {unit}/min"


def parse_cursor_terminal(raw: str) -> tuple[str, str, str]:
    """Split Cursor terminal capture into (header, body, footer).

    Important: do NOT split on every `---\\n`. Transcript/stitcher logs can
    contain literal `---` (e.g. `[stitcher] Non-JSON line skipped: ---`), which
    previously truncated the body and froze progress on the canvas.
    """
    if not raw.startswith("---\n"):
        return "", raw, ""

    rest = raw[4:]
    header_sep = rest.find("\n---\n")
    if header_sep < 0:
        return rest, "", ""

    header = rest[:header_sep]
    after_header = rest[header_sep + 5 :]

    # Optional trailing footer: last --- section that looks like exit metadata.
    footer = ""
    body = after_header
    marker = "\n---\n"
    idx = after_header.rfind(marker)
    if idx >= 0:
        maybe_footer = after_header[idx + len(marker) :]
        head = maybe_footer[:240]
        if re.search(r"(?m)^exit_code:\s*", head) or "elapsed_ms:" in head or "ended_at:" in head:
            body = after_header[:idx]
            footer = maybe_footer
    return header, body, footer


def read_status() -> dict:
    terminal = find_eval_terminal()
    global TERMINAL
    TERMINAL = terminal

    if terminal is None or not terminal.exists():
        return {
            "ok": False,
            "phase": "Missing terminal log",
            "error": f"No eval terminal found in {TERMINALS_DIR}",
            "still_running": False,
            "frame": 0,
            "total": TOTAL_FALLBACK,
            "pct": 0.0,
            "terminal_name": None,
        }

    raw = terminal.read_text(errors="replace")
    header, body, footer_block = parse_cursor_terminal(raw)
    # Include trailing footer (exit_code) for completion detection
    scan = body + "\n" + footer_block

    meta: dict[str, str] = {}
    for line in header.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()

    running_ms = int(meta.get("running_for_ms") or 0)
    started = meta.get("started_at")
    pid = meta.get("pid")

    entries: list[tuple[str, int, int]] = []
    for m in re.finditer(
        r"\[([0-9T:\.\-Z]+)\] \[transcript\] Progress: frame (\d+)/(\d+)", body
    ):
        entries.append((m.group(1), int(m.group(2)), int(m.group(3))))

    # Prompt-only full generateTranscript: "Batch N done: ... (frame ~X/Y)"
    for m in re.finditer(
        r"\[([0-9T:\.\-Z]+)\] \[transcript\] Batch \d+ done:.*?\(frame ~(\d+)/(\d+)\)",
        body,
    ):
        entries.append((m.group(1), int(m.group(2)), int(m.group(3))))

    # Sampled eval harness: "[eval] batch N / M" (vision batches, not full frames)
    batch_entries: list[tuple[str, int, int]] = []
    for m in re.finditer(r"\[eval\] batch (\d+)\s*/\s*(\d+)", body):
        # No ISO timestamp on these lines — use nearest preceding vision ts if any
        batch_entries.append(("", int(m.group(1)), int(m.group(2))))
    # Attach timestamps from preceding [vision] lines when available
    vision_ts = [
        m.group(1)
        for m in re.finditer(r"\[([0-9T:\.\-Z]+)\] \[vision\]", body)
    ]
    if batch_entries and vision_ts:
        for i, (_blank, n, mtot) in enumerate(batch_entries):
            ts = vision_ts[min(i, len(vision_ts) - 1)]
            batch_entries[i] = (ts, n, mtot)

    sampling_m = re.search(
        r"\[eval\] sampling (\d+) of (\d+) frames", body
    )
    sampled_frames = int(sampling_m.group(1)) if sampling_m else None
    source_frames = int(sampling_m.group(2)) if sampling_m else None

    # Prefer full-frame progress; ignore sampled batch counts when frame progress exists
    progress_mode = "frames"
    if entries:
        # Sort by timestamp so mixed Progress/Batch lines stay chronological
        entries.sort(key=lambda e: e[0] or "")
        frame, total = entries[-1][1], entries[-1][2]
        last_progress_ts = entries[-1][0]
        rate_entries = entries
    elif batch_entries:
        # Treat vision batches as progress units for sampled evals
        progress_mode = "batches"
        frame, total = batch_entries[-1][1], batch_entries[-1][2]
        last_progress_ts = batch_entries[-1][0] or None
        rate_entries = [e for e in batch_entries if e[0]]
    else:
        frame, total = 0, TOTAL_FALLBACK
        last_progress_ts = None
        rate_entries = []

    rate = None
    eta_s = None
    sample = rate_entries[-12:] if len(rate_entries) >= 2 else rate_entries
    if len(sample) >= 2 and sample[0][0] and sample[-1][0]:
        dt = (_parse_iso(sample[-1][0]) - _parse_iso(sample[0][0])).total_seconds()
        df = sample[-1][1] - sample[0][1]
        if dt > 0 and df > 0:
            rate = df / dt
            eta_s = (total - frame) / rate

    overall_rate = None
    if len(rate_entries) >= 2 and rate_entries[0][0] and rate_entries[-1][0]:
        dt = (
            _parse_iso(rate_entries[-1][0]) - _parse_iso(rate_entries[0][0])
        ).total_seconds()
        df = rate_entries[-1][1] - rate_entries[0][1]
        if dt > 0 and df > 0:
            overall_rate = df / dt

    # Phase from body only (command source in header can contain "FAILED")
    phase = "Starting"
    if (
        "[eval] generating/finalizing transcript" in body
        or "[eval] generating transcript" in body
        or "[transcript] Preparing" in body
        or "[framePrep]" in body
        or "[videoExtractor]" in body
        or "[eval] sampling" in body
        or "[eval] loaded" in body
    ):
        phase = "Preparing frames"
    if (
        "[transcript] Processing" in body
        or "Progress: frame" in body
        or "Batch " in body and "done:" in body
        or "Resuming generation from frame" in body
        or ("[eval] loaded" in body and "running vision batches" in body)
        or "[eval] batch" in body
    ):
        phase = "Generating transcript"
    if "[eval] batch" in body and "frame ~" not in body:
        phase = "Vision batches (sampled)"
    if "Checkpoint saved:" in body and phase == "Generating transcript":
        pass  # keep generating
    if "[eval] transcript segments:" in body:
        phase = "Stitching transcript"
    if "[eval] running criteria evaluation" in body or (
        "[eval] transcript events:" in body
        and ("running evaluateTranscript" in body or "evaluating" in body)
    ):
        phase = "Running evaluateTranscript"
    if re.search(r'"ok"\s*:\s*true', body) and (
        "evaluationStatus" in body or "criteriaResults" in body
    ):
        phase = "Completed"
    if re.search(r"^\[eval\] FAILED:", body, re.M) or re.search(
        r"^\[transcript\] FAILED", body, re.M
    ):
        phase = "Failed"

    footer = re.search(r"exit_code:\s*(\S+)", scan)
    exit_code = None
    if footer:
        raw_code = footer.group(1)
        exit_code = int(raw_code) if raw_code.isdigit() else -1
    still_running = exit_code is None
    if exit_code is not None:
        if exit_code == 0 and phase != "Failed":
            phase = "Completed"
        elif exit_code != 0:
            phase = "Failed"

    last_activity = None
    for m in re.finditer(r"\[([0-9T:\.\-Z]+)\]", body):
        last_activity = m.group(1)

    keys = (
        "[transcript]",
        "[eval]",
        "[vision]",
        "[retry]",
        "[ocr]",
        "[framePrep]",
        "[videoExtractor]",
        "FAILED",
        '"ok"',
        "Checkpoint",
    )
    interesting = [l for l in body.splitlines() if any(k in l for k in keys)]
    # Prefer the concise failure line over stack frames
    fail_lines = [
        l
        for l in interesting
        if "[eval] FAILED:" in l or "[transcript] FAILED" in l or "transcript generation error:" in l
    ]
    last_line = (fail_lines[-1] if fail_lines else interesting[-1] if interesting else "")[-180:]

    rate_limits = len(re.findall(r"rate limited", body))
    vision_calls = len(re.findall(r"\[vision\] Calling", body))
    regions = sorted(set(re.findall(r"Flushing \d+ (\w+) crop", body[-12000:])))
    checkpoints = len(re.findall(r"Checkpoint saved:", body))

    chart_src = entries if entries else [e for e in batch_entries if e[0]]
    hist: list[tuple[str, int]] = []
    for ts, f, _t in chart_src:
        step = 1 if progress_mode == "batches" else 50
        if f == 1 or f % step == 0 or f == chart_src[-1][1]:
            hist.append((ts, f))

    # Relative minutes from first progress for chart
    chart = []
    if chart_src and chart_src[0][0]:
        t0 = _parse_iso(chart_src[0][0])
        for ts, f in hist:
            if not ts:
                continue
            mins = (_parse_iso(ts) - t0).total_seconds() / 60.0
            chart.append({"minutes": round(mins, 1), "frame": f})

    pct = round(100.0 * frame / total, 2) if total else 0.0
    if phase in ("Completed", "Failed"):
        next_phase = "done"
    elif phase == "Vision batches (sampled)":
        next_phase = "stitch → evaluateTranscript"
    elif phase in ("Generating transcript", "Stitching transcript"):
        next_phase = "evaluateTranscript"
    else:
        next_phase = "transcript → evaluate"

    unit = "batches" if progress_mode == "batches" else "frames"
    sample_note = ""
    if sampled_frames and source_frames:
        sample_note = f"sampled {sampled_frames}/{source_frames} frames (every 20th)"

    return {
        "ok": True,
        "still_running": still_running,
        "exit_code": exit_code,
        "phase": phase,
        "next_phase": next_phase,
        "frame": frame,
        "total": total,
        "pct": pct,
        "progress_mode": progress_mode,
        "unit": unit,
        "sample_note": sample_note,
        "sampled_frames": sampled_frames,
        "source_frames": source_frames,
        "rate": rate,
        "overall_rate": overall_rate,
        "eta_s": eta_s,
        "running_ms": running_ms,
        "started": started,
        "pid": pid,
        "last_progress_ts": last_progress_ts,
        "last_activity": last_activity,
        "rate_limits": rate_limits,
        "vision_calls": vision_calls,
        "regions": regions,
        "checkpoints": checkpoints,
        "last_line": last_line,
        "chart": chart,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "submission_id": SUBMISSION_ID,
        "terminal_name": terminal.name,
    }


def print_once(s: dict) -> None:
    if not s.get("ok"):
        print(s.get("error") or "unavailable")
        return
    status = "RUNNING" if s["still_running"] else s["phase"].upper()
    unit = s.get("unit") or "frames"
    note = f" · {s['sample_note']}" if s.get("sample_note") else ""
    print(
        f"[{status}] {s['phase']} · {unit} {s['frame']}/{s['total']} ({s['pct']}%) · "
        f"ETA {_fmt_duration(s['eta_s'])} · rate {_fmt_rate(s['rate'], unit)} · "
        f"elapsed {_fmt_duration((s['running_ms'] or 0) / 1000)} · "
        f"429s={s['rate_limits']}{note}"
    )
    if s.get("last_line"):
        print(f"  last: {s['last_line']}")


def print_watch(s: dict) -> None:
    if sys.stdout.isatty():
        os.system("clear" if os.name != "nt" else "cls")
    else:
        print("\n" + "=" * 64)
        print(time.strftime("%Y-%m-%d %H:%M:%S"))
    bar_w = 40
    filled = int(bar_w * (s.get("pct") or 0) / 100)
    bar = "#" * filled + "-" * (bar_w - filled)
    print("Shabad eval status")
    print(f"submission: {SUBMISSION_ID}")
    print()
    if not s.get("ok"):
        print(s.get("error"))
        return
    run = "LIVE" if s["still_running"] else f"STOPPED (exit {s.get('exit_code')})"
    unit = s.get("unit") or "frames"
    print(f"{run}  |  {s['phase']}")
    print(f"[{bar}]  {s['pct']}%")
    print(f"{unit:10} {s['frame']} / {s['total']}")
    if s.get("sample_note"):
        print(f"sample     {s['sample_note']}")
    print(
        f"rate       {_fmt_rate(s['rate'], unit)}  "
        f"(overall {_fmt_rate(s['overall_rate'], unit)})"
    )
    print(f"ETA        {_fmt_duration(s['eta_s'])}")
    print(f"elapsed    {_fmt_duration((s['running_ms'] or 0) / 1000)}")
    print(f"vision     {s['vision_calls']} calls · {s['rate_limits']} rate-limits")
    if s.get("checkpoints"):
        print(f"checkpoints {s['checkpoints']}")
    if s.get("regions"):
        print(f"regions    {', '.join(s['regions'])}")
    print(f"next       {s['next_phase']}")
    print(f"terminal   {s.get('terminal_name') or '—'}")
    print(f"updated    {s['updated_at']}  (pid {s.get('pid')})")
    print()
    print("recent:")
    print(f"  {s.get('last_line') or '—'}")
    print()
    if sys.stdout.isatty():
        print("Ctrl+C to stop watcher (does not stop the eval).")
    sys.stdout.flush()


def _js_str(s: str) -> str:
    return (
        s.replace("\\", "\\\\")
        .replace("`", "\\`")
        .replace("${", "\\${")
        .replace('"', '\\"')
    )


_LAST_CANVAS_KEY: tuple | None = None


def _downsample_chart(chart: list[dict], max_points: int = 18) -> list[dict]:
    """Keep LineChart categories small so the canvas preview stays stable."""
    if len(chart) <= max_points:
        return chart
    # Always keep first + last; evenly sample the middle.
    if max_points < 3:
        return chart[-max_points:]
    inner = max_points - 2
    step = (len(chart) - 2) / inner
    out = [chart[0]]
    for i in range(inner):
        idx = 1 + int(i * step)
        idx = min(idx, len(chart) - 2)
        out.append(chart[idx])
    out.append(chart[-1])
    # De-dupe consecutive identical frames while preserving order
    deduped: list[dict] = []
    for p in out:
        if not deduped or deduped[-1]["frame"] != p["frame"] or deduped[-1]["minutes"] != p["minutes"]:
            deduped.append(p)
    return deduped


def write_canvas(s: dict, *, force: bool = False) -> bool:
    """Rewrite the Cursor canvas. Returns True if the file was written."""
    global _LAST_CANVAS_KEY
    CANVAS.parent.mkdir(parents=True, exist_ok=True)
    if not s.get("ok"):
        # Keep last good canvas if transient read fails mid-run
        return False

    # Skip no-op rewrites so the IDE canvas doesn't thrash/blank on every poll.
    canvas_key = (
        s.get("still_running"),
        s.get("phase"),
        s.get("frame"),
        s.get("total"),
        s.get("exit_code"),
        s.get("vision_calls"),
        s.get("checkpoints"),
        s.get("last_line"),
        s.get("terminal_name"),
    )
    if not force and canvas_key == _LAST_CANVAS_KEY:
        return False

    phase = s["phase"]
    tone = "info"
    if phase == "Completed":
        tone = "success"
    elif phase == "Failed":
        tone = "danger"
    elif s["still_running"]:
        tone = "warning"

    chart_points = _downsample_chart(list(s.get("chart") or []))
    chart_categories = ", ".join(f'"{p["minutes"]}m"' for p in chart_points)
    chart_values = ", ".join(str(p["frame"]) for p in chart_points)
    regions = ", ".join(s.get("regions") or []) or "-"
    last_line = _js_str(s.get("last_line") or "-")
    eta = _fmt_duration(s.get("eta_s"))
    unit = s.get("unit") or "frames"
    rate = _fmt_rate(s.get("rate"), unit)
    overall = _fmt_rate(s.get("overall_rate"), unit)
    elapsed = _fmt_duration((s.get("running_ms") or 0) / 1000)
    live = "Live" if s["still_running"] else "Stopped"
    # Pill tone is deprecated/ignored by the SDK, but keep a valid value.
    pill_tone = "warning" if s["still_running"] else ("success" if phase == "Completed" else "deleted")

    chart_block = ""
    terminal_name = s.get("terminal_name") or "eval"
    checkpoints = int(s.get("checkpoints") or 0)
    sample_note = s.get("sample_note") or ""
    chart_title = (
        "Vision batches completed vs elapsed minutes"
        if unit == "batches"
        else "Transcript frames processed vs elapsed minutes"
    )
    series_name = "Batches completed" if unit == "batches" else "Frames processed"
    value_suffix = " batches" if unit == "batches" else " frames"
    progress_label = "Batch progress" if unit == "batches" else "Transcript progress"
    if chart_points:
        chart_block = f"""
      <Card>
        <CardHeader>{chart_title}</CardHeader>
        <CardBody>
          <LineChart
            categories={{[{chart_categories}]}}
            series={{[{{ name: "{series_name}", data: [{chart_values}], tone: "info" }}]}}
            height={{220}}
            fill={{false}}
            yMax={{{s["total"]}}}
            valueSuffix="{value_suffix}"
          />
          <Text size="small" tone="secondary" style={{{{ marginTop: 8 }}}}>
            Source: eval terminal {terminal_name} | minutes since first Progress line | updated {s["updated_at"]}
          </Text>
        </CardBody>
      </Card>"""

    sample_callout = ""
    if sample_note:
        sample_callout = f"""
      <Text size="small" tone="secondary">
        {_js_str(sample_note)}
      </Text>"""

    # Prefer plain string labels (avoid nested template literals in generated JSX).
    top_left = _js_str(f"{s['pct']}% complete")
    top_right = _js_str(f"{s['frame']:,} / {s['total']:,} {unit}")
    pct_stat = _js_str(f"{s['pct']}%")

    contents = f"""import {{
  Card,
  CardBody,
  CardHeader,
  Callout,
  Grid,
  H1,
  LineChart,
  Pill,
  Row,
  Stack,
  Stat,
  Text,
  UsageBar,
}} from "cursor/canvas";

const SNAPSHOT = {{
  updatedAt: "{s["updated_at"]}",
  phase: "{_js_str(phase)}",
  live: "{live}",
  frame: {s["frame"]},
  total: {s["total"]},
  pct: {s["pct"]},
  unit: "{unit}",
  sampleNote: "{_js_str(sample_note)}",
  eta: "{eta}",
  rate: "{rate}",
  overallRate: "{overall}",
  elapsed: "{elapsed}",
  visionCalls: {s["vision_calls"]},
  rateLimits: {s["rate_limits"]},
  checkpoints: {checkpoints},
  regions: "{_js_str(regions)}",
  nextPhase: "{_js_str(s["next_phase"])}",
  submissionId: "{SUBMISSION_ID}",
  terminalName: "{_js_str(terminal_name)}",
  lastLine: "{last_line}",
}};

export default function ShabadEvalStatus() {{
  return (
    <Stack gap={{16}} style={{{{ padding: 16 }}}}>
      <Stack gap={{6}}>
        <Row gap={{10}} align="center">
          <H1 style={{{{ margin: 0 }}}}>Shabad evaluation</H1>
          <Pill tone="{pill_tone}" active>{{SNAPSHOT.live}}</Pill>
          <Pill>{{SNAPSHOT.phase}}</Pill>
        </Row>
        <Text tone="secondary" size="small">
          Submission {{SNAPSHOT.submissionId}} | terminal {{SNAPSHOT.terminalName}} | {{SNAPSHOT.updatedAt}}
        </Text>
      </Stack>

      <Callout tone="{tone}" title={{SNAPSHOT.phase}}>
        {{SNAPSHOT.unit}} {{SNAPSHOT.frame.toLocaleString()}} / {{SNAPSHOT.total.toLocaleString()}} (
        {{SNAPSHOT.pct}}%). Next: {{SNAPSHOT.nextPhase}}.
      </Callout>
{sample_callout}

      <UsageBar
        total={{SNAPSHOT.total}}
        topLeftLabel="{top_left}"
        topRightLabel="{top_right}"
        segments={{[{{ id: "done", value: SNAPSHOT.frame, color: "blue" }}]}}
      />

      <Grid columns={{4}} gap={{12}}>
        <Stat value="{pct_stat}" label="{progress_label}" tone="info" />
        <Stat value={{SNAPSHOT.eta}} label="ETA (recent rate)" />
        <Stat value={{SNAPSHOT.rate}} label="Recent throughput" />
        <Stat value={{SNAPSHOT.elapsed}} label="Elapsed runtime" />
      </Grid>

      <Grid columns={{3}} gap={{12}}>
        <Card>
          <CardHeader>Pipeline</CardHeader>
          <CardBody>
            <Stack gap={{6}}>
              <Text weight="semibold">{{SNAPSHOT.phase}}</Text>
              <Text size="small" tone="secondary">
                1) Generate transcript from screen recording frames
              </Text>
              <Text size="small" tone="secondary">
                2) Run evaluateTranscript against assessment criteria
              </Text>
              <Text size="small" tone="secondary">
                Next step: {{SNAPSHOT.nextPhase}}
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Vision / OCR load</CardHeader>
          <CardBody>
            <Stack gap={{6}}>
              <Text>{{SNAPSHOT.visionCalls.toLocaleString()}} vision calls</Text>
              <Text>{{SNAPSHOT.rateLimits.toLocaleString()}} rate-limit retries (429)</Text>
              <Text>{{SNAPSHOT.checkpoints.toLocaleString()}} transcript checkpoints</Text>
              <Text size="small" tone="secondary">
                Active regions: {{SNAPSHOT.regions}}
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Throughput</CardHeader>
          <CardBody>
            <Stack gap={{6}}>
              <Text>Recent: {{SNAPSHOT.rate}}</Text>
              <Text>Overall: {{SNAPSHOT.overallRate}}</Text>
              <Text size="small" tone="secondary">
                ETA uses the last ~12 progress samples. Checkpoints every ~50 frames.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>
{chart_block}

      <Card>
        <CardHeader>Latest log line</CardHeader>
        <CardBody>
          <Text size="small" style={{{{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}}}>
            {{SNAPSHOT.lastLine}}
          </Text>
        </CardBody>
      </Card>
    </Stack>
  );
}}
"""
    # Atomic replace avoids the IDE briefly reading a truncated file (blank canvas).
    tmp = CANVAS.with_suffix(".canvas.tsx.tmp")
    tmp.write_text(contents, encoding="utf-8")
    os.replace(tmp, CANVAS)
    _LAST_CANVAS_KEY = canvas_key
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "mode",
        nargs="?",
        default="watch",
        choices=("watch", "once", "canvas"),
    )
    ap.add_argument("--interval", type=float, default=2.0, help="watch refresh seconds")
    args = ap.parse_args()

    if args.mode == "once":
        print_once(read_status())
        return 0

    if args.mode == "canvas":
        s = read_status()
        wrote = write_canvas(s, force=True)
        print_once(s)
        print(f"canvas → {CANVAS}" + ("" if wrote else " (unchanged)"))
        return 0

    # watch
    try:
        while True:
            s = read_status()
            print_watch(s)
            try:
                wrote = write_canvas(s)
                if wrote:
                    print(f"(canvas updated → {CANVAS.name})", flush=True)
            except OSError as e:
                print(f"(canvas write skipped: {e})", file=sys.stderr)
            if not s.get("still_running"):
                # Final force-write so Completed/Failed always lands on disk.
                try:
                    write_canvas(s, force=True)
                except OSError:
                    pass
                print("\nEval finished — watcher exiting.")
                return 0 if s.get("phase") == "Completed" else 1
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nWatcher stopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
