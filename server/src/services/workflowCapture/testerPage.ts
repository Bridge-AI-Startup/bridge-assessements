/**
 * Dev-only capture lab.
 *
 * One page that shows, live, everything the platform records about a working
 * session AND everything it would infer from it: the raw hook stream with full
 * payloads, code state, the screen recording, the gradable timeline, and each
 * AI stage — screen classification, episodes, rubric grading with citation
 * validation, communication assessment, the voice agent's context bundle, and
 * the companion director's next question.
 *
 * You run the kit in your own terminal; this page is the instrument panel.
 * Never mounted in production (see routes/workflowCapture.ts) — it returns
 * capture tokens, raw prompts and code, and can spend money on model calls.
 */

import { TESTER_PAGE_SCRIPT } from "./testerPageScript.js";

const STYLES = `
  :root {
    --bg:#faf9f2; --panel:#fff; --ink:#21201c; --muted:#6b6862; --line:#e7e4da;
    --user:#1f6feb; --assist:#8250df; --tool:#9a6700; --agent:#1a7f37; --result:#57606a;
    --rec:#cf222e;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding-bottom:320px; }
  header { position:sticky; top:0; z-index:5; background:var(--panel);
    border-bottom:1px solid var(--line); padding:10px 20px;
    display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  h1 { font-size:15px; margin:0; font-weight:600; letter-spacing:-.01em; }
  h3 { font-size:13px; margin:14px 0 6px; }
  select,button,textarea,input { font:inherit; }
  select,button { padding:6px 10px; border:1px solid var(--line); border-radius:8px;
    background:#fff; color:var(--ink); cursor:pointer; }
  button:hover:not(:disabled) { background:#f6f5ef; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button.rec { background:var(--rec); border-color:var(--rec); color:#fff; }
  button.rec:hover:not(:disabled) { background:#a40e26; }
  button.mini { padding:4px 9px; font-size:12px; }
  label.auto { font-size:12px; color:var(--muted); display:flex; align-items:center; gap:5px; }
  .live { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); }
  .dot { width:8px; height:8px; border-radius:50%; background:#1a7f37; }
  .dot.paused { background:#9a6700; } .dot.dead { background:var(--rec); }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  .dot:not(.paused):not(.dead) { animation:pulse 1.6s ease-in-out infinite; }
  .grow { flex:1; }
  main { padding:18px 20px; max-width:1180px; margin:0 auto; }
  .warn { background:#fff8e6; border:1px solid #f0d68a; color:#7a5b00;
    border-radius:10px; padding:10px 14px; margin-bottom:14px; font-size:13px; display:none; }
  .stats { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px;
    padding:8px 12px; min-width:84px; }
  .stat b { display:block; font-size:18px; font-weight:600; }
  .stat span { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  #tabs { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
  .tab { border-radius:999px; font-size:13px; }
  .tab.on { background:var(--ink); color:#fff; border-color:var(--ink); }
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px;
    margin-bottom:16px; overflow:hidden; }
  section h2 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);
    margin:0; padding:11px 16px; border-bottom:1px solid var(--line); }
  section h2 .sub { text-transform:none; letter-spacing:0; }
  .pad { padding:12px 16px; }
  .pad + .pad { padding-top:0; }
  .hint { color:var(--muted); font-size:12px; margin:6px 0 0; }
  .pad > .mini + .hint, .pad > .hint { display:block; }
  .empty { padding:24px 16px; text-align:center; color:var(--muted); }
  .err { color:var(--rec); font-size:13px; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .cmd { display:flex; align-items:center; gap:10px; background:#f6f5ef;
    border:1px solid var(--line); border-radius:8px; padding:9px 12px; }
  .cmd code { flex:1; font-size:13px; }
  .kv { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:2px 18px; }
  .kv > div { display:flex; gap:10px; padding:4px 0; border-bottom:1px solid #f2f0e8; font-size:13px; }
  .kv span { color:var(--muted); min-width:170px; }
  .kv b { font-weight:500; word-break:break-word; }
  details { border-top:1px solid #f2f0e8; }
  summary { cursor:pointer; padding:7px 0; font-size:12px; color:var(--muted); }
  pre { background:#f6f5ef; border:1px solid var(--line); border-radius:8px; padding:10px;
    overflow:auto; max-height:420px; font-size:12px; margin:4px 0 10px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; word-break:break-word; }
  pre.filebody { max-height:600px; }
  textarea { width:100%; border:1px solid var(--line); border-radius:8px; padding:9px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; margin:4px 0 8px; }
  .lbl { display:block; margin-bottom:4px; font-size:11px; text-transform:uppercase;
    letter-spacing:.04em; color:var(--muted); }

  .row { display:flex; gap:10px; padding:8px 16px; border-bottom:1px solid #f2f0e8; align-items:flex-start; }
  .row:last-child { border-bottom:0; }
  .row.seekable { cursor:pointer; }
  .row.seekable:hover { background:#f6f5ef; }
  .time { color:var(--muted); font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; }
  .seq { color:#b9b5a8; font-size:11px; font-variant-numeric:tabular-nums; min-width:38px; }
  .vt { font-size:11px; color:var(--user); font-variant-numeric:tabular-nums;
    white-space:nowrap; min-width:44px; }
  .vt.none { color:#c9c5b8; }
  .tag { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
    white-space:nowrap; min-width:70px; }
  .t-user_prompt{color:var(--user)} .t-assistant_message{color:var(--assist)}
  .t-tool_use{color:var(--tool)} .t-screen_context{color:#1a9c8f}
  .t-tool_result,.t-session_start,.t-session_end,.t-notification{color:var(--result)}
  .a-ai_prompt{color:var(--user)} .a-ai_response{color:var(--assist)}
  .a-coding{color:var(--agent)} .a-testing{color:#1a9c8f} .a-reading{color:var(--result)}
  .a-searching{color:var(--tool)} .a-speaking{color:#cf6a22} .a-idle{color:#a8a396}
  .text { white-space:pre-wrap; word-break:break-word; flex:1; }
  .meta { display:block; color:var(--muted); font-size:11px; margin-top:2px; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; padding:3px 9px; border-radius:999px; }
  .chip.on { background:var(--ink); color:#fff; border-color:var(--ink); }
  .evi { display:flex; flex-direction:column; gap:4px; margin:6px 0; align-items:flex-start; }
  .evi-chip { text-align:left; white-space:normal; }

  .file { display:flex; gap:12px; align-items:center; padding:8px 16px;
    border-bottom:1px solid #f2f0e8; cursor:pointer; }
  .file:hover { background:#f6f5ef; }
  .file:last-child { border-bottom:0; }
  .file code { flex:1; font-size:13px; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); }
  .badge.agent { color:var(--agent); border-color:#b7e0c2; background:#f0fbf3; }
  .badge.snapshot { color:var(--muted); background:#f6f5ef; }
  .pill { font-size:11px; padding:3px 9px; border-radius:999px; border:1px solid var(--line);
    color:var(--muted); white-space:nowrap; }
  .pill-complete,.pill-supported { color:var(--agent); border-color:#b7e0c2; background:#f0fbf3; }
  .pill-running { color:var(--user); border-color:#bcd6fb; background:#f2f7ff; }
  .pill-missing,.pill-contradicted { color:var(--rec); border-color:#f0c0c4; background:#fff5f5; }
  .pill-stopped_early,.pill-sparse { color:#7a5b00; border-color:#f0d68a; background:#fff8e6; }
  .stagehead { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .metaline { font-size:11px; color:var(--muted); font-family:ui-monospace,Menlo,monospace; }

  .crit { padding:12px 16px; border-top:1px solid #f2f0e8; }
  .crit-head { display:flex; gap:10px; align-items:center; }
  .crit-verdict { margin:6px 0; font-size:13px; }
  .score { font-weight:600; font-size:15px; min-width:30px; text-align:center;
    border-radius:8px; padding:2px 6px; }
  .s-hi{color:var(--agent);background:#f0fbf3} .s-mid{color:#7a5b00;background:#fff8e6}
  .s-lo{color:var(--rec);background:#fff5f5}
  .quote { padding:6px 0; font-size:13px; border-bottom:1px solid #f2f0e8; }
  .claim { padding:6px 0; font-size:13px; border-bottom:1px solid #f2f0e8; }
  .verdict-speak { background:#f2f7ff; border:1px solid #bcd6fb; border-radius:8px;
    padding:10px 12px; margin:8px 0; font-size:14px; }
  .verdict-quiet { background:#f6f5ef; border:1px solid var(--line); border-radius:8px;
    padding:10px 12px; margin:8px 0; font-size:14px; }

  .ep { padding:10px 16px; border-bottom:1px solid #f2f0e8; cursor:pointer; }
  .ep:last-child { border-bottom:0; }
  .ep:hover { background:#f6f5ef; }
  .ep-head { display:flex; gap:10px; align-items:baseline; }
  .ep-idx { color:var(--muted); font-variant-numeric:tabular-nums; font-size:12px; min-width:22px; }
  .ep-label { font-weight:600; }
  .ep-kind { font-size:10px; text-transform:uppercase; letter-spacing:.05em;
    padding:2px 7px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
  .ep-time { margin-left:auto; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .ep-sum { color:var(--muted); font-size:13px; margin-top:3px; padding-left:32px; }
  .ep-evi { font-size:11px; color:#a8a396; padding-left:32px; margin-top:2px; }
  .k-debugging{color:#cf222e;border-color:#f0c0c4} .k-implementation{color:#1a7f37;border-color:#b7e0c2}
  .k-verification{color:#1f6feb;border-color:#bcd6fb} .k-research{color:#8250df;border-color:#d8c7f5}
  .k-planning{color:#9a6700;border-color:#f0d68a} .k-idle{color:#a8a396}

  .spanrow { display:flex; gap:10px; align-items:flex-start; padding:6px 0;
    border-bottom:1px solid #f2f0e8; font-size:13px; }
  .swatch { width:10px; height:10px; border-radius:2px; margin-top:5px; flex:none; }

  /* ---- video dock: the player sits directly ON TOP of the scrubber ---- */
  #dock { position:fixed; left:0; right:0; bottom:0; background:var(--panel);
    border-top:1px solid var(--line); box-shadow:0 -6px 20px rgba(33,32,28,.07);
    padding:10px 20px 12px; z-index:6; }
  .dockhead { display:flex; align-items:baseline; gap:12px; margin-bottom:8px; }
  .dockhead h3 { margin:0; font-size:12px; text-transform:uppercase;
    letter-spacing:.05em; color:var(--muted); }
  #videoStatus { font-size:12px; color:var(--muted); margin:0; }
  #nowPlaying { font-size:12px; margin-left:auto; color:var(--ink); }
  #stack { max-width:760px; margin:0 auto; }
  #dock video { width:100%; max-height:190px; background:#000; border-radius:8px 8px 0 0;
    display:block; object-fit:contain; }
  #dockToggle { position:absolute; right:20px; top:8px; }
  #scrub { position:relative; height:56px; border-radius:0 0 8px 8px;
    background:#f2f0e8; border:1px solid var(--line); border-top:0;
    cursor:pointer; overflow:hidden; }
  #scrubBand { position:absolute; left:0; right:0; top:0; height:16px; }
  .band { position:absolute; top:0; height:16px; }
  .band.redundant { opacity:.55; }
  .b-ide{background:#c9c5b8} .b-terminal{background:#9c968a} .b-cli_agent{background:#6f6a5e}
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
  .mark.m-tool_use{background:var(--tool)} .mark.m-screen_context{background:#1a9c8f}
  .mark.m-tool_result,.mark.m-session_start,.mark.m-session_end,.mark.m-notification{background:#b9b5a8}
  #playhead { position:absolute; top:0; bottom:0; width:2px; background:var(--ink);
    transform:translateX(-1px); pointer-events:none; }
  #scrubLabels { position:absolute; left:0; right:0; bottom:3px; height:14px;
    font-size:10px; color:var(--muted); pointer-events:none; }
  #scrubLabels span { position:absolute; transform:translateX(-50%); }
  #tip { position:fixed; z-index:20; background:var(--ink); color:#fff; font-size:12px;
    padding:5px 9px; border-radius:6px; pointer-events:none; display:none; max-width:340px; }
`;

export function renderTesterPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Capture Lab — workflow capture</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>Capture Lab</h1>
  <select id="sessions"></select>
  <span class="live"><span class="dot" id="dot"></span><span id="liveLabel">live</span></span>
  <span class="live" id="lastEvent"></span>
  <button id="pollToggle">Pause</button>
  <span class="grow"></span>
  <label class="auto"><input type="checkbox" id="autoDirector" /> auto-run director (30s)</label>
  <button id="pipelineBtn">▶ Run full pipeline</button>
  <button id="recBtn" class="rec">● Start screen recording</button>
  <span id="recInfo" class="live"></span>
</header>
<main>
  <div class="warn" id="warn"></div>
  <div class="stats" id="stats"></div>
  <div id="tabs"></div>
  <div id="body"></div>
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
<script>${TESTER_PAGE_SCRIPT}</script>
</body>
</html>`;
}
