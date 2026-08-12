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

  /* ---- video dock + scrubber ---- */
  #dock { position:fixed; left:0; right:0; bottom:0; background:var(--panel);
    border-top:1px solid var(--line); box-shadow:0 -6px 20px rgba(33,32,28,.07); padding:12px 20px; }
  .dockrow { display:flex; gap:16px; align-items:flex-start; }
  #dock video { width:340px; max-width:38vw; background:#000; border-radius:8px; display:block; }
  .dockinfo { flex:1; min-width:0; }
  .dockinfo h3 { margin:0 0 4px; font-size:12px; text-transform:uppercase;
    letter-spacing:.05em; color:var(--muted); }
  #videoStatus { font-size:13px; color:var(--muted); margin:0 0 8px; }
  #nowPlaying { font-size:13px; min-height:20px; }
  #dockToggle { position:absolute; right:20px; top:10px; }

  /* scrubber: the video's own duration, with one tick per captured event */
  #scrub { position:relative; height:44px; margin-top:10px; border-radius:8px;
    background:#f2f0e8; border:1px solid var(--line); cursor:pointer; overflow:hidden; }
  #scrubGaps { position:absolute; inset:0; }
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
  <div class="dockrow" id="dockBody">
    <video id="player" controls preload="metadata"></video>
    <div class="dockinfo">
      <h3>Recording</h3>
      <p id="videoStatus">No recording yet.</p>
      <div id="nowPlaying"></div>
      <div id="scrub">
        <div id="scrubGaps"></div>
        <div id="playhead" style="left:0"></div>
        <div id="scrubLabels"></div>
      </div>
    </div>
  </div>
</div>
<div id="tip"></div>
<script>
(function () {
  var paused = false, selected = null, token = null;
  var recorder = null, recStream = null, chunkCount = 0, lastChunkAt = 0;
  var currentEvents = [], videoMeta = null, videoDuration = 0;

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
      stream = await navigator.mediaDevices.getDisplayMedia({ video:{ frameRate:5 }, audio:false });
    } catch (e) { return; } // user dismissed the picker
    warn("");
    recStream = stream;

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
    // Ending the share from Chrome's own "Stop sharing" bar, or closing the
    // shared tab/window, ends the track. This is the most common cause.
    stream.getVideoTracks()[0].addEventListener("ended", function () {
      stopRecording("share_ended");
    });

    recorder.start(3000);
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
    }
    setTimeout(async function () {
      if (token) {
        await fetch("./video/stop", {
          method:"POST",
          headers:{ "Content-Type":"application/json", Authorization:"Bearer "+token },
          body: JSON.stringify({ reason: reason || "manual" })
        });
      }
      $("videoStatus").textContent = "Processing recording…";
      setTimeout(loadVideo, 900);
    }, 1200);
  }

  // A stalled upload means the recording is dead even though nothing errored.
  setInterval(function () {
    if (recorder && Date.now() - lastChunkAt > 15000) {
      stopRecording("upload_stalled");
    }
  }, 5000);

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

  function renderScrubber() {
    var dur = scrubDuration();
    var gaps = $("scrubGaps"), labels = $("scrubLabels");
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
  $("dockToggle").addEventListener("click", function () {
    var body = $("dockBody");
    var hidden = body.style.display === "none";
    body.style.display = hidden ? "flex" : "none";
    this.textContent = hidden ? "Hide" : "Show";
    document.body.style.paddingBottom = hidden ? "300px" : "56px";
  });

  load();
  setInterval(load, 2000);
})();
</script>
</body>
</html>`;
}
