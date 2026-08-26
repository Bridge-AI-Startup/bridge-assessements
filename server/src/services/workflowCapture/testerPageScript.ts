/**
 * Browser code for the capture lab (see testerPage.ts).
 *
 * Deliberately plain ES5-style JS in a plain string: it is injected into a
 * template literal, so no backticks and no ${...} may appear below.
 */
export const TESTER_PAGE_SCRIPT = `
(function () {
  // ---------------------------------------------------------------- state
  var S = {
    sessionId: null,
    token: null,
    paused: false,
    tab: "session",
    events: [],          // accumulated, oldest first
    maxSeq: -1,
    snap: null,          // last deterministic snapshot
    timeline: [],
    stageResults: {},    // stage -> payload
    stageVersions: {},   // stage -> version we already fetched
    filter: "all",
    openFile: null,
    fileBody: null,
    autoDirector: false,
    lastDirectorRun: 0,
    criteria: null,
    openDetails: {},   // JSON blocks the user expanded, kept open across repaints
  };
  var recorder = null, recStream = null, chunkCount = 0, lastChunkAt = 0;
  var videoDuration = 0;
  var STAGES = ["screen", "episodes", "evaluate", "communication", "agentContext", "director"];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function json(v) { try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); } }
  function hhmmss(iso) {
    try { return new Date(iso).toTimeString().slice(0, 8); } catch (e) { return "--:--:--"; }
  }
  function mmss(sec) {
    if (sec == null || isNaN(sec)) return "—";
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function ago(iso) {
    if (!iso) return "never";
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    return Math.round(s / 3600) + "h ago";
  }
  function bytes(n) {
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function pct(v) { return v == null ? "—" : Math.round(v * 100) + "%"; }
  function warn(msg) {
    var el = $("warn");
    if (!msg) { el.style.display = "none"; return; }
    el.innerHTML = msg; el.style.display = "block";
  }
  var LABEL = {
    session_start: "session", session_end: "end", user_prompt: "prompt",
    assistant_message: "reply", tool_use: "tool", tool_result: "result",
    notification: "note", screen_context: "screen"
  };
  var SCREEN_TEXT = {
    ide: "editor", terminal: "terminal", cli_agent: "CLI agent",
    "browser:search": "search", "browser:docs": "docs",
    "browser:ai_chat": "AI in browser", "browser:own_app": "their app",
    other: "other", idle: "idle"
  };

  // ---------------------------------------------------------------- polling
  async function poll() {
    if (S.paused) return;
    var url = "./dev/data";
    var q = [];
    if (S.sessionId) q.push("sessionId=" + encodeURIComponent(S.sessionId));
    if (S.sessionId && S.maxSeq >= 0) q.push("sinceSeq=" + S.maxSeq);
    if (q.length) url += "?" + q.join("&");
    var res;
    try { res = await fetch(url); } catch (e) { setLive(false, "server unreachable"); return; }
    if (!res.ok) { setLive(false, "poll failed (" + res.status + ")"); return; }
    setLive(true, null);
    var data = await res.json();
    renderSessionPicker(data.sessions);
    if (!data.current) { S.snap = null; renderEmpty(); return; }

    if (S.sessionId !== data.current.sessionId) {
      // Switching sessions resets everything the page had accumulated.
      S.sessionId = data.current.sessionId;
      S.events = []; S.maxSeq = -1; S.timeline = [];
      S.stageResults = {}; S.stageVersions = {}; S.openFile = null; S.criteria = null;
    }
    S.snap = data.current;
    S.token = data.current.captureToken || S.token;
    if (data.current.events && data.current.events.length) {
      S.events = S.events.concat(data.current.events);
    }
    if (typeof data.current.maxSeq === "number") S.maxSeq = data.current.maxSeq;

    syncStages();
    renderHeader();
    renderTab();
    renderScrubber();
    maybeAutoDirector();
  }

  function setLive(ok, msg) {
    $("dot").className = "dot" + (S.paused ? " paused" : ok ? "" : " dead");
    $("liveLabel").textContent = S.paused ? "paused" : ok ? "live" : (msg || "offline");
  }

  /** Fetch the payload of any stage whose version moved since we last looked. */
  function syncStages() {
    var stages = (S.snap && S.snap.stages) || {};
    STAGES.forEach(function (k) {
      var st = stages[k];
      if (!st) return;
      if (st.status === "done" && st.version !== S.stageVersions[k]) {
        S.stageVersions[k] = st.version;
        fetch("./dev/stage/" + k + "?sessionId=" + encodeURIComponent(S.sessionId))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (payload) {
            if (payload) { S.stageResults[k] = payload.result; renderTab(); }
          })
          .catch(function () {});
      }
    });
  }

  async function loadTimeline() {
    if (!S.sessionId) return;
    try {
      var r = await fetch("./dev/data?sessionId=" + encodeURIComponent(S.sessionId) +
        "&sinceSeq=999999999&timeline=1");
      if (!r.ok) return;
      var d = await r.json();
      S.timeline = (d.current && d.current.timeline) || [];
      if (S.tab === "timeline") renderTab();
    } catch (e) {}
  }

  async function runStage(stage) {
    if (!S.sessionId) return;
    var body = { sessionId: S.sessionId };
    if (stage === "evaluate") body.criteria = criteriaFromBox();
    try {
      await fetch("./dev/run/" + stage, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (e) {}
    poll();
  }

  function stageStatus(stage) {
    var stages = (S.snap && S.snap.stages) || {};
    return stages[stage] || { status: "idle", version: 0 };
  }

  function waitForStage(stage) {
    return new Promise(function (resolve) {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var st = stageStatus(stage);
        if (st.status === "done" || st.status === "error" || tries > 400) {
          clearInterval(iv); resolve(st);
        }
      }, 1000);
    });
  }

  /** The order the real pipeline runs in: screen first, so episodes can see it. */
  async function runPipeline() {
    var btn = $("pipelineBtn");
    btn.disabled = true;
    var order = ["screen", "episodes", "evaluate", "communication", "agentContext", "director"];
    for (var i = 0; i < order.length; i++) {
      var stage = order[i];
      if (stage === "screen" && !(S.snap && S.snap.config.geminiConfigured)) continue;
      btn.textContent = "Running " + stage + "… (" + (i + 1) + "/" + order.length + ")";
      await runStage(stage);
      await new Promise(function (r) { setTimeout(r, 600); });
      await waitForStage(stage);
    }
    btn.disabled = false;
    btn.textContent = "▶ Run full pipeline";
  }

  /**
   * The director runs every 30s against a live session in production, so the
   * lab can too — that cadence is the thing being tested, not a nicety.
   */
  function maybeAutoDirector() {
    if (!S.autoDirector || !S.sessionId) return;
    if (Date.now() - S.lastDirectorRun < 30000) return;
    if (stageStatus("director").status === "running") return;
    S.lastDirectorRun = Date.now();
    runStage("director");
  }

  // ---------------------------------------------------------------- header
  function renderSessionPicker(sessions) {
    var sel = $("sessions");
    var sig = sessions.map(function (s) { return s.id + ":" + s.eventCount; }).join(",");
    if (sel.dataset.sig === sig) { if (S.sessionId) sel.value = S.sessionId; return; }
    sel.dataset.sig = sig;
    sel.innerHTML = sessions.map(function (s) {
      return '<option value="' + s.id + '">' +
        esc(s.candidateName || "unnamed") + " · " + s.eventCount + " events · " +
        (s.linked ? "linked" : "local") + " · " +
        new Date(s.createdAt).toLocaleTimeString() + "</option>";
    }).join("");
    if (S.sessionId) sel.value = S.sessionId;
  }

  function renderEmpty() {
    $("body").innerHTML = '<section><h2>No capture sessions yet</h2>' +
      '<div class="empty">Run the setup command below in any scratch git repo, then work with ' +
      '<code>claude</code>. Everything you do lands here within two seconds.</div>' +
      cmdBlock() + "</section>";
  }

  function cmdBlock() {
    return '<div class="cmd"><code id="cmdText">node capture-kit/setup.js --local</code>' +
      '<button class="mini" onclick="window.__copyCmd()">Copy</button></div>' +
      '<p class="hint">Run it from the repo you want captured (the kit lives in this ' +
      'project at <code>capture-kit/</code>). It asks for typed consent, writes ' +
      '<code>.claude/settings.json</code> hooks, and starts streaming.</p>';
  }
  window.__copyCmd = function () {
    navigator.clipboard.writeText("node capture-kit/setup.js --local").catch(function () {});
  };

  function renderHeader() {
    var s = S.snap; if (!s) return;
    var v = s.video || {};
    var tiles = [
      ["prompts", s.stats.promptCount || 0],
      ["tool calls", s.stats.toolUseCount || 0],
      ["events", s.counts.events || 0],
      ["files", s.counts.files || 0],
      ["screen spans", s.counts.screenContext || 0],
      ["voice lines", s.counts.voiceUtterances || 0],
      ["video chunks", v.chunkCount || 0],
      ["recorded", mmss(v.totalRecordedSeconds)]
    ];
    $("stats").innerHTML = tiles.map(function (t) {
      return '<div class="stat"><b>' + t[1] + "</b><span>" + t[0] + "</span></div>";
    }).join("");
    $("lastEvent").textContent = "last event " + ago(s.session.lastEventAt);

    if (!recorder) {
      var segs = v.segments || [];
      var ended = segs.filter(function (x) { return x.endReason && x.endReason !== "manual"; });
      $("videoStatus").textContent = v.chunkCount
        ? v.chunkCount + " chunks · " + segs.length + " segment(s) · " + bytes(v.chunkBytes)
        : "No recording yet.";
      if (ended.length) {
        warn("A recording segment ended unexpectedly (" +
          esc(ended[ended.length - 1].endReason).replace(/_/g, " ") +
          "). Earlier footage is kept — hit Resume recording to continue.");
      }
      if (segs.length) $("recBtn").textContent = "● Resume recording";
    }
  }

  // ---------------------------------------------------------------- tabs
  var TABS = [
    ["session", "Session"],
    ["stream", "Raw stream"],
    ["timeline", "Timeline"],
    ["code", "Code"],
    ["pipeline", "AI pipeline"],
    ["recording", "Recording"]
  ];
  function renderTabBar() {
    $("tabs").innerHTML = TABS.map(function (t) {
      return '<button class="tab' + (S.tab === t[0] ? " on" : "") +
        '" data-tab="' + t[0] + '">' + t[1] + "</button>";
    }).join("");
    Array.prototype.forEach.call($("tabs").querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () {
        S.tab = b.dataset.tab;
        renderTabBar(); renderTab();
        if (S.tab === "timeline" && !S.timeline.length) loadTimeline();
      });
    });
  }
  function renderTab() {
    if (!S.snap) { renderEmpty(); return; }
    // Never repaint over someone typing — a 2s poll that eats a half-written
    // criterion makes the box unusable.
    var ae = document.activeElement;
    if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT") && $("body").contains(ae)) {
      if (ae.id === "criteriaBox") S.criteria = ae.value;
      return;
    }
    if (S.tab === "session") renderSessionTab();
    else if (S.tab === "stream") renderStreamTab();
    else if (S.tab === "timeline") renderTimelineTab();
    else if (S.tab === "code") renderCodeTab();
    else if (S.tab === "pipeline") renderPipelineTab();
    else if (S.tab === "recording") renderRecordingTab();
    restoreDetails();
  }

  /**
   * JSON blocks stay open across repaints. Without this, reading a 30KB context
   * bundle is a race against the next poll, which closes it again.
   */
  function restoreDetails() {
    Array.prototype.forEach.call($("body").querySelectorAll("details[data-k]"), function (d) {
      if (S.openDetails[d.dataset.k]) d.open = true;
      d.addEventListener("toggle", function () {
        S.openDetails[d.dataset.k] = d.open;
      });
    });
  }

  function kv(rows) {
    return '<div class="kv">' + rows.map(function (r) {
      return "<div><span>" + esc(r[0]) + "</span><b>" + (r[2] ? r[1] : esc(r[1])) + "</b></div>";
    }).join("") + "</div>";
  }
  function details(title, obj) {
    return '<details data-k="' + esc(title) + '"><summary>' + esc(title) +
      "</summary><pre>" + esc(json(obj)) + "</pre></details>";
  }

  // ---------------------------------------------------------------- session tab
  function renderSessionTab() {
    var s = S.snap, ses = s.session, ci = s.captureIntegrity, cfg = s.config;
    var env = ses.environment || {};
    var html = "";

    html += '<section><h2>Run it</h2><div class="pad">' + cmdBlock() +
      '<p class="hint">Then click <b>● Start screen recording</b> in the header. Every ' +
      'prompt, tool call, file write, and screen span below is exactly what a real ' +
      'candidate produces — this page runs the same code paths the grading pipeline does.</p>' +
      "</div></section>";

    html += '<section><h2>Session record</h2><div class="pad">' + kv([
      ["session id", s.sessionId],
      ["status", ses.status],
      ["source", ses.source],
      ["candidate", ses.candidateName || "—"],
      ["consent", ses.consent && ses.consent.granted
        ? "granted " + hhmmss(ses.consent.grantedAt) + " (v" + (ses.consent.disclosureVersion || "?") + ")"
        : "not granted"],
      ["started", ses.startedAt ? new Date(ses.startedAt).toLocaleString() : "—"],
      ["last event", ago(ses.lastEventAt)],
      ["completed", ses.completedAt ? new Date(ses.completedAt).toLocaleString() : "—"],
      ["cwd", env.cwd || "—"],
      ["git branch", env.gitBranch || "—"],
      ["git remote", env.gitRemote || "—"],
      ["tool version", env.toolVersion || "—"],
      ["platform", env.platform || "—"],
      ["payload stored", bytes(s.stats.payloadBytes || 0)]
    ]) + "</div></section>";

    html += '<section><h2>Capture integrity <span class="sub">— is the record complete?</span></h2>' +
      '<div class="pad"><div class="badge-row"><span class="pill pill-' + esc(ci.status) + '">' +
      esc(ci.status.replace(/_/g, " ")) + "</span></div><p>" + esc(ci.note) + "</p>" +
      kv([
        ["events captured", String(ci.eventCount)],
        ["prompts", String(ci.promptCount)],
        ["captured span", ci.capturedSeconds == null ? "—" : mmss(ci.capturedSeconds)],
        ["silent before submit", ci.silentBeforeSubmitSeconds == null ? "—" : mmss(ci.silentBeforeSubmitSeconds)]
      ]) + "</div></section>";

    html += '<section><h2>What this session is attached to</h2><div class="pad">';
    if (s.submission) {
      html += kv([
        ["submission", s.submission.id],
        ["assessment", s.submission.assessmentTitle || "—"],
        ["evidence mode", s.submission.evidenceMode || "—"],
        ["status", s.submission.status],
        ["criteria", String((s.submission.criteria || []).length)],
        ["evaluation status", s.submission.evaluationStatus || "—"]
      ]);
    } else {
      html += '<div class="empty">Local session — no submission behind it. Grading uses the ' +
        "lab's default criteria, and voice/proctoring stages report what they would need.</div>";
    }
    if (s.proctoring) {
      html += "<h3>Proctoring session</h3>" + kv([
        ["status", s.proctoring.status],
        ["consent", s.proctoring.consentGranted ? "granted" : "no"],
        ["frames", String(s.proctoring.frames)],
        ["sidecar events", String(s.proctoring.sidecarEvents)],
        ["transcript", s.proctoring.transcriptStatus],
        ["merged video", s.proctoring.mergedVideo],
        ["companion", s.proctoring.companionStatus]
      ]);
      if (s.proctoring.currentBriefing) {
        html += details("Pending director briefing", s.proctoring.currentBriefing);
      }
      if ((s.proctoring.briefingHistory || []).length) {
        html += details("Director briefing history", s.proctoring.briefingHistory);
      }
    }
    html += "</div></section>";

    html += '<section><h2>Environment for the AI stages</h2><div class="pad">' + kv([
      ["GEMINI_API_KEY", cfg.geminiConfigured ? "set — screen classification available" : "missing — screen classification disabled"],
      ["ANTHROPIC_API_KEY", cfg.anthropicConfigured ? "set" : "missing"],
      ["COMPANION_DIRECTOR_ENABLED", cfg.directorEnabled ? "true" : "false (the lab can still run it by hand)"],
      ["director model", cfg.directorModel]
    ]) + "</div></section>";

    html += '<section><h2>Raw documents</h2><div class="pad">' +
      details("Capture session document", s.session) +
      details("Stats", s.stats) +
      details("Video document", s.video) +
      "</div></section>";

    $("body").innerHTML = html;
  }

  // ---------------------------------------------------------------- stream tab
  function renderStreamTab() {
    var types = {};
    S.events.forEach(function (e) { types[e.type] = (types[e.type] || 0) + 1; });
    var chips = ['<button class="chip' + (S.filter === "all" ? " on" : "") +
      '" data-f="all">all · ' + S.events.length + "</button>"];
    Object.keys(types).sort().forEach(function (t) {
      chips.push('<button class="chip' + (S.filter === t ? " on" : "") +
        '" data-f="' + t + '">' + (LABEL[t] || t) + " · " + types[t] + "</button>");
    });

    var rows = S.events
      .map(function (e, i) { return { e: e, i: i }; })
      .filter(function (m) { return S.filter === "all" || m.e.type === S.filter; });

    var html = '<section><h2>Raw hook stream <span class="sub">— every event exactly as stored</span></h2>' +
      '<div class="pad chips">' + chips.join("") + "</div>" +
      (rows.length ? rows.map(function (m) { return eventRow(m.e, m.i); }).join("")
        : '<div class="empty">No events yet. Run the setup command and prompt <code>claude</code>.</div>') +
      "</section>";
    $("body").innerHTML = html;

    Array.prototype.forEach.call($("body").querySelectorAll(".chip"), function (c) {
      c.addEventListener("click", function () { S.filter = c.dataset.f; renderTab(); });
    });
    Array.prototype.forEach.call($("body").querySelectorAll(".row.seekable"), function (r) {
      r.addEventListener("click", function (ev) {
        if (ev.target.tagName === "SUMMARY" || ev.target.tagName === "PRE") return;
        selectEvent(parseInt(r.dataset.i, 10));
      });
    });
  }

  function eventRow(e, i) {
    var off = e.videoOffsetSeconds;
    var extra = [];
    if (e.tool) extra.push("tool=" + e.tool);
    if (e.gitBranch) extra.push("branch=" + e.gitBranch);
    if (e.truncated) extra.push("TRUNCATED");
    var body = e.type === "screen_context" && e.payload
      ? (SCREEN_TEXT[e.payload.label] || e.payload.label) +
        (e.payload.detail ? " — " + e.payload.detail : "") +
        (e.payload.redundant ? "  [redundant: excluded from grading]" : "")
      : (e.text || "");
    return '<div class="row' + (off != null ? " seekable" : "") + '" data-i="' + i + '">' +
      '<span class="time">' + hhmmss(e.at) + "</span>" +
      '<span class="seq">#' + e.seq + "</span>" +
      '<span class="vt' + (off == null ? " none" : "") + '">' + mmss(off) + "</span>" +
      '<span class="tag t-' + e.type + '">' + (LABEL[e.type] || e.type) + "</span>" +
      '<span class="text">' + esc(String(body).slice(0, 4000)) +
        (extra.length ? '<span class="meta">' + esc(extra.join(" · ")) + "</span>" : "") +
        (e.payload ? "<details><summary>payload</summary><pre>" + esc(json(e.payload)) + "</pre></details>" : "") +
      "</span></div>";
  }

  // ---------------------------------------------------------------- timeline tab
  function renderTimelineTab() {
    var html = '<section><h2>Gradable timeline <span class="sub">— the TranscriptEvent[] the evaluator reads</span></h2>' +
      '<div class="pad"><button class="mini" id="reloadTimeline">Rebuild</button> ' +
      '<span class="hint">Hook events, voice lines and screen spans, merged and ' +
      'classified into the action vocabulary grading understands. Timestamps are ' +
      'session-relative seconds.</span></div>';
    if (!S.timeline.length) {
      html += '<div class="empty">Nothing built yet — click Rebuild.</div>';
    } else {
      html += S.timeline.map(function (t, i) {
        return '<div class="row' + (t.videoOffsetSeconds != null ? " seekable" : "") +
          '" data-vo="' + (t.videoOffsetSeconds == null ? "" : t.videoOffsetSeconds) + '">' +
          '<span class="time">' + mmss(t.ts) + "</span>" +
          '<span class="vt' + (t.videoOffsetSeconds == null ? " none" : "") + '">' +
            mmss(t.videoOffsetSeconds) + "</span>" +
          '<span class="tag a-' + esc(t.action_type) + '">' + esc(t.action_type) + "</span>" +
          '<span class="text">' + esc(t.description) +
            (t.prompt_text ? '<span class="meta">prompt: ' + esc(String(t.prompt_text).slice(0, 200)) + "</span>" : "") +
          "</span></div>";
      }).join("");
    }
    html += "</section>";

    var voice = (S.snap && S.snap.voice) || [];
    html += '<section><h2>Voice companion transcript</h2>' +
      (voice.length
        ? voice.map(function (v) {
            return '<div class="row"><span class="time">' + hhmmss(v.at) + "</span>" +
              '<span class="tag t-' + (v.role === "candidate" ? "user_prompt" : "assistant_message") +
              '">' + esc(v.role) + '</span><span class="text">' + esc(v.text) + "</span></div>";
          }).join("")
        : '<div class="empty">No voice transcript. The in-session companion runs against a ' +
          "proctoring session, which a local capture session does not have.</div>") +
      "</section>";
    $("body").innerHTML = html;

    var btn = $("reloadTimeline");
    if (btn) btn.addEventListener("click", loadTimeline);
    Array.prototype.forEach.call($("body").querySelectorAll(".row.seekable"), function (r) {
      r.addEventListener("click", function () {
        var vo = parseFloat(r.dataset.vo);
        if (!isNaN(vo)) seekTo(vo, "timeline");
      });
    });
  }

  // ---------------------------------------------------------------- code tab
  function renderCodeTab() {
    var files = (S.snap && S.snap.files) || [];
    var html = '<section><h2>Code state <span class="sub">— what the agent wrote, and what the snapshot found</span></h2>' +
      (files.length
        ? files.map(function (f) {
            return '<div class="file" data-path="' + esc(f.path) + '">' +
              "<code>" + esc(f.path) + "</code>" +
              '<span class="time">rev ' + (f.revision || 1) + " · " + bytes(f.sizeBytes) + "</span>" +
              '<span class="badge ' + (f.origin === "agent" ? "agent" : "snapshot") + '">' +
              (f.origin === "agent" ? "agent-written" : "hand-written / snapshot") + "</span>" +
              (f.truncated ? '<span class="badge">truncated</span>' : "") + "</div>";
          }).join("")
        : '<div class="empty">No files captured yet. A Write/Edit by the agent, or the ' +
          "kit's snapshot scan, puts them here.</div>") +
      "</section>";
    if (S.openFile && S.fileBody) {
      html += '<section><h2>' + esc(S.openFile) + "</h2><pre class=\\"filebody\\">" +
        esc(S.fileBody.content || "") + "</pre></section>";
    }
    $("body").innerHTML = html;
    Array.prototype.forEach.call($("body").querySelectorAll(".file"), function (el) {
      el.addEventListener("click", function () {
        S.openFile = el.dataset.path;
        fetch("./dev/file?sessionId=" + encodeURIComponent(S.sessionId) +
          "&path=" + encodeURIComponent(S.openFile))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (b) { S.fileBody = b; renderTab(); })
          .catch(function () {});
      });
    });
  }

  // ---------------------------------------------------------------- pipeline tab
  function stageCard(key, title, sub, bodyHtml, opts) {
    var st = stageStatus(key);
    var cfg = (S.snap && S.snap.config) || {};
    var disabled = key === "screen" && !cfg.geminiConfigured;
    var status = st.status === "running"
      ? '<span class="pill pill-running">running… ' +
        Math.round((Date.now() - new Date(st.startedAt).getTime()) / 1000) + "s</span>"
      : st.status === "done"
        ? '<span class="pill pill-complete">done in ' + (st.durationMs / 1000).toFixed(1) + "s</span>"
        : st.status === "error"
          ? '<span class="pill pill-missing">failed</span>'
          : '<span class="pill">not run</span>';
    return '<section class="stage"><h2>' + esc(title) +
      (sub ? ' <span class="sub">— ' + esc(sub) + "</span>" : "") + "</h2>" +
      '<div class="pad stagehead">' + status +
      (opts && opts.noRun ? "" :
        '<button class="mini run" data-stage="' + key + '"' + (disabled ? " disabled" : "") + ">" +
        (st.status === "done" ? "Re-run" : "Run") + "</button>") +
      (st.meta ? '<span class="metaline">' + esc(metaLine(st.meta)) + "</span>" : "") +
      "</div>" +
      (st.error ? '<div class="pad err">' + esc(st.error) + "</div>" : "") +
      bodyHtml + "</section>";
  }
  function metaLine(meta) {
    return Object.keys(meta).map(function (k) {
      var v = meta[k];
      return k + "=" + (v == null ? "—" : String(v).slice(0, 80));
    }).join("  ·  ");
  }

  function renderPipelineTab() {
    var s = S.snap;
    var html = '<section><h2>Deterministic metrics <span class="sub">— counted, never judged; no model call</span></h2>' +
      metricsHtml(s.metrics) + "</section>";

    // Screen classification
    var screenBody = "";
    var band = s.screenBand || [];
    if (band.length) {
      screenBody = '<div class="pad">' + band.slice(0, 200).map(function (b) {
        return '<div class="spanrow"><span class="swatch b-' + esc(b.label) + '"></span>' +
          "<b>" + esc(SCREEN_TEXT[b.label] || b.label) + "</b>" +
          '<span class="time">' + mmss(b.start) + " – " + mmss(b.end) + "</span>" +
          '<span class="text">' + esc(b.detail || "") +
          (b.redundant ? '<span class="meta">redundant — kept for coverage, excluded from grading evidence</span>' : "") +
          (b.concurrentWithAgent ? '<span class="meta">while the agent was working</span>' : "") +
          "</span></div>";
      }).join("") + "</div>";
    } else {
      screenBody = '<div class="empty">' +
        (s.config.geminiConfigured
          ? "No screen spans yet. Record something, stop the recording, then run this — Gemini reads the movie at 1fps and says what surface was visible."
          : "GEMINI_API_KEY is not set, so screen classification cannot run here.") + "</div>";
    }
    if (S.snap.submission) {
      screenBody += '<div class="pad"><p class="hint">This session is linked to a submission, ' +
        "so running this classifies the proctoring recording — the full movie at 1fps, which " +
        "costs real Gemini tokens and replaces the existing screen spans.</p></div>";
    }
    if (S.stageResults.screen) {
      screenBody += '<div class="pad">' + details("Classification result", S.stageResults.screen) + "</div>";
    }
    html += stageCard("screen", "Screen classification", "Gemini over the recording, LOW / 1fps", screenBody);

    // Episodes
    var eps = (s.episodes || []);
    var epBody = eps.length
      ? eps.map(function (e) {
          return '<div class="ep" data-start="' + e.startSeconds + '">' +
            '<div class="ep-head"><span class="ep-idx">' + e.index + "</span>" +
            '<span class="ep-label">' + esc(e.label) + "</span>" +
            '<span class="ep-kind k-' + esc(e.kind) + '">' + esc(e.kind) + "</span>" +
            '<span class="ep-time">' + mmss(e.startSeconds) + " – " + mmss(e.endSeconds) + "</span></div>" +
            '<div class="ep-sum">' + esc(e.summary) + "</div>" +
            '<div class="ep-evi">built from ' + (e.evidenceIndices || []).length + " captured event(s)</div>" +
            "</div>";
        }).join("")
      : '<div class="empty">No episodes yet. They need a handful of events, and in production ' +
        "are computed once when capture ends.</div>";
    html += stageCard("episodes", "Episodes", "the chapters an LLM turns the raw stream into", epBody);

    // Evaluation
    html += evaluationCard();

    // Communication
    var comm = S.stageResults.communication;
    var commBody = comm ? communicationHtml(comm) :
      '<div class="empty">Judges spoken reasoning against what the timeline shows they did. ' +
      "Needs the in-session voice companion, so a local session reports why it cannot run.</div>";
    html += stageCard("communication", "Communication assessment",
      "spoken reasoning, never part of any score", commBody);

    // Agent context
    var ac = S.stageResults.agentContext;
    var acBody = ac
      ? '<div class="pad">' + kv([
          ["bundle size", bytes(ac.bytes)],
          ["source", ac.synthetic ? "built from this capture session (no submission linked)" : "the real context center"],
          ["sections", Object.keys(ac.bundle || {}).join(", ")]
        ]) + details("Full bundle the voice agent would receive", ac.bundle) + "</div>"
      : '<div class="empty">The budgeted bundle the live interviewer polls — assessment, ' +
        "timeline, episodes, metrics, code, conversation.</div>";
    html += stageCard("agentContext", "Voice agent context bundle",
      "what get_candidate_context returns", acBody);

    // Director
    var dir = S.stageResults.director;
    var dirBody = dir ? directorHtml(dir) :
      '<div class="empty">The interviewer\\'s brain: reads everything above and decides whether ' +
      "to ask something right now, and what. Runs every 30s against a live session.</div>";
    html += stageCard("director", "Companion director decision",
      "what the interviewer would ask right now", dirBody);

    $("body").innerHTML = html;

    Array.prototype.forEach.call($("body").querySelectorAll(".run"), function (b) {
      b.addEventListener("click", function () { runStage(b.dataset.stage); });
    });
    Array.prototype.forEach.call($("body").querySelectorAll(".ep"), function (row) {
      row.addEventListener("click", function () { seekSessionSecond(Number(row.dataset.start), "episode"); });
    });
    var save = $("saveCriteria");
    if (save) save.addEventListener("click", function () { runStage("evaluate"); });
    var box = $("criteriaBox");
    if (box) box.addEventListener("input", function () { S.criteria = box.value; });
  }

  function metricsHtml(m) {
    if (!m) return '<div class="empty">—</div>';
    var rows = [
      ["prompts / replies / tool calls", m.prompts + " / " + m.assistantReplies + " / " + m.toolCalls],
      ["reads / writes / test runs", m.reads + " / " + m.writes + " / " + m.testRuns],
      ["read : edit", m.readEditRatio == null ? "—" : m.readEditRatio + " : 1"],
      ["writes verified by a test", pct(m.verifiedWriteRatio)],
      ["low-effort prompts", pct(m.lowEffortPromptRatio)],
      ["median think time", m.medianThinkSeconds == null ? "—" : Math.round(m.medianThinkSeconds) + "s"],
      ["time to first prompt", m.timeToFirstPromptSeconds == null ? "—" : mmss(m.timeToFirstPromptSeconds)],
      ["active / longest gap", mmss(m.activeSeconds) + " / " + mmss(m.longestGapSeconds)],
      ["code authored by agent", pct(m.authorship.agentShare) + " (" + m.authorship.agentFiles +
        " agent / " + m.authorship.humanFiles + " human files)"],
      ["tokens in / out / cached", m.tokens.measuredTurns
        ? m.tokens.input.toLocaleString() + " / " + m.tokens.output.toLocaleString() +
          " / " + m.tokens.cacheRead.toLocaleString() + " over " + m.tokens.measuredTurns + " turns"
        : "not reported by this tool"]
    ];
    return kv(rows);
  }

  function criteriaFromBox() {
    var box = $("criteriaBox");
    if (!box) return undefined;
    return box.value.split("\\n").map(function (l) { return l.trim(); }).filter(Boolean);
  }

  function evaluationCard() {
    var s = S.snap;
    var defaults = (s.submission && s.submission.criteria && s.submission.criteria.length)
      ? s.submission.criteria
      : s.defaultCriteria;
    if (S.criteria == null) S.criteria = defaults.join("\\n");
    var ev = S.stageResults.evaluate;
    var body = '<div class="pad"><label class="lbl">Criteria — one per line</label>' +
      '<textarea id="criteriaBox" rows="' + Math.max(4, defaults.length + 1) + '">' +
      esc(S.criteria) + "</textarea>" +
      '<button class="mini" id="saveCriteria">Grade against these</button>' +
      '<span class="hint">Runs validate → ground → retrieve → evaluate per criterion, ' +
      "plus the session summary, citation validation and capture integrity — the same " +
      "path a real submission takes.</span></div>";
    if (ev) body += evaluationHtml(ev);
    return stageCard("evaluate", "Rubric evaluation", "grounder → evaluator → citation validation", body);
  }

  function evaluationHtml(ev) {
    var report = ev.report || {};
    var html = '<div class="pad">' + kv([
      ["criteria source", ev.criteriaSource],
      ["timeline events graded", String(ev.timelineEvents)],
      ["preprocessing / grading", (ev.timings.preprocessingMs / 1000).toFixed(1) + "s / " +
        (ev.timings.gradingMs / 1000).toFixed(1) + "s"],
      ["citations kept / dropped", ev.citationsKept + " / " + ev.citationsDropped],
      ["criteria invalidated by citation checks",
        ev.invalidatedCriteria.length ? ev.invalidatedCriteria.join("; ") : "none"]
    ]) + "</div>";

    html += '<div class="pad"><h3>Session summary</h3><p>' + esc(report.session_summary || "—") + "</p></div>";

    (report.criteria_results || []).forEach(function (r, i) {
      var g = (ev.groundings || [])[i];
      var v = (ev.validations || [])[i];
      html += '<div class="crit"><div class="crit-head">' +
        '<span class="score s-' + (r.score >= 7 ? "hi" : r.score >= 4 ? "mid" : "lo") + '">' +
        (r.evaluable ? r.score : "n/a") + "</span>" +
        "<b>" + esc(r.criterion) + "</b>" +
        '<span class="ep-kind">' + esc(r.confidence) + " confidence</span></div>" +
        '<p class="crit-verdict">' + esc(r.verdict) + "</p>";
      if ((r.evidence || []).length) {
        html += '<div class="evi">' + r.evidence.map(function (e) {
          return '<button class="chip evi-chip" data-ts="' + e.ts + '">' + mmss(e.ts) + " · " +
            esc(String(e.observation).slice(0, 120)) + "</button>";
        }).join("") + "</div>";
      }
      if (v && !v.valid) {
        html += '<p class="hint">not evaluable: ' + esc(v.reason || "") + "</p>";
      }
      if (g) html += details("Grounded definition (what the judge was told to look for)", g);
      html += "</div>";
    });

    if (report.communication) html += communicationHtml(report.communication);
    if (report.evidenceIntegrity) {
      html += '<div class="pad">' + details("Evidence integrity + capture integrity", report.evidenceIntegrity) + "</div>";
    }
    if (report.workflowMetrics) {
      html += '<div class="pad">' + details("Metrics stored with the report", report.workflowMetrics) + "</div>";
    }
    return html;
  }

  function communicationHtml(c) {
    if (!c.available) {
      return '<div class="pad"><span class="pill">unavailable</span> ' +
        esc(c.reason || "") + (c.note ? '<p class="hint">' + esc(c.note) + "</p>" : "") + "</div>";
    }
    var html = '<div class="pad">' + kv([
      ["clarity", (c.clarity == null ? "—" : c.clarity + " / 10")],
      ["utterances / words", c.utteranceCount + " / " + c.wordCount]
    ]) + "<p>" + esc(c.summary || "") + "</p>";
    (c.highlights || []).forEach(function (h) {
      html += '<div class="quote"><span class="time">' + mmss(h.ts) + '</span> “' +
        esc(h.quote) + '” <span class="meta">' + esc(h.whyItMatters) + "</span></div>";
    });
    (c.claimChecks || []).forEach(function (k) {
      html += '<div class="claim"><span class="pill pill-' + esc(k.verdict) + '">' +
        esc(k.verdict) + "</span> " + esc(k.claim) +
        '<span class="meta">' + esc(k.note) + "</span></div>";
    });
    return html + "</div>";
  }

  function directorHtml(d) {
    var dec = d.decision;
    var html = '<div class="pad">' + kv([
      ["model", d.model],
      ["context sent", bytes(d.userMessageBytes)],
      ["source", d.synthetic ? "built from this capture session" : "the real context center"],
      ["persisted", "no — the lab never publishes a briefing to a live agent"]
    ]);
    if (!dec) {
      html += '<div class="empty">The model returned nothing parseable.</div>';
    } else if (dec.shouldSpeak) {
      html += '<div class="verdict-speak"><b>Would ask:</b> “' + esc(dec.question) + "”" +
        '<span class="meta">anchor: ' + esc(dec.anchorSummary || "—") + " · " + esc(dec.reason) + "</span></div>";
    } else {
      html += '<div class="verdict-quiet"><b>Would stay quiet.</b><span class="meta">' +
        esc(dec.reason) + "</span></div>";
    }
    html += details("Exact context sent to the director", safeParse(d.userMessage)) +
      details("Director system prompt", d.systemPrompt) + "</div>";
    return html;
  }
  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return s; } }

  // ---------------------------------------------------------------- recording tab
  function renderRecordingTab() {
    var v = (S.snap && S.snap.video) || {};
    var html = "";
    if (S.snap && S.snap.submission && !v.chunkCount) {
      // A linked both-mode attempt records through proctoring, and the kit recorder
      // is refused on that mode — so an empty dock here is correct, not broken.
      html += '<section><h2>Where the footage for this session lives</h2><div class="empty">' +
        "This session belongs to a submission, so the screen was recorded by proctoring " +
        "(merged playback.webm), not by this page. The lab plays kit recordings only — " +
        "start one here to get a playable dock, or review the real one in the employer " +
        "dashboard.</div></section>";
    }
    html += '<section><h2>Screen recording</h2><div class="pad">' + kv([
      ["status", v.status],
      ["started / ended", (v.startedAt ? hhmmss(v.startedAt) : "—") + " / " + (v.endedAt ? hhmmss(v.endedAt) : "—")],
      ["chunks", v.chunkCount + " (" + bytes(v.chunkBytes) + ")"],
      ["merged file", v.mergedKey ? v.mergedKey + " · " + bytes(v.mergedSizeBytes) : "built on first playback"],
      ["total recorded", mmss(v.totalRecordedSeconds)],
      ["error", v.error || "—"]
    ]) + '<p class="hint">The recording is not transcribed or OCR\\'d — that is the whole cost ' +
      "saving of the hooks approach. It exists so a human can watch a moment the timeline points " +
      "at, and so Gemini can identify which surface was visible.</p></div>";

    html += "<h3 class=\\"pad\\">Segments</h3>";
    html += (v.segments || []).length
      ? (v.segments || []).map(function (s, i) {
          return '<div class="row"><span class="seq">#' + (i + 1) + "</span>" +
            '<span class="time">' + hhmmss(s.wallStartedAt) + " → " +
            (s.wallEndedAt ? hhmmss(s.wallEndedAt) : "open") + "</span>" +
            '<span class="vt">' + mmss(s.videoOffsetStart) + "</span>" +
            '<span class="text">ended: ' + esc(s.endReason || "—") + "</span></div>";
        }).join("")
      : '<div class="empty">No segments — nothing recorded yet.</div>';
    html += "</section>";
    $("body").innerHTML = html;
  }

  // ---------------------------------------------------------------- recording
  async function startRecording() {
    if (!S.token) { warn("No capture session yet — run the setup command first."); return; }
    var stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
        // A tab or window share dies the moment that surface goes away, which is
        // the usual cause of a recording "randomly" stopping.
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "exclude"
      });
    } catch (e) { return; }
    warn("");
    recStream = stream;
    var track = stream.getVideoTracks()[0];
    var surface = (track.getSettings && track.getSettings().displaySurface) || "unknown";
    if (surface === "browser" || surface === "window") {
      warn("You are sharing a " + surface + ". That share ends as soon as that " +
        (surface === "browser" ? "tab navigates or closes" : "window closes") +
        " — sharing your Entire Screen is much more reliable.");
    }

    var r = await fetch("./video/start", { method: "POST", headers: { Authorization: "Bearer " + S.token } });
    var info = await r.json().catch(function () { return {}; });

    var mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9" : "video/webm";
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1000000 });
    lastChunkAt = Date.now();
    recorder.ondataavailable = async function (e) {
      if (!e.data || !e.data.size) return;
      var fd = new FormData();
      fd.append("chunk", e.data, "chunk.webm");
      try {
        await fetch("./video/chunk", { method: "POST",
          headers: { Authorization: "Bearer " + S.token }, body: fd });
        chunkCount++; lastChunkAt = Date.now();
        $("recInfo").textContent = chunkCount + " chunk(s) uploaded";
      } catch (err) { /* one failed chunk must not stop the recording */ }
    };
    recorder.onerror = function (e) {
      stopRecording("recorder_error: " + ((e && e.error && e.error.name) || "unknown"));
    };
    var lastInteractionAt = Date.now();
    ["click", "keydown", "pointerdown"].forEach(function (evt) {
      window.addEventListener(evt, function () { lastInteractionAt = Date.now(); }, true);
    });
    var muteEvents = 0;
    track.addEventListener("mute", function () { muteEvents++; });
    track.addEventListener("unmute", function () { muteEvents--; });
    track.addEventListener("ended", function () {
      var diag = ["surface=" + surface, "readyState=" + track.readyState,
        "muted=" + track.muted, "muteEvents=" + muteEvents,
        "page=" + document.visibilityState,
        "sinceClick=" + Math.round((Date.now() - lastInteractionAt) / 1000) + "s"].join(" ");
      stopRecording("share_ended (" + diag + ")");
    });

    recorder.start(3000);
    document.title = "● Recording — Capture Lab";
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
      warn("Recording stopped: " + esc(reason).replace(/_/g, " ") +
        ". Earlier footage is kept — click Resume recording to continue.");
      document.title = "⏹ RECORDING STOPPED — Capture Lab";
      if (window.Notification && Notification.permission === "granted") {
        try {
          new Notification("Capture lab", {
            body: "Screen recording stopped (" + reason.replace(/_/g, " ") + ")."
          });
        } catch (e) {}
      }
    }
    setTimeout(async function () {
      if (S.token) {
        await fetch("./video/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + S.token },
          body: JSON.stringify({ reason: reason || "manual" })
        });
      }
      $("videoStatus").textContent = "Processing recording — classifying screen, grouping episodes…";
      setTimeout(loadVideo, 1200);
    }, 1200);
  }

  // A stalled upload means the recording is dead though nothing errored. Judged
  // only while visible: Chrome throttles timers on hidden tabs, so a short
  // threshold there would kill healthy recordings.
  setInterval(function () {
    if (!recorder) return;
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastChunkAt > 45000) stopRecording("upload_stalled");
  }, 5000);
  window.addEventListener("beforeunload", function (e) {
    if (!recorder) return;
    e.preventDefault(); e.returnValue = "";
  });

  function loadVideo() {
    if (!S.sessionId) return;
    var v = $("player");
    v.src = "./sessions/" + encodeURIComponent(S.sessionId) + "/video?t=" + Date.now();
    v.load();
    v.onloadedmetadata = function () {
      videoDuration = isFinite(v.duration) ? v.duration : 0;
      renderScrubber();
    };
    v.onerror = function () { /* no recording yet */ };
  }

  // ---------------------------------------------------------------- scrubber
  function scrubDuration() {
    return videoDuration || (S.snap && S.snap.video && S.snap.video.totalRecordedSeconds) || 0;
  }
  function renderScrubber() {
    var dur = scrubDuration();
    var band = $("scrubBand"), legend = $("bandLegend"),
        gaps = $("scrubGaps"), labels = $("scrubLabels");
    var spans = (S.snap && S.snap.screenBand) || [];
    if (!dur) { band.innerHTML = ""; gaps.innerHTML = ""; labels.innerHTML = ""; return; }

    band.innerHTML = spans.map(function (s) {
      var left = Math.max(0, Math.min(100, (s.start / dur) * 100));
      var width = Math.max(0.4, Math.min(100 - left, ((s.end - s.start) / dur) * 100));
      return '<div class="band b-' + s.label + (s.redundant ? " redundant" : "") +
        '" style="left:' + left + "%;width:" + width + '%" title="' +
        esc((SCREEN_TEXT[s.label] || s.label) + (s.detail ? " — " + s.detail : "")) + '"></div>';
    }).join("");
    var seen = {};
    spans.forEach(function (s) { seen[s.label] = true; });
    legend.innerHTML = Object.keys(seen).length
      ? Object.keys(seen).map(function (l) {
          return '<span><i class="b-' + l + '"></i>' + (SCREEN_TEXT[l] || l) + "</span>";
        }).join("")
      : "<span>No screen classification yet.</span>";

    var segs = (S.snap && S.snap.video && S.snap.video.segments) || [];
    gaps.innerHTML = segs.slice(1).map(function (s) {
      var p = Math.min(100, (s.videoOffsetStart / dur) * 100);
      return '<div class="gap" style="left:' + p + '%;width:3px" title="recording resumed here"></div>';
    }).join("");
    gaps.insertAdjacentHTML("beforeend", S.events.map(function (e, i) {
      if (e.videoOffsetSeconds == null) return "";
      var p = Math.min(100, (e.videoOffsetSeconds / dur) * 100);
      return '<div class="mark m-' + e.type + '" data-i="' + i + '" style="left:' + p + '%"></div>';
    }).join(""));
    labels.innerHTML = [0, .25, .5, .75, 1].map(function (f) {
      return '<span style="left:' + (f * 100) + '%">' + mmss(dur * f) + "</span>";
    }).join("");

    Array.prototype.forEach.call(gaps.querySelectorAll(".mark"), function (el) {
      el.addEventListener("click", function (ev) {
        ev.stopPropagation(); selectEvent(parseInt(el.dataset.i, 10));
      });
      el.addEventListener("mousemove", function (ev) {
        var e = S.events[parseInt(el.dataset.i, 10)];
        var tip = $("tip");
        tip.textContent = mmss(e.videoOffsetSeconds) + " · " + (LABEL[e.type] || e.type) +
          ": " + String(e.text || "").slice(0, 80);
        tip.style.display = "block";
        tip.style.left = Math.min(ev.clientX + 12, window.innerWidth - 360) + "px";
        tip.style.top = (ev.clientY - 34) + "px";
      });
      el.addEventListener("mouseleave", function () { $("tip").style.display = "none"; });
    });
  }

  function selectEvent(index) {
    var e = S.events[index];
    if (!e || e.videoOffsetSeconds == null) return;
    seekTo(e.videoOffsetSeconds, (LABEL[e.type] || e.type) + ": " + String(e.text || "").slice(0, 70));
  }
  /** Session-relative second → position in the merged recording. */
  function seekSessionSecond(sec, label) {
    var segs = (S.snap && S.snap.video && S.snap.video.segments) || [];
    var startedAt = S.snap && S.snap.session && S.snap.session.startedAt;
    if (!segs.length || !startedAt) return;
    var wall = new Date(startedAt).getTime() + sec * 1000;
    for (var i = 0; i < segs.length; i++) {
      var a = new Date(segs[i].wallStartedAt).getTime();
      var b = segs[i].wallEndedAt ? new Date(segs[i].wallEndedAt).getTime() : Infinity;
      if (wall >= a && wall <= b) {
        seekTo(segs[i].videoOffsetStart + (wall - a) / 1000, label);
        return;
      }
    }
  }
  function seekTo(offset, label) {
    var v = $("player");
    if (!v.src) loadVideo();
    if (offset == null) return;
    try { v.currentTime = offset; v.play().catch(function () {}); } catch (err) {}
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

  // ---------------------------------------------------------------- wiring
  $("sessions").addEventListener("change", function (e) {
    S.sessionId = e.target.value;
    S.events = []; S.maxSeq = -1; S.timeline = [];
    S.stageResults = {}; S.stageVersions = {}; S.criteria = null;
    poll();
  });
  $("pollToggle").addEventListener("click", function () {
    S.paused = !S.paused;
    this.textContent = S.paused ? "Resume" : "Pause";
    setLive(true, null);
    if (!S.paused) poll();
  });
  $("recBtn").addEventListener("click", function () {
    if (recorder) stopRecording("manual"); else startRecording();
  });
  $("pipelineBtn").addEventListener("click", runPipeline);
  $("autoDirector").addEventListener("change", function () {
    S.autoDirector = this.checked;
    if (this.checked) { S.lastDirectorRun = 0; maybeAutoDirector(); }
  });
  $("dockToggle").addEventListener("click", function () {
    var body = $("dockBody");
    var hidden = body.style.display === "none";
    body.style.display = hidden ? "block" : "none";
    this.textContent = hidden ? "Hide" : "Show";
    document.body.style.paddingBottom = hidden ? "320px" : "64px";
  });

  renderTabBar();
  poll();
  setInterval(poll, 2000);
  // Stage cards show a running clock; repaint the pipeline tab a little faster.
  setInterval(function () {
    if (S.tab !== "pipeline" || S.paused) return;
    var running = STAGES.some(function (k) { return stageStatus(k).status === "running"; });
    if (running) renderTab();
  }, 1000);
})();
`;
