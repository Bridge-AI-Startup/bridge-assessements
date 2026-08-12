/**
 * Dev-only live tester for workflow capture.
 *
 * Records the screen, streams hook events, and plays the recording back synced
 * to the timeline: click any event — in the list or on the scrubber — and the
 * player jumps to that moment. Nothing here analyses the video; it exists only
 * so a human can watch what the timeline describes.
 *
 * Never mounted in production (see routes/workflowCapture.ts).
 */

export function renderTesterPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Workflow Capture — live tester</title>
<style>
  :root {
    --bg:#faf9f2; --panel:#fff; --ink:#21201c; --muted:#6b6862; --line:#e7e4da;
    --user:#1f6feb; --assist:#8250df; --tool:#9a6700; --agent:#1a7f37; --result:#57606a;
    --rec:#cf222e;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding-bottom:300px; }
  header { position:sticky; top:0; z-index:5; background:var(--panel);
    border-bottom:1px solid var(--line); padding:12px 20px;
    display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  h1 { font-size:15px; margin:0; font-weight:600; letter-spacing:-.01em; }
  select,button { font:inherit; padding:6px 10px; border:1px solid var(--line);
    border-radius:8px; background:#fff; color:var(--ink); cursor:pointer; }
  button:hover:not(:disabled) { background:#f6f5ef; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button.rec { background:var(--rec); border-color:var(--rec); color:#fff; }
  button.rec:hover:not(:disabled) { background:#a40e26; }
  .live { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); }
  .dot { width:8px; height:8px; border-radius:50%; background:#1a7f37; }
  .dot.paused { background:#9a6700; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  .dot:not(.paused) { animation:pulse 1.6s ease-in-out infinite; }
  main { padding:20px; max-width:1100px; margin:0 auto; }
  .warn { background:#fff8e6; border:1px solid #f0d68a; color:#7a5b00;
    border-radius:10px; padding:10px 14px; margin-bottom:14px; font-size:13px; display:none; }
  .stats { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px;
    padding:10px 14px; min-width:92px; }
  .stat b { display:block; font-size:20px; font-weight:600; }
  .stat span { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px; margin-bottom:18px; }
  section h2 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);
    margin:0; padding:12px 16px; border-bottom:1px solid var(--line); }
  .row { display:flex; gap:12px; padding:10px 16px; border-bottom:1px solid #f2f0e8; }
  .row:last-child { border-bottom:0; }
  .row.seekable { cursor:pointer; }
  .row.seekable:hover { background:#f6f5ef; }
  .row.active { background:#fff8e6; }
  .time { color:var(--muted); font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; }
  .vt { font-size:11px; color:var(--user); font-variant-numeric:tabular-nums;
    white-space:nowrap; min-width:44px; }
  .vt.none { color:#c9c5b8; }
  .tag { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
    white-space:nowrap; min-width:66px; }
  .t-user_prompt{color:var(--user)} .t-assistant_message{color:var(--assist)}
  .t-tool_use{color:var(--tool)}
  .t-tool_result,.t-session_start,.t-session_end,.t-notification{color:var(--result)}
  .text { white-space:pre-wrap; word-break:break-word; flex:1; }
  .tool-name { color:var(--muted); font-size:12px; }
  .empty { padding:26px 16px; text-align:center; color:var(--muted); }
  .file { display:flex; gap:12px; align-items:center; padding:8px 16px; border-bottom:1px solid #f2f0e8; }
  .file:last-child { border-bottom:0; }
  .file code { flex:1; font-size:13px; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); }
  .badge.agent { color:var(--agent); border-color:#b7e0c2; background:#f0fbf3; }
  .badge.snapshot { color:var(--muted); background:#f6f5ef; }
  .hint { color:var(--muted); font-size:12px; margin:0 0 16px; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }

  /* ---- video dock: video sits directly ON TOP of the scrubber ---- */
  #dock { position:fixed; left:0; right:0; bottom:0; background:var(--panel);
    border-top:1px solid var(--line); box-shadow:0 -6px 20px rgba(33,32,28,.07);
    padding:10px 20px 12px; }
  .dockhead { display:flex; align-items:baseline; gap:12px; margin-bottom:8px; }
  .dockhead h3 { margin:0; font-size:12px; text-transform:uppercase;
    letter-spacing:.05em; color:var(--muted); }
  #videoStatus { font-size:12px; color:var(--muted); margin:0; }
  #nowPlaying { font-size:12px; margin-left:auto; color:var(--ink); }
  /* the stack: player centred, scrubber immediately beneath at the same width */
  #stack { max-width:760px; margin:0 auto; }
  #dock video { width:100%; max-height:180px; background:#000; border-radius:8px 8px 0 0;
    display:block; object-fit:contain; }
  #dockToggle { position:absolute; right:20px; top:8px; }

  /* scrubber: the video's own duration, with one tick per captured event */
  #scrub { position:relative; height:56px; border-radius:0 0 8px 8px;
    background:#f2f0e8; border:1px solid var(--line); border-top:0;
    cursor:pointer; overflow:hidden; }
  /* continuous screen-state band: what was visible at every moment */
  #scrubBand { position:absolute; left:0; right:0; top:0; height:16px; }
  .band { position:absolute; top:0; height:16px; }
  .band.redundant { opacity:.55; }
  .b-ide{background:#c9c5b8} .b-terminal{background:#9c968a}
  .b-cli_agent{background:#6f6a5e}
  .b-browser\\:search{background:#1f6feb} .b-browser\\:docs{background:#1a9c8f}
  .b-browser\\:ai_chat{background:#8250df} .b-browser\\:own_app{background:#1a7f37}
  .b-other{background:#d9b26f} .b-idle{background:#ece9e0}
  #bandLegend { display:flex; gap:10px; flex-wrap:wrap; font-size:10px;
    color:var(--muted); margin-top:6px; }
  #bandLegend i { display:inline-block; width:9px; height:9px; border-radius:2px;
    margin-right:3px; vertical-align:-1px; }
  #scrubGaps { position:absolute; left:0; right:0; top:16px; bottom:0; }
  .gap { position:absolute; top:0; bottom:0; background:repeating-linear-gradient(
      45deg,#e7e4da,#e7e4da 4px,#dcd8cc 4px,#dcd8cc 8px); }
  .mark { position:absolute; top:6px; width:3px; height:20px; border-radius:2px;
    transform:translateX(-1.5px); cursor:pointer; }
  .mark:hover { height:26px; top:3px; }
  .mark.m-user_prompt{background:var(--user)} .mark.m-assistant_message{background:var(--assist)}
  .mark.m-tool_use{background:var(--tool)}
  .mark.m-tool_result,.mark.m-session_start,.mark.m-session_end,.mark.m-notification{background:#b9b5a8}
  #playhead { position:absolute; top:0; bottom:0; width:2px; background:var(--ink);
    transform:translateX(-1px); pointer-events:none; }
  #scrubLabels { position:absolute; left:0; right:0; bottom:3px; height:14px;
    font-size:10px; color:var(--muted); pointer-events:none; }
  #scrubLabels span { position:absolute; transform:translateX(-50%); }
  #tip { position:fixed; z-index:20; background:var(--ink); color:#fff; font-size:12px;
    padding:5px 9px; border-radius:6px; pointer-events:none; display:none; max-width:340px; }
</style>
</head>
<body>
<header>
  <h1>Workflow Capture — live tester</h1>
  <select id="sessions"></select>
  <span class="live"><span class="dot" id="dot"></span><span id="liveLabel">live</span></span>
  <button id="pollToggle">Pause</button>
  <button id="recBtn" class="rec">● Start screen recording</button>
  <span id="recInfo" class="live"></span>
</header>
<main>
  <div class="warn" id="warn"></div>
  <p class="hint">
    1. Click <b>Start screen recording</b> · 2. run
    <code>node capture-kit/setup.js --local</code> in a scratch git repo ·
    3. work with <code>claude</code> · 4. click any event, or any tick on the
    scrubber, to jump the video there. If the share stops, just hit
    <b>Resume recording</b> — earlier footage is kept.
  </p>
  <div class="stats" id="stats"></div>
  <section>
    <h2>Deterministic metrics <span style="text-transform:none;letter-spacing:0">— counted, not judged</span></h2>
    <div id="metrics"><div class="empty">Loading…</div></div>
  </section>
  <section>
    <h2>Timeline</h2>
    <div id="timeline"><div class="empty">Waiting for events…</div></div>
  </section>
  <section>
    <h2>Code state</h2>
    <div id="files"><div class="empty">No files captured yet.</div></div>
  </section>
</main>
<div id="dock">
  <button id="dockToggle">Hide</button>
  <div id="dockBody">
    <div class="dockhead">
      <h3>Recording</h3>
      <p id="videoStatus">No recording yet.</p>
      <div id="nowPlaying"></div>
    </div>
    <div id="stack">
      <video id="player" controls preload="metadata"></video>
      <div id="scrub">
        <div id="scrubBand"></div>
        <div id="scrubGaps"></div>
        <div id="playhead" style="left:0"></div>
        <div id="scrubLabels"></div>
      </div>
      <div id="bandLegend"></div>
    </div>
  </div>
</div>
<div id="tip"></div>
<script>
(function () {
  var paused = false, selected = null, token = null;
  var recorder = null, recStream = null, chunkCount = 0, lastChunkAt = 0;
  var currentEvents = [], videoMeta = null, videoDuration = 0, screenBand = [];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c];
    });
  }
  function hhmmss(iso) {
    try { return new Date(iso).toTimeString().slice(0,8); } catch (e) { return "--:--:--"; }
  }
  function mmss(sec) {
    if (sec == null) return "—";
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  var LABEL = { session_start:"session", session_end:"end", user_prompt:"prompt",
    assistant_message:"reply", tool_use:"tool", tool_result:"result", notification:"note" };

  function warn(msg) {
    var el = $("warn");
    if (!msg) { el.style.display = "none"; return; }
    el.textContent = msg; el.style.display = "block";
  }

  // ---- recording -------------------------------------------------------
  async function startRecording() {
    if (!token) { warn("No capture session yet — run the setup command first."); return; }
    var stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
        // Pick the whole screen by default: a tab or window share ends the
        // moment that surface goes away (tab navigates, window closes), which
        // is the usual cause of a recording "randomly" stopping.
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        // Let the user switch what is shared without ending the track.
        surfaceSwitching: "include",
        systemAudio: "exclude",
      });
    } catch (e) { return; } // user dismissed the picker
    warn("");
    recStream = stream;

    var track = stream.getVideoTracks()[0];
    var surface = (track.getSettings && track.getSettings().displaySurface) || "unknown";
    if (surface === "browser" || surface === "window") {
      warn(
        "You are sharing a " + surface + ". That share ends as soon as that " +
        (surface === "browser" ? "tab navigates or closes" : "window closes") +
        " — which stops the recording. Sharing your Entire Screen is much more reliable."
      );
    }

    var r = await fetch("./video/start", { method:"POST", headers:{ Authorization:"Bearer "+token }});
    var info = await r.json().catch(function(){ return {}; });

    var mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9" : "video/webm";
    recorder = new MediaRecorder(stream, { mimeType:mime, videoBitsPerSecond:1000000 });
    lastChunkAt = Date.now();

    recorder.ondataavailable = async function (e) {
      if (!e.data || !e.data.size) return;
      var fd = new FormData();
      fd.append("chunk", e.data, "chunk.webm");
      try {
        await fetch("./video/chunk", { method:"POST",
          headers:{ Authorization:"Bearer "+token }, body: fd });
        chunkCount++; lastChunkAt = Date.now();
        $("recInfo").textContent = chunkCount + " chunk(s) uploaded";
      } catch (err) { /* one failed chunk must not stop the recording */ }
    };
    // MediaRecorder itself can fail (codec, disk, tab discarded) — surface it
    // instead of letting the recording die silently, which is what "the video
    // randomly stopped" actually looks like from the outside.
    recorder.onerror = function (e) {
      stopRecording("recorder_error: " + ((e && e.error && e.error.name) || "unknown"));
    };
    // Ending the share from Chrome's own "Stop sharing" bar, or the shared
    // surface going away, ends the track. This is the most common cause of a
    // recording stopping without anyone touching our UI — so say which surface
    // it was, otherwise the diagnosis is just "it stopped".
    track.addEventListener("ended", function () {
      stopRecording("share_ended (" + surface + ")");
    });

    recorder.start(3000);
    document.title = "● Recording — Workflow Capture";
    if (window.Notification && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (e) {}
    }
    $("recBtn").textContent = "■ Stop recording";
    $("recBtn").classList.remove("rec");
    $("videoStatus").textContent = info.resuming
      ? "Recording (resumed — segment " + ((info.segmentIndex || 0) + 1) + ")…"
      : "Recording…";
  }

  async function stopRecording(reason) {
    if (!recorder && !recStream) return;
    if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch (e) {} }
    if (recStream) recStream.getTracks().forEach(function (t) { t.stop(); });
    recorder = null; recStream = null;

    $("recBtn").textContent = "● Resume recording";
    $("recBtn").classList.add("rec");
    if (reason && reason !== "manual") {
      warn("Recording stopped: " + reason.replace(/_/g, " ") +
           ". Earlier footage is kept — click Resume recording to continue.");
      // You are almost certainly in another app when this happens, so put it
      // in the one place a background tab can still shout: the title.
      document.title = "⏹ RECORDING STOPPED — Workflow Capture";
      if (window.Notification && Notification.permission === "granted") {
        try {
          new Notification("Workflow capture", {
            body: "Screen recording stopped (" + reason.replace(/_/g, " ") + "). Click Resume to continue.",
          });
        } catch (e) {}
      }
    }
    setTimeout(async function () {
      if (token) {
        await fetch("./video/stop", {
          method:"POST",
          headers:{ "Content-Type":"application/json", Authorization:"Bearer "+token },
          body: JSON.stringify({ reason: reason || "manual" })
        });
      }
      $("videoStatus").textContent = "Processing recording, classifying screen…";
      setTimeout(loadVideo, 900);
      // Classification runs server-side on stop; poll a little longer than the
      // normal cadence so the band appears without anyone clicking anything.
      var tries = 0;
      var poll = setInterval(function () {
        tries++;
        load();
        if (screenBand.length > 0 || tries > 40) {
          clearInterval(poll);
          if (screenBand.length > 0) {
            $("videoStatus").textContent =
              "Recording ready — screen classified (" + screenBand.length + " spans).";
          }
        }
      }, 3000);
    }, 1200);
  }

  // A stalled upload means the recording is dead even though nothing errored.
  // Only judged while the page is visible: Chrome throttles timers (and can
  // defer MediaRecorder delivery) in background tabs, so a short threshold on a
  // hidden page would kill perfectly healthy recordings — the very failure this
  // check exists to catch.
  setInterval(function () {
    if (!recorder) return;
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastChunkAt > 45000) stopRecording("upload_stalled");
  }, 5000);

  // Losing the page loses the recording, so make it hard to do by accident.
  window.addEventListener("beforeunload", function (e) {
    if (!recorder) return;
    e.preventDefault();
    e.returnValue = "";
  });

  function loadVideo() {
    if (!selected) return;
    var v = $("player");
    v.src = "./sessions/" + encodeURIComponent(selected) + "/video?t=" + Date.now();
    v.load();
    v.onloadedmetadata = function () {
      videoDuration = isFinite(v.duration) ? v.duration : 0;
      $("videoStatus").textContent = "Recording ready — " + mmss(videoDuration) + " total.";
      renderScrubber();
    };
    v.onerror = function () { $("videoStatus").textContent = "No recording available yet."; };
  }

  // ---- scrubber --------------------------------------------------------
  function scrubDuration() {
    return videoDuration || (videoMeta && videoMeta.totalRecordedSeconds) || 0;
  }

  var LABEL_TEXT = {
    "ide": "editor", "terminal": "terminal", "cli_agent": "CLI agent",
    "browser:search": "search",
    "browser:docs": "docs", "browser:ai_chat": "AI in browser",
    "browser:own_app": "their app", "other": "other", "idle": "idle"
  };

  /**
   * The continuous band: what Gemini says was on screen at every moment.
   * Drawn UNDER the event ticks so you read both at once — the state at any
   * instant, and the captured moments that punctuate it.
   */
  function renderBand(dur) {
    var band = $("scrubBand"), legend = $("bandLegend");
    if (!dur || !screenBand.length) {
      band.innerHTML = "";
      // Classification runs by itself when a recording stops; say what state we
      // are in rather than pointing at a button that no longer exists.
      legend.innerHTML = !videoMeta || !videoMeta.chunkCount
        ? "<span>Screen band appears once a recording exists.</span>"
        : recorder
          ? "<span>Recording — the screen band is built when you stop.</span>"
          : "<span>Classifying screen… this takes up to a minute after stopping.</span>";
      return;
    }
    band.innerHTML = screenBand.map(function (s) {
      var left = Math.max(0, Math.min(100, (s.start / dur) * 100));
      var width = Math.max(0.4, Math.min(100 - left, ((s.end - s.start) / dur) * 100));
      var cls = "band b-" + s.label + (s.redundant ? " redundant" : "");
      var title = (LABEL_TEXT[s.label] || s.label) +
        (s.detail ? " — " + s.detail : "") +
        (s.concurrentWithAgent ? " (while the agent was working)" : "");
      return '<div class="' + cls + '" style="left:' + left + '%;width:' + width +
        '%" title="' + esc(title) + '"></div>';
    }).join("");

    // Legend only for labels actually present, so it stays short.
    var seen = {};
    screenBand.forEach(function (s) { seen[s.label] = true; });
    legend.innerHTML = Object.keys(seen).map(function (l) {
      return '<span><i class="b-' + l + '"></i>' + (LABEL_TEXT[l] || l) + "</span>";
    }).join("");
  }

  function renderScrubber() {
    var dur = scrubDuration();
    var gaps = $("scrubGaps"), labels = $("scrubLabels");
    renderBand(dur);
    if (!dur) { gaps.innerHTML = ""; labels.innerHTML = ""; return; }

    // Gaps are drawn as zero-width joins: a paused stretch occupies no video
    // time, so we mark the seam rather than inventing space for it.
    var segs = (videoMeta && videoMeta.segments) || [];
    gaps.innerHTML = segs.slice(1).map(function (s) {
      var pct = Math.min(100, (s.videoOffsetStart / dur) * 100);
      return '<div class="gap" style="left:' + pct + '%;width:3px" title="recording resumed here"></div>';
    }).join("");

    var marks = currentEvents
      .map(function (e, i) { return { e:e, i:i }; })
      .filter(function (m) { return m.e.videoOffsetSeconds != null; })
      .map(function (m) {
        var pct = Math.min(100, (m.e.videoOffsetSeconds / dur) * 100);
        return '<div class="mark m-' + m.e.type + '" data-i="' + m.i + '" style="left:' + pct + '%"></div>';
      }).join("");
    gaps.insertAdjacentHTML("beforeend", marks);

    labels.innerHTML = [0, .25, .5, .75, 1].map(function (f) {
      return '<span style="left:' + (f * 100) + '%">' + mmss(dur * f) + "</span>";
    }).join("");

    Array.prototype.forEach.call(gaps.querySelectorAll(".mark"), function (el) {
      el.addEventListener("click", function (ev) {
        ev.stopPropagation();
        selectEvent(parseInt(el.dataset.i, 10));
      });
      el.addEventListener("mousemove", function (ev) {
        var e = currentEvents[parseInt(el.dataset.i, 10)];
        var tip = $("tip");
        tip.textContent = mmss(e.videoOffsetSeconds) + " · " +
          (LABEL[e.type] || e.type) + ": " + String(e.text || "").slice(0, 80);
        tip.style.display = "block";
        tip.style.left = Math.min(ev.clientX + 12, window.innerWidth - 360) + "px";
        tip.style.top = (ev.clientY - 34) + "px";
      });
      el.addEventListener("mouseleave", function () { $("tip").style.display = "none"; });
    });
  }

  function selectEvent(index) {
    var e = currentEvents[index];
    if (!e || e.videoOffsetSeconds == null) return;
    Array.prototype.forEach.call($("timeline").querySelectorAll(".row"), function (r) {
      r.classList.toggle("active", r.dataset.i === String(index));
    });
    var row = $("timeline").querySelector('.row[data-i="' + index + '"]');
    if (row) row.scrollIntoView({ block:"nearest", behavior:"smooth" });
    seekTo(e.videoOffsetSeconds, (LABEL[e.type] || e.type) + ": " + String(e.text || "").slice(0, 70));
  }

  function seekTo(offset, label) {
    var v = $("player");
    if (!v.src) { loadVideo(); }
    if (offset == null) return;
    try { v.currentTime = offset; v.play().catch(function(){}); } catch (err) {}
    $("nowPlaying").textContent = "▶ " + mmss(offset) + " — " + label;
  }

  $("player").addEventListener("timeupdate", function () {
    var dur = scrubDuration();
    if (!dur) return;
    $("playhead").style.left = Math.min(100, (this.currentTime / dur) * 100) + "%";
  });
  $("scrub").addEventListener("click", function (ev) {
    var dur = scrubDuration();
    if (!dur) return;
    var rect = this.getBoundingClientRect();
    seekTo(((ev.clientX - rect.left) / rect.width) * dur, "scrubbed");
  });

  // ---- timeline --------------------------------------------------------
  function renderTimeline(events, hasVideo) {
    currentEvents = events;
    if (!events.length) {
      $("timeline").innerHTML =
        '<div class="empty">Session created — no events yet. Start working with <code>claude</code>.</div>';
      return;
    }
    $("timeline").innerHTML = events.map(function (e, i) {
      var off = e.videoOffsetSeconds;
      var seekable = hasVideo && off != null;
      return '<div class="row' + (seekable ? " seekable" : "") + '" data-i="' + i + '">' +
        '<span class="time">' + hhmmss(e.at) + "</span>" +
        '<span class="vt' + (off == null ? " none" : "") + '">' + mmss(off) + "</span>" +
        '<span class="tag t-' + e.type + '">' + (LABEL[e.type] || e.type) + "</span>" +
        '<span class="text">' +
          (e.tool ? '<span class="tool-name">(' + esc(e.tool) + ") </span>" : "") +
          esc(e.text || "") + "</span></div>";
    }).join("");
    Array.prototype.forEach.call($("timeline").querySelectorAll(".row.seekable"), function (row) {
      row.addEventListener("click", function () { selectEvent(parseInt(row.dataset.i, 10)); });
    });
  }

  // ---- polling ---------------------------------------------------------
  async function load() {
    if (paused) return;
    var res = await fetch("./dev/data" + (selected ? "?sessionId=" + encodeURIComponent(selected) : ""));
    if (!res.ok) return;
    var data = await res.json();

    var sel = $("sessions");
    if (sel.options.length !== data.sessions.length) {
      sel.innerHTML = data.sessions.map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.candidateName || "unnamed") +
          " · " + s.eventCount + " events · " + new Date(s.createdAt).toLocaleTimeString() + "</option>";
      }).join("");
    }
    if (!data.current) {
      $("timeline").innerHTML =
        '<div class="empty">No capture sessions yet. Run <code>node capture-kit/setup.js --local</code>.</div>';
      $("stats").innerHTML = "";
      return;
    }
    sel.value = data.current.sessionId;
    selected = data.current.sessionId;
    token = data.current.captureToken || token;
    videoMeta = data.current.video || {};
    screenBand = data.current.screenBand || [];

    var st = data.current.stats || {};
    $("stats").innerHTML = [
      ["prompts", st.promptCount || 0], ["tool calls", st.toolUseCount || 0],
      ["events", st.totalEvents || 0], ["files", (data.current.files || []).length],
      ["video chunks", videoMeta.chunkCount || 0],
      ["segments", (videoMeta.segments || []).length]
    ].map(function (p) {
      return '<div class="stat"><b>' + p[1] + "</b><span>" + p[0] + "</span></div>";
    }).join("");

    if (!recorder) {
      var segs = videoMeta.segments || [];
      var ended = segs.filter(function (s) { return s.endReason && s.endReason !== "manual"; });
      $("videoStatus").textContent = videoMeta.chunkCount
        ? "Recording captured — " + videoMeta.chunkCount + " chunks across " +
          segs.length + " segment(s)."
        : "No recording yet.";
      if (ended.length && !recorder) {
        warn("A recording segment ended unexpectedly (" +
          ended[ended.length - 1].endReason.replace(/_/g, " ") +
          "). Earlier footage is kept — Resume recording to continue.");
      }
      if (segs.length) $("recBtn").textContent = "● Resume recording";
    }

    renderTimeline(data.current.events || [], !!videoMeta.chunkCount);
    renderScrubber();

    var files = data.current.files || [];
    $("files").innerHTML = files.length
      ? files.map(function (f) {
          return '<div class="file"><code>' + esc(f.path) + "</code>" +
            '<span class="time">' + f.sizeBytes + "b</span>" +
            '<span class="badge ' + (f.origin === "agent" ? "agent" : "snapshot") + '">' +
            (f.origin === "agent" ? "agent-written" : "hand-written / snapshot") + "</span></div>";
        }).join("")
      : '<div class="empty">No files captured yet.</div>';
  }

  // ---- wiring ----------------------------------------------------------
  $("sessions").addEventListener("change", function (e) { selected = e.target.value; load(); });
  $("pollToggle").addEventListener("click", function () {
    paused = !paused;
    this.textContent = paused ? "Resume" : "Pause";
    $("dot").className = "dot" + (paused ? " paused" : "");
    $("liveLabel").textContent = paused ? "paused" : "live";
    if (!paused) load();
  });
  $("recBtn").addEventListener("click", function () {
    if (recorder) stopRecording("manual"); else startRecording();
  });


  // Deterministic metrics: fetched alongside the poll, rendered compactly.
  async function loadMetrics() {
    if (!selected) return;
    try {
      var res = await fetch("./sessions/" + encodeURIComponent(selected) + "/analysis");
      if (!res.ok) return;
      var a = await res.json();
      var m = a.metrics;
      var pct = function (v) { return v == null ? "—" : Math.round(v * 100) + "%"; };
      var rows = [
        ["read : edit", m.readEditRatio == null ? "—" : m.readEditRatio + " : 1"],
        ["writes verified by a test", pct(m.verifiedWriteRatio)],
        ["low-effort prompts", pct(m.lowEffortPromptRatio)],
        ["median think time", m.medianThinkSeconds == null ? "—" : Math.round(m.medianThinkSeconds) + "s"],
        ["code from agent", pct(m.authorship.agentShare)],
        ["tokens in / out",
          m.tokens.measuredTurns
            ? m.tokens.input.toLocaleString() + " / " + m.tokens.output.toLocaleString() +
              " (" + m.tokens.cacheRead.toLocaleString() + " cached)"
            : "not captured for this session"],
      ];
      $("metrics").innerHTML = rows.map(function (r) {
        return '<div class="file"><code style="flex:1">' + r[0] + "</code><b>" + r[1] + "</b></div>";
      }).join("");
    } catch (e) { /* metrics are a nicety; never break the page */ }
  }
  $("dockToggle").addEventListener("click", function () {
    var body = $("dockBody");
    var hidden = body.style.display === "none";
    body.style.display = hidden ? "block" : "none";
    this.textContent = hidden ? "Hide" : "Show";
    document.body.style.paddingBottom = hidden ? "300px" : "56px";
  });

  load();
  setInterval(load, 2000);
  // Metrics change far more slowly than the event stream.
  setTimeout(loadMetrics, 1500);
  setInterval(loadMetrics, 10000);
})();
</script>
</body>
</html>`;
}
