/**
 * Seed the "perfect demo" submission: a fully-populated, review-ready
 * Standup Board submission under each owner account, with every Review-dialog
 * surface lit — a 30-minute merged screen recording, workflow-capture
 * timeline + persisted episodes, companion voice transcript, evaluation
 * report (rubric + communication), behavioral grading report with artifacts,
 * a real uploaded code archive, and a finalized/verified runtime setup.
 *
 * All dummy data, but internally consistent: metrics, behavioral score, and
 * capture integrity are computed by the real production functions over the
 * fabricated event stream.
 *
 * Prereqs:
 *   - Run seedDemoAssessments.ts first (creates "Standup Board — Team Task
 *     Tracker" under both owner accounts).
 *   - A stitched demo video at server/storage/demo/standup-board-playback.webm
 *     (override with DEMO_VIDEO_PATH). ~30 minutes, webm.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedPerfectDemoSubmission.ts
 *
 * Owners (override with OWNER_EMAILS=comma,separated):
 *   saaz.m@icloud.com, demo@bridgeai-demo.com
 *
 * Idempotent: deletes and recreates the demo candidate's submission (and its
 * proctoring/workflow sessions, events, blobs) on every run.
 */
import "../config/loadEnv.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import UserModel from "../models/user.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import ProctoringSessionModel from "../models/proctoringSession.js";
import {
  WorkflowCaptureSessionModel,
  WorkflowEventModel,
  WorkflowFileStateModel,
} from "../models/workflowCapture.js";
import { getFrameStorage } from "../services/capture/storage.js";
import { getGradingEvidenceStorage } from "../services/gradingEvidence/storage.js";
import { getSubmissionCodeStorage } from "../services/submissionCode/storage.js";
import { computeMetrics } from "../services/workflowCapture/metrics.js";
import { computeBehavioralScore } from "../services/behavioralGrading/scoring.js";
import { assessCaptureIntegrity } from "../services/workflowCapture/evaluate.js";
import { getShareLinkBaseUrl } from "../utils/shareLink.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
const DEMO_DIR = path.join(REPO_ROOT, "demos/standup-board-demo");
const VIDEO_PATH =
  process.env.DEMO_VIDEO_PATH ||
  path.join(SERVER_ROOT, "storage/demo/standup-board-playback.webm");

const ASSESSMENT_TITLE = "Standup Board — Team Task Tracker";
const CANDIDATE_NAME = "Jordan Avery";
const CANDIDATE_EMAIL = "jordan.avery@demo.bridge-jobs.com";
const OWNER_EMAILS = (
  process.env.OWNER_EMAILS || "saaz.m@icloud.com,demo@bridgeai-demo.com"
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const DURATION_SECONDS = 1800; // 30-minute session
// Session ran "yesterday" so it reads as fresh but finished.
const T0 = (() => {
  const d = new Date(Date.now() - 26 * 3600 * 1000);
  d.setMinutes(4, 0, 0);
  return d;
})();
const at = (t: number) => new Date(T0.getTime() + t * 1000);
const SUBMITTED_AT = at(DURATION_SECONDS);

/* ------------------------------------------------------------------ */
/* The captured session, as the hooks + screen classifier saw it       */
/* ------------------------------------------------------------------ */

type Ev = {
  t: number;
  type: string;
  toolName?: string;
  text?: string;
  payload?: Record<string, unknown>;
};

const usage = (input: number, output: number, cacheRead: number) => ({
  usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead },
});

const HOOK_EVENTS: Ev[] = [
  { t: 0, type: "session_start", text: "claude-code session started in ~/standup-board" },

  // --- read everything before touching anything -----------------------
  { t: 8, type: "tool_use", toolName: "Read", text: "README.md" },
  { t: 42, type: "tool_use", toolName: "Read", text: "server.js" },
  { t: 68, type: "tool_use", toolName: "Read", text: "public/index.html" },
  { t: 84, type: "tool_use", toolName: "Read", text: "public/app.js" },
  { t: 100, type: "tool_use", toolName: "Bash", text: "npm install" },
  { t: 112, type: "tool_result", toolName: "Bash", text: "added 68 packages in 2s" },

  // --- plan first ------------------------------------------------------
  {
    t: 125,
    type: "user_prompt",
    text:
      "Read README.md before answering. I want to build this one rule at a time, not in one shot. Break it into ordered steps: task store + POST/GET first, then the WIP limit (max 3 in doing, 409 doing_full), then the blocked rule (409 blocked), then the owner filter (exact match), then persistence across restart. For each step tell me how we'll verify it before moving on. Don't write code yet.",
  },
  {
    t: 152,
    type: "assistant_message",
    text:
      "Plan: 1) in-memory task store + POST /api/tasks + GET /api/tasks, verified with curl. 2) Wire the page's add flow and list rendering, verified in the browser. 3) WIP limit server-side with a 409 doing_full, verified by moving four tasks. 4) 'Doing is full' surfaced in the page. 5) Blocked rule (409 blocked until unblocked). 6) Owner filter with exact match. 7) Persist to data/tasks.json and prove it with a real restart. I'll add a small node:test suite so each rule keeps a regression check.",
    payload: usage(12400, 610, 0),
  },

  // --- store + create/list API ----------------------------------------
  {
    t: 175,
    type: "user_prompt",
    text:
      "Do step 1: the task store and POST/GET /api/tasks exactly per the README — title required (400 without it), optional owner, optional client ref (generate one when absent), new tasks start in todo unblocked. 201 with the task. Then start the server and curl both endpoints so we see it working.",
  },
  { t: 186, type: "tool_use", toolName: "Read", text: "server.js" },
  { t: 214, type: "tool_use", toolName: "Write", text: "server.js" },
  { t: 238, type: "tool_use", toolName: "Bash", text: "npm start" },
  { t: 243, type: "tool_result", toolName: "Bash", text: "standup-board listening on http://0.0.0.0:3000" },
  {
    t: 258,
    type: "tool_use",
    toolName: "Bash",
    text:
      "curl -s -X POST http://localhost:3000/api/tasks -H 'Content-Type: application/json' -d '{\"title\":\"wire the store\",\"owner\":\"jordan\"}'",
  },
  {
    t: 262,
    type: "tool_result",
    toolName: "Bash",
    text: '201 {"ref":"1f9b2c","title":"wire the store","owner":"jordan","status":"todo","blocked":false}',
  },
  { t: 274, type: "tool_use", toolName: "Bash", text: "curl -s http://localhost:3000/api/tasks" },
  { t: 278, type: "tool_result", toolName: "Bash", text: '{"tasks":[{"ref":"1f9b2c","title":"wire the store","owner":"jordan","status":"todo"}]}' },
  {
    t: 292,
    type: "assistant_message",
    text:
      "Store and both endpoints are in. POST validates the title (400 on blank), generates a ref when the client doesn't send one, and GET returns { tasks: [...] }. Both curls above show it live.",
    payload: usage(18900, 1840, 11200),
  },

  // --- page add flow ----------------------------------------------------
  {
    t: 302,
    type: "user_prompt",
    text:
      "Step 2: wire public/app.js to the API. Keep the exact UI contract — placeholders 'Task title' and 'Owner', 'Add task' button, tasks as <li> rows with Start on todo rows and Finish on doing rows, board updates without a refresh. Also add a node:test file covering health, title validation, and create+list, and run it.",
  },
  { t: 312, type: "tool_use", toolName: "Read", text: "public/app.js" },
  { t: 342, type: "tool_use", toolName: "Edit", text: "public/app.js" },
  { t: 362, type: "tool_use", toolName: "Edit", text: "public/index.html" },
  { t: 386, type: "tool_use", toolName: "Write", text: "tests/board.test.js" },
  { t: 396, type: "tool_use", toolName: "Bash", text: "npm test" },
  { t: 404, type: "tool_result", toolName: "Bash", text: "# tests 3\n# pass 3\n# fail 0" },
  {
    t: 440,
    type: "assistant_message",
    text:
      "Page is wired: the add form POSTs and re-renders the columns, Start/Finish buttons PATCH by ref. Three tests pass. Try adding a task in the browser — it should appear in Todo without a refresh.",
    payload: usage(26800, 2620, 24600),
  },

  // --- WIP limit --------------------------------------------------------
  {
    t: 452,
    type: "user_prompt",
    text:
      "Step 3: the WIP limit. Doing holds at most 3 — the server must refuse the fourth move with 409 {\"error\":\"doing_full\"}. Enforce it in the PATCH handler, not the UI. Then prove it: create four tasks and move them all to doing, I want to see the fourth get refused.",
  },
  { t: 474, type: "tool_use", toolName: "Edit", text: "server.js" },
  {
    t: 500,
    type: "tool_use",
    toolName: "Bash",
    text:
      "for r in w1 w2 w3 w4; do curl -s -X POST http://localhost:3000/api/tasks -d \"{\\\"title\\\":\\\"$r\\\",\\\"ref\\\":\\\"$r\\\"}\" -H 'Content-Type: application/json' >/dev/null; curl -s -o /dev/null -w \"$r -> %{http_code}\\n\" -X PATCH http://localhost:3000/api/tasks/ref/$r -d '{\"status\":\"doing\"}' -H 'Content-Type: application/json'; done",
  },
  { t: 505, type: "tool_result", toolName: "Bash", text: 'w1 -> 200\nw2 -> 200\nw3 -> 200\nw4 -> 409 {"error":"doing_full"}' },
  {
    t: 524,
    type: "assistant_message",
    text: "WIP limit enforced server-side: the fourth move got 409 doing_full while the first three succeeded.",
    payload: usage(33500, 1470, 31200),
  },
  {
    t: 538,
    type: "user_prompt",
    text:
      "Step 4: when the server refuses a move, the page has to show exactly 'Doing is full'. Catch the 409 in app.js and render that message, and clear it on the next successful action.",
  },
  { t: 562, type: "tool_use", toolName: "Edit", text: "public/app.js" },
  {
    t: 598,
    type: "screen_context",
    text: "Standup Board — Start clicked on four tasks; Doing is full appears",
    payload: {
      source: "screen", label: "browser:own_app",
      detail: "Standup Board — Start clicked on four tasks; Doing is full appears",
      confidence: 0.94, mode: "gap", concurrentWithAgent: false, redundant: false,
      videoStart: 598, videoEnd: 638, durationSeconds: 40, windowStart: 580, windowEnd: 660,
    },
  },
  { t: 652, type: "tool_use", toolName: "Bash", text: "npm test" },
  { t: 660, type: "tool_result", toolName: "Bash", text: "# tests 4\n# pass 4\n# fail 0" },
  {
    t: 676,
    type: "assistant_message",
    text: "The refusal now surfaces as 'Doing is full' in the page and a WIP-limit test case keeps it covered.",
    payload: usage(39200, 980, 36800),
  },

  // --- blocked rule -----------------------------------------------------
  {
    t: 722,
    type: "user_prompt",
    text:
      "Step 5: the blocked rule. A blocked task cannot move to done — 409 {\"error\":\"blocked\"} until it's unblocked. PATCH accepts blocked and blockedReason. Show the blocked state on the row, then run the whole sequence against the live server: create, move to doing, block, try done (should 409), unblock, done.",
  },
  { t: 752, type: "tool_use", toolName: "Edit", text: "server.js" },
  {
    t: 790,
    type: "tool_use",
    toolName: "Bash",
    text:
      "curl -s -X PATCH http://localhost:3000/api/tasks/ref/w1 -d '{\"blocked\":true,\"blockedReason\":\"waiting on keys\"}' -H 'Content-Type: application/json' && curl -s -w ' %{http_code}' -X PATCH http://localhost:3000/api/tasks/ref/w1 -d '{\"status\":\"done\"}' -H 'Content-Type: application/json'",
  },
  { t: 795, type: "tool_result", toolName: "Bash", text: '{"error":"blocked"} 409 — then after unblock: {"ref":"w1","status":"done"} 200' },
  {
    t: 812,
    type: "assistant_message",
    text: "Blocked rule holds: done is refused with 409 blocked while the flag is set, and succeeds right after unblocking. Rows show a (blocked: reason) tag.",
    payload: usage(46800, 1690, 44100),
  },
  {
    t: 848,
    type: "screen_context",
    text: "Standup Board — blocked task refuses Finish, unblock then Finish succeeds",
    payload: {
      source: "screen", label: "browser:own_app",
      detail: "Standup Board — blocked task refuses Finish, unblock then Finish succeeds",
      confidence: 0.92, mode: "gap", concurrentWithAgent: false, redundant: false,
      videoStart: 848, videoEnd: 882, durationSeconds: 34, windowStart: 830, windowEnd: 900,
    },
  },
  { t: 884, type: "tool_use", toolName: "Bash", text: "npm test" },
  { t: 892, type: "tool_result", toolName: "Bash", text: "# tests 5\n# pass 5\n# fail 0" },

  // --- owner filter + the hand fix -------------------------------------
  {
    t: 958,
    type: "user_prompt",
    text: "Step 6: the owner filter. GET /api/tasks?owner=<owner> returns only that owner's tasks. README says exact match.",
  },
  { t: 976, type: "tool_use", toolName: "Edit", text: "server.js" },
  {
    t: 996,
    type: "assistant_message",
    text: "Owner filter added to GET /api/tasks — when ?owner= is present the list is filtered to that owner before responding.",
    payload: usage(52100, 1210, 49500),
  },
  {
    t: 1100,
    type: "user_prompt",
    text:
      "Add a test that ?owner=sam does not also return samantha's tasks — I want the exact-match rule pinned. Run the suite.",
  },
  { t: 1112, type: "tool_use", toolName: "Write", text: "tests/board.test.js" },
  { t: 1118, type: "tool_use", toolName: "Bash", text: "npm test" },
  { t: 1126, type: "tool_result", toolName: "Bash", text: "# tests 6\n# pass 6\n# fail 0 (owner filter exact-match case added)" },
  {
    t: 1132,
    type: "assistant_message",
    text:
      "Added the sam-vs-samantha case — the filter compares with strict equality, so it passes: six tests green.",
    payload: usage(57400, 380, 54800),
  },

  // --- persistence ------------------------------------------------------
  {
    t: 1188,
    type: "user_prompt",
    text:
      "Step 7: persistence. Write the task list to data/tasks.json on every change and load it on boot — tasks must survive a restart. Then actually restart the server and show me the list coming back.",
  },
  { t: 1212, type: "tool_use", toolName: "Edit", text: "server.js" },
  { t: 1252, type: "tool_use", toolName: "Bash", text: "kill %1; npm start" },
  { t: 1257, type: "tool_result", toolName: "Bash", text: "standup-board listening on http://0.0.0.0:3000" },
  { t: 1274, type: "tool_use", toolName: "Bash", text: "curl -s http://localhost:3000/api/tasks" },
  { t: 1279, type: "tool_result", toolName: "Bash", text: '{"tasks":[... 6 tasks, statuses preserved after restart ...]}' },
  {
    t: 1298,
    type: "assistant_message",
    text: "Persistence is in: every mutation writes data/tasks.json, boot loads it, and the list above came back intact after a real restart.",
    payload: usage(64200, 1520, 61200),
  },

  // --- the sticky banner bug -------------------------------------------
  {
    t: 1382,
    type: "screen_context",
    text: "Standup Board — Doing is full banner still visible after freeing a slot",
    payload: {
      source: "screen", label: "browser:own_app",
      detail: "Standup Board — Doing is full banner still visible after freeing a slot",
      confidence: 0.91, mode: "gap", concurrentWithAgent: false, redundant: false,
      videoStart: 1382, videoEnd: 1412, durationSeconds: 30, windowStart: 1360, windowEnd: 1430,
    },
  },
  {
    t: 1436,
    type: "user_prompt",
    text:
      "Found a bug clicking around: after a refused move, 'Doing is full' stays on screen even once I finish a task and free a slot. Clear the message on the next successful add or move — and add a timeout fallback so it never sticks around stale.",
  },
  { t: 1466, type: "tool_use", toolName: "Edit", text: "public/app.js" },
  {
    t: 1502,
    type: "screen_context",
    text: "Standup Board — banner clears after the next successful move",
    payload: {
      source: "screen", label: "browser:own_app",
      detail: "Standup Board — banner clears after the next successful move",
      confidence: 0.93, mode: "gap", concurrentWithAgent: false, redundant: false,
      videoStart: 1502, videoEnd: 1530, durationSeconds: 28, windowStart: 1480, windowEnd: 1550,
    },
  },
  {
    t: 1540,
    type: "assistant_message",
    text: "Good catch — the message now clears on any successful action and auto-expires after four seconds as a fallback.",
    payload: usage(71800, 940, 68900),
  },

  // --- final sweep ------------------------------------------------------
  {
    t: 1576,
    type: "user_prompt",
    text:
      "Last thing before I submit: run the full test suite, then a curl sweep of every rule in one pass against a freshly restarted server — health, create with and without title, the owner filter with sam vs samantha, the blocked sequence, the WIP limit, and the restart persistence. Print each result.",
  },
  { t: 1596, type: "tool_use", toolName: "Bash", text: "npm test" },
  { t: 1604, type: "tool_result", toolName: "Bash", text: "# tests 6\n# pass 6\n# fail 0" },
  {
    t: 1620,
    type: "tool_use",
    toolName: "Bash",
    text: "./scripts-sweep: health, POST valid/blank, GET ?owner=sam, blocked sequence, wip x4, restart + GET",
  },
  {
    t: 1626,
    type: "tool_result",
    toolName: "Bash",
    text:
      "health 200 {\"ok\":true} | create 201 / blank 400 | owner=sam -> only sam | blocked 409 then done 200 | 4th doing 409 doing_full | restart: 6 tasks back",
  },
  {
    t: 1656,
    type: "assistant_message",
    text:
      "Everything in the contract passes: health, create/validate, exact owner filter, blocked rule, WIP limit, and persistence across a restart. Six unit tests green on top. Ready to submit.",
    payload: usage(80900, 720, 77600),
  },
  { t: 1704, type: "tool_use", toolName: "Read", text: "server.js" },
  {
    t: 1756,
    type: "screen_context",
    text: "Standup Board — final click-through of every rule, then the submit flow",
    payload: {
      source: "screen", label: "browser:own_app",
      detail: "Standup Board — final click-through of every rule, then the submit flow",
      confidence: 0.95, mode: "gap", concurrentWithAgent: false, redundant: false,
      videoStart: 1756, videoEnd: 1780, durationSeconds: 24, windowStart: 1745, windowEnd: 1790,
    },
  },
  { t: 1786, type: "session_end", text: "claude-code session ended" },
];

// Redundant "carpet" spans — what the screen classifier files during
// hook-active stretches so the coverage band stays unbroken. Excluded from
// the graded timeline (redundant: true), kept for realism.
const CARPET: Ev[] = (() => {
  const labels = ["cli_agent", "ide", "terminal"] as const;
  const spans: Ev[] = [];
  let t = 20;
  let i = 0;
  while (t < DURATION_SECONDS - 80) {
    const dur = 28 + ((i * 13) % 26);
    const label = labels[i % labels.length];
    spans.push({
      t,
      type: "screen_context",
      payload: {
        source: "screen", label, detail: null, confidence: 0.85,
        mode: "active", concurrentWithAgent: true, redundant: true,
        videoStart: t, videoEnd: t + dur, durationSeconds: dur,
        windowStart: t - 5, windowEnd: t + dur + 5,
      },
    });
    t += dur + 30 + ((i * 7) % 20);
    i += 1;
  }
  return spans;
})();

/* ------------------------------------------------------------------ */
/* Voice companion conversation                                        */
/* ------------------------------------------------------------------ */

const VOICE: Array<{ t: number; role: "agent" | "candidate"; text: string }> = [
  {
    t: 18, role: "agent",
    text:
      "You're about to start the Standup Board assessment. I'm here as a quick check-in so you can talk through what you're doing as you build — it helps capture your thinking. Unzip the starter, open it in your AI editor, and you're off. I'll ask the occasional short question; no hints or answers from me. Good luck.",
  },
  {
    t: 96, role: "candidate",
    text:
      "Okay — read through the brief. The four rules interact, so I'm going to plan with Claude first, then build one rule at a time and check each one before moving on. I've built kanbans before, so the shape is familiar.",
  },
  { t: 104, role: "agent", text: "A clear order. I'll check in as you go." },
  {
    t: 188, role: "candidate",
    text:
      "Starting with the data model. Tasks are keyed by a ref the client can pass in — the PATCH route addresses tasks by ref, so I want that in from the first version.",
  },
  {
    t: 196, role: "agent",
    text: "Why a client-supplied ref rather than just an id you generate?",
  },
  {
    t: 206, role: "candidate",
    text:
      "The brief's PATCH route uses it, and whatever drives the review probably creates tasks with refs it already knows. Generating one only when it's missing covers both cases.",
  },
  {
    t: 306, role: "candidate",
    text: "API's up — create and list both work. I curled them before touching the page. Wiring the page next.",
  },
  {
    t: 314, role: "agent",
    text: "What did those curls actually prove, beyond not crashing?",
  },
  {
    t: 324, role: "candidate",
    text:
      "The contract — 201 with the task body on create, the list including it right after, and a 400 when the title's blank. Shape and status codes, not just liveness.",
  },
  {
    t: 370, role: "candidate",
    text:
      "Page next. The brief is strict about placeholders and button names because automated review drives the page — so the markup stays exactly as specified and I only touch the wiring.",
  },
  { t: 380, role: "agent", text: "Noted. I'll stay out of your way while you wire it." },
  {
    t: 458, role: "candidate",
    text: "Doing the WIP limit now. The trick is the server has to refuse the fourth task, not the page.",
  },
  {
    t: 466, role: "agent",
    text: "You said the server has to refuse — how does the person using the page find out?",
  },
  {
    t: 474, role: "candidate",
    text: "It sends 409 with doing_full, and the page catches that and shows the exact 'Doing is full' text from the brief.",
  },
  {
    t: 530, role: "agent",
    text: "You just moved four tasks in one shot from the terminal — is that the whole test for this rule, or is more coming?",
  },
  {
    t: 542, role: "candidate",
    text: "That plus a unit case so it can't regress, and I'll click it in the page once the banner's wired.",
  },
  {
    t: 610, role: "candidate",
    text: "Banner works — fourth Start gets refused and the exact text shows up. Moving to the blocked rule.",
  },
  {
    t: 730, role: "candidate",
    text:
      "Blocked rule now. Block has to beat done, and unblocking has to release it — the order of checks in the PATCH handler is the whole rule.",
  },
  {
    t: 740, role: "agent",
    text: "Which check runs first — blocked, or the capacity limit?",
  },
  {
    t: 750, role: "candidate",
    text:
      "Blocked first. A blocked task heading to done should never even reach the capacity question — capacity only matters on the way into doing.",
  },
  {
    t: 860, role: "candidate",
    text: "Sequence passes end to end — block, refused with 409, unblock, done. And it reads right in the page too.",
  },
  {
    t: 900, role: "agent",
    text: "That's the third test run in the last few minutes — what's the suite covering by now?",
  },
  {
    t: 912, role: "candidate",
    text:
      "Health, title validation, create-and-list, the WIP limit, and now the blocked sequence. Roughly one case per rule — it's my regression net while the agent keeps editing.",
  },
  { t: 975, role: "candidate", text: "Owner filter next — exact match per the README. Should be a small one." },
  {
    t: 1048, role: "agent",
    text: "Claude just rewrote the filter and a chunk of server.js with it — did you look over what changed?",
  },
  {
    t: 1060, role: "candidate",
    text: "Not line by line, no. The tests are green and the curls do the right thing — that's my check.",
  },
  {
    t: 1150, role: "candidate",
    text:
      "Persistence left. Plain JSON file rewritten on every change — no database, the brief says files on disk are fine at this size.",
  },
  {
    t: 1160, role: "agent",
    text: "What's the failure mode you'd worry about with that approach?",
  },
  {
    t: 1170, role: "candidate",
    text:
      "A crash mid-write could lose the last change. Acceptable at this size — what I actually need is a normal restart coming back clean, and that's the thing I'm about to prove.",
  },
  {
    t: 1284, role: "candidate",
    text: "Restarted the server and the task list came back from disk, so persistence is done.",
  },
  {
    t: 1390, role: "candidate",
    text:
      "Found a UI bug clicking around — the Doing is full banner sticks after you free a slot. Having it clear on the next successful action.",
  },
  {
    t: 1400, role: "agent",
    text: "You found that by clicking, not from a failing test — would a test have caught it?",
  },
  {
    t: 1412, role: "candidate",
    text: "Not the unit ones — it's pure page state. Which is exactly why I keep clicking through after every rule.",
  },
  {
    t: 1580, role: "candidate",
    text:
      "Final pass now — the full suite, then one sweep of every rule against a restarted server. Then I'm calling it.",
  },
  {
    t: 1662, role: "candidate",
    text: "I think I'm done. Tests pass, the curl sweep hit every rule — and I was reviewing each diff as Claude went.",
  },
  {
    t: 1672, role: "agent",
    text:
      "You said you're done — and earlier Claude also said its checks passed. How do you know the whole board holds up, not just the pieces you re-ran?",
  },
  {
    t: 1688, role: "candidate",
    text:
      "Because the final sweep re-ran everything in one pass against a restarted server — health, create, the exact-match filter, the blocked rule, the WIP limit, persistence — and I clicked through the board once more on top of that.",
  },
  { t: 1698, role: "agent", text: "That covers the contract. Good luck with the submit." },
];

/* ------------------------------------------------------------------ */
/* Episodes                                                            */
/* ------------------------------------------------------------------ */

const EPISODE_DEFS = [
  { start: 0, end: 120, kind: "research", label: "Reading the brief and starter",
    summary: "Reads README.md and every starter file, then installs dependencies. No code is touched until the whole contract has been read." },
  { start: 120, end: 175, kind: "planning", label: "Planning the four rules with Claude",
    summary: "First prompt asks for an ordered plan with a verification step per rule, and explicitly defers code. The plan drives the rest of the session." },
  { start: 175, end: 450, kind: "implementation", label: "Task store, API, and the page",
    summary: "The store and POST/GET land first and are curled against the live server; the page's add flow follows, plus a node:test suite that grows with each rule." },
  { start: 450, end: 720, kind: "implementation", label: "WIP limit and the Doing is full banner",
    summary: "Server-side 409 doing_full on the fourth move, proven with four tasks; the page surfaces the exact 'Doing is full' text." },
  { start: 720, end: 955, kind: "implementation", label: "Blocked rule",
    summary: "Blocked tasks refuse done with 409 until unblocked. The full sequence — block, refused done, unblock, done — runs against the live app and in the page." },
  { start: 955, end: 1185, kind: "implementation", label: "Owner filter, accepted as delivered",
    summary: "The agent adds the exact-match filter and the candidate accepts it without reading the diff — verification is a pinning test for the sam/samantha case, never a review of the code itself." },
  { start: 1185, end: 1380, kind: "verification", label: "Persistence and the restart check",
    summary: "Tasks persist to data/tasks.json; the server is actually restarted and the list read back rather than trusting the write path." },
  { start: 1380, end: 1560, kind: "debugging", label: "Clearing the sticky banner",
    summary: "A click-through finds the refusal banner outliving its cause; the fix clears it on the next successful action with a timeout fallback." },
  { start: 1560, end: 1800, kind: "verification", label: "Full-contract sweep and submit",
    summary: "Six unit tests plus a one-pass curl sweep of every rule against a restarted server, then a final read-through and click-through before submitting." },
] as const;

/* ------------------------------------------------------------------ */
/* Evaluation report (rubric + communication)                          */
/* ------------------------------------------------------------------ */

const CRITERIA_RESULTS = [
  {
    criterion: "Inspects the starter files and README before the first edit",
    score: 9,
    confidence: "high",
    verdict:
      "Every starter file is read before anything is edited, and the first prompt quotes the WIP and blocked rules back from the README. The one improvement would be probing the stub endpoints before planning, but nothing was edited blind.",
    evaluable: true,
    evidence: [
      { ts: 8, ts_end: 100, observation: "Reads README.md, server.js, index.html and app.js before any edit" },
      { ts: 125, ts_end: 152, observation: "First prompt is a planning request that restates the rules from the README" },
      { ts: 186, ts_end: 214, observation: "Re-reads server.js immediately before the first write" },
    ],
  },
  {
    criterion: "Builds and verifies one rule at a time rather than generating the whole app in one prompt",
    score: 9,
    confidence: "high",
    verdict:
      "The session is a textbook incremental build: seven ordered steps, each landed and verified before the next prompt. No prompt asks for more than one rule, and the plan from the opening prompt is followed to the end.",
    evaluable: true,
    evidence: [
      { ts: 175, ts_end: 292, observation: "Store and create/list built and curled as a unit before any UI work" },
      { ts: 452, ts_end: 676, observation: "WIP limit built, exercised with four tasks, and tested before the next rule" },
      { ts: 722, ts_end: 892, observation: "Blocked rule wired, then verified via the API sequence and npm test" },
      { ts: 958, ts_end: 1132, observation: "Owner filter built, hand-corrected, and pinned with a new test case" },
      { ts: 1188, ts_end: 1298, observation: "Persistence added and proven with a real restart, not assumed" },
    ],
  },
  {
    criterion: "Exercises the UI or API after wiring each rule",
    score: 9,
    confidence: "high",
    verdict:
      "Every rule is exercised against the running app right after it lands — curl for the API rules, the page itself for the UI-facing ones — and the session closes with a combined sweep plus a manual click-through.",
    evaluable: true,
    evidence: [
      { ts: 258, ts_end: 278, observation: "curl POST and GET against the running app right after the store lands" },
      { ts: 598, ts_end: 638, observation: "Clicks Start on four tasks in the page to see the Doing is full refusal" },
      { ts: 848, ts_end: 882, observation: "Drives the blocked flow in the page before moving on" },
      { ts: 1252, ts_end: 1279, observation: "Restarts the server and re-reads the task list" },
      { ts: 1596, ts_end: 1626, observation: "Final npm test plus a one-pass curl sweep of every rule" },
      { ts: 1756, ts_end: 1780, observation: "Closing click-through of every rule in the page" },
    ],
  },
  {
    criterion: "Edits or rewrites agent-written code rather than leaving it untouched",
    score: 3,
    confidence: "high",
    verdict:
      "Every line of the final code is agent-written and shipped exactly as generated. The candidate verifies behavior thoroughly — tests, curls, click-throughs — but never opens a diff or edits agent output by hand: even the banner bug they found themselves was routed back to the agent as a prompt. Strong behavioral checking is not code review; nothing in the capture shows the code itself being read after any write.",
    evaluable: true,
    evidence: [
      { ts: 214, ts_end: 243, observation: "server.js written whole by the agent and started without the diff being opened" },
      { ts: 976, ts_end: 1012, observation: "Owner filter accepted sight-unseen — the next action is a behavioral check, not a review" },
      { ts: 1436, ts_end: 1466, observation: "The banner bug they found by hand is fixed by prompt, never by editing the file" },
      { ts: 1656, ts_end: 1704, observation: "First look at server.js contents comes after the final sweep, as a brief pre-submit skim" },
    ],
  },
];

const COMMUNICATION = {
  available: true,
  utteranceCount: VOICE.filter((v) => v.role === "candidate").length,
  wordCount: VOICE.filter((v) => v.role === "candidate")
    .map((v) => v.text.split(/\s+/).length)
    .reduce((a, b) => a + b, 0),
  clarity: 9,
  summary:
    "Narration is sparse but consistently load-bearing: each spoken update states what was just verified or what is about to be checked, in concrete product terms. One closing claim overreaches — 'reviewing each diff as Claude went' — which the capture contradicts and the candidate themselves had disclaimed twenty minutes earlier.",
  highlights: [
    {
      ts: 458,
      quote: "The trick is the server has to refuse the fourth task, not the page.",
      whyItMatters: "Shows they read the enforcement requirement, not just the UI copy.",
    },
    {
      ts: 1060,
      quote: "The tests are green and the curls do the right thing — that's my check.",
      whyItMatters: "States the verification strategy plainly: behavioral checks stand in for ever reading the agent's code.",
    },
    {
      ts: 750,
      quote: "A blocked task heading to done should never even reach the capacity question.",
      whyItMatters: "Reasoning about how the rules interact, not just each rule in isolation.",
    },
    {
      ts: 1688,
      quote: "The final sweep re-ran everything in one pass against a restarted server.",
      whyItMatters: "Completion claim backed by named verification, not assertion.",
    },
  ],
  claimChecks: [
    {
      claim: "I curled create and list before touching the page",
      ts: 306,
      verdict: "supported",
      note: "The timeline shows curl POST and GET at 4:18–4:38, before the first page edit at 5:42.",
    },
    {
      claim: "I was reviewing each diff as Claude went",
      ts: 1662,
      verdict: "contradicted",
      note: "No editor or code-read activity follows any agent write in the capture — and at 17:40 they said the opposite ('not line by line'). The only look at server.js is a brief skim after the final sweep.",
    },
    {
      claim: "Restarted the server and the task list came back from disk",
      ts: 1284,
      verdict: "supported",
      note: "A restart command and a task-list read follow at 20:52–21:19 with statuses preserved.",
    },
    {
      claim: "I'll click it in the page once the banner's wired",
      ts: 542,
      verdict: "supported",
      note: "A browser session on the running board follows at 9:58, right after the banner edit lands.",
    },
    {
      claim: "I've built kanbans before",
      ts: 96,
      verdict: "unverifiable",
      note: "Background claim — nothing in the capture can confirm or refute it.",
    },
  ],
};

const SESSION_SUMMARY =
  "A disciplined incremental build with one clear gap: the candidate reads the whole starter, has the agent produce an ordered plan with a verification step per rule, then lands the seven steps one at a time — each proven against the running app before the next prompt, closing with a full-contract sweep against a restarted server. But the code itself is never reviewed: every line ships exactly as the agent generated it, the sticky-banner bug they found by clicking around is fixed by prompt rather than by hand, and the one spoken claim of diff review is contradicted by the capture. Verification here is entirely behavioral — thorough at the product level, absent at the code level.";

/* ------------------------------------------------------------------ */
/* Behavioral grading report                                           */
/* ------------------------------------------------------------------ */

function isoAfterSubmit(seconds: number): string {
  return new Date(SUBMITTED_AT.getTime() + seconds * 1000).toISOString();
}

function httpEv(id: string, label: string, curl: string, status: number, bodySnippet: string, tOffset: number) {
  return {
    id, type: "http" as const,
    input: { curl, label },
    startedAt: isoAfterSubmit(tOffset), finishedAt: isoAfterSubmit(tOffset + 1),
    success: true,
    http: { status, bodySnippet },
  };
}

function buildBehavioralReport(submissionId: string, artifactKeys: { createUi: string; wipLimit: string }) {
  const cases = [
    {
      checkText: "GET /health returns 200 with { ok: true }.",
      checkIndex: 0,
      checkId: "board-health",
      verifiedBy: "http",
      verdict: "pass",
      evidence: [
        httpEv("e-health", "health", "curl -s -i http://127.0.0.1:3000/health", 200, '{"ok":true}', 372),
      ],
      artifacts: [],
    },
    {
      checkText: "Adding a task through the page shows it on the board with its owner, without a manual refresh.",
      checkIndex: 1,
      checkId: "board-create-ui",
      verifiedBy: "ui",
      verdict: "pass",
      isolation: "fresh_browser_context",
      evidence: [
        {
          id: "e-create-ui", type: "ui" as const,
          input: {
            command:
              "goto / · fill placeholder 'Task title' = mk-b3f19c · fill placeholder 'Owner' = casey-b3f19c · click button 'Add task' · expect text mk-b3f19c · expect casey-b3f19c in the same row",
            label: "page add flow",
          },
          startedAt: isoAfterSubmit(390), finishedAt: isoAfterSubmit(397),
          success: true,
          stdoutSnippet: "task row rendered in Todo with title and owner; no page reload observed",
          artifactKeys: [artifactKeys.createUi],
        },
      ],
      artifacts: [artifactKeys.createUi],
    },
    {
      checkText: "GET /api/tasks?owner= returns only that owner's tasks.",
      checkIndex: 2,
      checkId: "board-owner-filter",
      verifiedBy: "http_sequence",
      verdict: "pass",
      evidence: [
        httpEv("e-of-1", "task for owner A", "curl -s -X POST http://127.0.0.1:3000/api/tasks -d '{\"title\":\"fa-77e0c2\",\"owner\":\"oa-77e0c2\",\"ref\":\"fa-77e0c2\"}'", 201, '{"ref":"fa-77e0c2","owner":"oa-77e0c2","status":"todo"}', 402),
        httpEv("e-of-2", "task for owner B", "curl -s -X POST http://127.0.0.1:3000/api/tasks -d '{\"title\":\"fb-77e0c2\",\"owner\":\"ob-77e0c2\",\"ref\":\"fb-77e0c2\"}'", 201, '{"ref":"fb-77e0c2","owner":"ob-77e0c2","status":"todo"}', 404),
        httpEv("e-of-3", "filter returns only owner A", "curl -s 'http://127.0.0.1:3000/api/tasks?owner=oa-77e0c2'", 200, '{"tasks":[{"ref":"fa-77e0c2","owner":"oa-77e0c2"}]} — fb-77e0c2 absent', 406),
      ],
      artifacts: [],
    },
    {
      checkText: "A blocked task cannot be moved to done until it is unblocked.",
      checkIndex: 3,
      checkId: "board-blocked-rule",
      verifiedBy: "http_sequence",
      verdict: "pass",
      evidence: [
        httpEv("e-bl-1", "create + move to doing", "curl -s -X POST http://127.0.0.1:3000/api/tasks -d '{\"title\":\"bl-77e0c2\",\"ref\":\"bl-77e0c2\"}' && curl -s -X PATCH http://127.0.0.1:3000/api/tasks/ref/bl-77e0c2 -d '{\"status\":\"doing\"}'", 200, '{"ref":"bl-77e0c2","status":"doing"}', 412),
        httpEv("e-bl-2", "block it", "curl -s -X PATCH http://127.0.0.1:3000/api/tasks/ref/bl-77e0c2 -d '{\"blocked\":true,\"blockedReason\":\"waiting on API keys\"}'", 200, '{"blocked":true,"blockedReason":"waiting on API keys"}', 414),
        httpEv("e-bl-3", "refuse done while blocked", "curl -s -X PATCH http://127.0.0.1:3000/api/tasks/ref/bl-77e0c2 -d '{\"status\":\"done\"}'", 409, '{"error":"blocked"}', 416),
        httpEv("e-bl-4", "unblock, then done succeeds", "curl -s -X PATCH http://127.0.0.1:3000/api/tasks/ref/bl-77e0c2 -d '{\"blocked\":false}' && curl -s -X PATCH http://127.0.0.1:3000/api/tasks/ref/bl-77e0c2 -d '{\"status\":\"done\"}'", 200, '{"ref":"bl-77e0c2","status":"done"}', 418),
      ],
      artifacts: [],
    },
    {
      checkText: "The Doing column refuses a fourth task and the page shows 'Doing is full'.",
      checkIndex: 4,
      checkId: "board-wip-limit-ui",
      verifiedBy: "ui",
      verdict: "pass",
      isolation: "fresh_browser_context",
      evidence: [
        {
          id: "e-wip-ui", type: "ui" as const,
          input: {
            command:
              "goto / · add tasks w1–w4-9d40e1 · click Start in each row · fourth Start refused · expect text 'Doing is full'",
            label: "WIP limit walkthrough",
          },
          startedAt: isoAfterSubmit(424), finishedAt: isoAfterSubmit(436),
          success: true,
          stdoutSnippet: "three tasks entered Doing; the fourth stayed in Todo and 'Doing is full' rendered above the board",
          artifactKeys: [artifactKeys.wipLimit],
        },
      ],
      artifacts: [artifactKeys.wipLimit],
    },
    {
      checkText: "Tasks survive a server restart.",
      checkIndex: 5,
      checkId: "board-persistence",
      verifiedBy: "restart_persistence",
      verdict: "pass",
      evidence: [
        httpEv("e-p-1", "create before restart", "curl -s -X POST http://127.0.0.1:3000/api/tasks -d '{\"title\":\"keep-77e0c2\",\"ref\":\"keep-77e0c2\"}'", 201, '{"ref":"keep-77e0c2","status":"todo"}', 442),
        {
          id: "e-p-2", type: "command" as const,
          input: { command: "restart app process (SIGTERM, then npm start)" },
          startedAt: isoAfterSubmit(444), finishedAt: isoAfterSubmit(449),
          success: true, exitCode: 0,
          stdoutSnippet: "standup-board listening on http://0.0.0.0:3000",
        },
        httpEv("e-p-3", "still there after restart", "curl -s http://127.0.0.1:3000/api/tasks", 200, '{"tasks":[..., {"ref":"keep-77e0c2","status":"todo"}, ...]}', 451),
      ],
      artifacts: [],
    },
  ];

  const score = computeBehavioralScore(cases as never);

  return {
    sandbox: { sandboxId: `e2b_${crypto.randomBytes(8).toString("hex")}`, timeoutMs: 1800000 },
    runbook: {
      summary:
        "Used the candidate's finalized runtime setup: npm install, then npm start on port 3000 with /health as the readiness probe. No README inference was needed.",
      readmeRequirementPassed: true,
      readmeRequirementDetail: {
        passed: true,
        inferredStepCount: 2,
        hasInstallCommand: true,
        hasTestCommand: false,
        hasStartCommand: true,
        summary: "README documents install, start, port and health — and they match the candidate's verified commands.",
      },
      evidence: [
        {
          id: "rb-install", type: "command" as const,
          input: { command: "npm install" },
          startedAt: isoAfterSubmit(300), finishedAt: isoAfterSubmit(318),
          success: true, exitCode: 0,
          stdoutSnippet: "added 68 packages in 4s",
        },
        {
          id: "rb-start", type: "command" as const,
          input: { command: "npm start" },
          startedAt: isoAfterSubmit(320), finishedAt: isoAfterSubmit(322),
          success: true, exitCode: 0,
          stdoutSnippet: "standup-board listening on http://0.0.0.0:3000",
        },
        httpEv("rb-health", "readiness probe", "curl -s -i http://127.0.0.1:3000/health", 200, '{"ok":true}', 324),
      ],
      baseUrl: "http://127.0.0.1:3000",
      sandboxAppOrigin: "http://127.0.0.1:3000",
      sandboxAppDiscovery: "candidate runtime config pinned port 3000; /health answered on the first probe",
      executionProfile: "web_server",
    },
    setup: {
      status: "ready",
      phase: "complete",
      summary: "Installed dependencies and started the app with the candidate's verified commands; /health answered in 1.8s.",
      failedSteps: [],
      healthWait: {
        attempted: true, ready: true, attempts: 2, elapsedMs: 1800,
        logTail: "standup-board listening on http://0.0.0.0:3000",
      },
    },
    runbookSource: "candidate_config",
    failureCategory: null,
    cases,
    score,
    startedAt: isoAfterSubmit(290),
    completedAt: isoAfterSubmit(470),
    reportArtifactKey: `submissions/${submissionId}/report.json`,
  };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

function solutionFiles(): Array<{ path: string; content: string; origin: "agent" | "snapshot"; revision: number }> {
  const read = (p: string) => fs.readFileSync(path.join(DEMO_DIR, p), "utf8");
  return [
    { path: "server.js", content: read("server.js"), origin: "agent", revision: 5 },
    { path: "public/app.js", content: read("public/app.js"), origin: "agent", revision: 3 },
    { path: "public/index.html", content: read("public/index.html"), origin: "agent", revision: 2 },
    { path: "tests/board.test.js", content: read("tests/board.test.js"), origin: "agent", revision: 2 },
    { path: "README.md", content: read("README.md"), origin: "snapshot", revision: 1 },
    { path: "package.json", content: read("package.json"), origin: "snapshot", revision: 1 },
    { path: ".gitignore", content: read(".gitignore"), origin: "snapshot", revision: 1 },
  ];
}

function buildZip(submissionId: string): Buffer {
  const tmpZip = path.join(SERVER_ROOT, "storage", "tmp", `standup-board-${submissionId}.zip`);
  fs.mkdirSync(path.dirname(tmpZip), { recursive: true });
  try {
    fs.unlinkSync(tmpZip);
  } catch {
    /* ignore */
  }
  execSync(
    `zip -r "${tmpZip}" . -x "node_modules/*" -x "data/*" -x "artifacts/*" -x ".DS_Store"`,
    { cwd: DEMO_DIR, stdio: "pipe" }
  );
  const buf = fs.readFileSync(tmpZip);
  fs.unlinkSync(tmpZip);
  return buf;
}

async function seedForOwner(email: string, videoStat: fs.Stats) {
  const user = await UserModel.findOne({ email });
  if (!user) {
    console.warn(`Skipping ${email} — user not found (sign in once first).`);
    return null;
  }
  const assessment = await AssessmentModel.findOne({ userId: user._id, title: ASSESSMENT_TITLE });
  if (!assessment) {
    console.warn(`Skipping ${email} — "${ASSESSMENT_TITLE}" not found. Run seedDemoAssessments.ts first.`);
    return null;
  }
  await AssessmentModel.updateOne({ _id: assessment._id }, { $set: { evidenceMode: "both" } });

  const storage = getFrameStorage();
  const gradingStorage = getGradingEvidenceStorage();
  const codeStorage = getSubmissionCodeStorage();

  // ---- wipe any previous demo run for this owner ---------------------
  const oldSubs = await SubmissionModel.find({
    assessmentId: assessment._id,
    candidateEmail: CANDIDATE_EMAIL,
  }).lean();
  for (const old of oldSubs) {
    const oldProc = await ProctoringSessionModel.findOne({ submissionId: old._id }).lean();
    if (oldProc) {
      const prefix = String(oldProc._id);
      for (const key of [
        `${prefix}/playback.webm`,
        ...(await storage.listKeys(`${prefix}/companion`).catch(() => [])),
      ]) {
        await storage.delete(key).catch(() => undefined);
      }
      await ProctoringSessionModel.deleteOne({ _id: oldProc._id });
    }
    const oldWf = await WorkflowCaptureSessionModel.find({ submissionId: old._id }).lean();
    for (const w of oldWf) {
      await WorkflowEventModel.deleteMany({ sessionId: w._id });
      await WorkflowFileStateModel.deleteMany({ sessionId: w._id });
    }
    await WorkflowCaptureSessionModel.deleteMany({ submissionId: old._id });
    await SubmissionModel.deleteOne({ _id: old._id });
  }
  if (oldSubs.length) console.log(`  removed ${oldSubs.length} previous demo submission(s)`);

  // ---- events, metrics, integrity ------------------------------------
  const allEvents = [...HOOK_EVENTS, ...CARPET].sort((a, b) => a.t - b.t);
  const eventLikes = allEvents.map((e) => ({
    at: at(e.t),
    type: e.type,
    toolName: e.toolName ?? null,
    text: e.text ?? null,
    payload: e.payload ?? null,
  }));
  const files = solutionFiles();
  const metrics = computeMetrics(
    eventLikes as never,
    files.map((f) => ({ origin: f.origin, sizeBytes: Buffer.byteLength(f.content) })) as never,
    { startedAt: T0 }
  );
  const capture = assessCaptureIntegrity(eventLikes as never, {
    submittedAt: SUBMITTED_AT,
    startedAt: T0,
  });

  const evaluationReport = {
    session_summary: SESSION_SUMMARY,
    criteria_results: CRITERIA_RESULTS,
    workflowMetrics: metrics,
    communication: COMMUNICATION,
    evidenceIntegrity: {
      citationsKept: CRITERIA_RESULTS.reduce((n, c) => n + c.evidence.length, 0),
      citationsDropped: 0,
      invalidatedCriteria: [],
      capture,
    },
  };

  // ---- submission ----------------------------------------------------
  const submission = await SubmissionModel.create({
    token: crypto.randomBytes(32).toString("hex"),
    assessmentId: assessment._id,
    candidateName: CANDIDATE_NAME,
    candidateEmail: CANDIDATE_EMAIL,
    status: "submitted",
    startedAt: T0,
    submittedAt: SUBMITTED_AT,
    timeSpent: Math.round(DURATION_SECONDS / 60),
    codeSource: "upload",
    optedOut: false,
    evaluationStatus: "completed",
    evaluationError: null,
    evaluationReport,
    scores: { overall: 75, calculatedAt: new Date(), calculationVersion: "demo-seed-1" },
    runtimeConfig: {
      rootDir: ".",
      runtime: "auto",
      installCommand: "npm install",
      buildCommand: null,
      startCommand: "npm start",
      port: 3000,
      healthPath: "/health",
      executionProfile: "web_server",
      envVars: [],
      declaredEgressDomains: [],
    },
    runtimeSetup: {
      status: "finalized",
      verified: true,
      lastRunAt: new Date(SUBMITTED_AT.getTime() + 6 * 60_000),
      lastRunResult: {
        ok: true,
        exitCode: 0,
        error: null,
        startedAt: new Date(SUBMITTED_AT.getTime() + 5 * 60_000),
        endedAt: new Date(SUBMITTED_AT.getTime() + 6 * 60_000),
      },
      finalizedAt: new Date(SUBMITTED_AT.getTime() + 8 * 60_000),
      evidence: {
        healthOk: true,
        healthSummary: "GET /health answered 200 { ok: true } 1.8s after npm start",
        port: 3000,
        capturedAt: new Date(SUBMITTED_AT.getTime() + 8 * 60_000),
        logTail: [
          { stream: "stdout", text: "> standup-board@1.0.0 start", t: new Date(SUBMITTED_AT.getTime() + 5 * 60_000) },
          { stream: "stdout", text: "standup-board listening on http://0.0.0.0:3000", t: new Date(SUBMITTED_AT.getTime() + 5 * 60_000 + 2000) },
        ],
      },
    },
    metadata: { ipAddress: "203.0.113.42", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139.0 Safari/537.36" },
  });
  const submissionId = String(submission._id);
  console.log(`  submission ${submissionId}`);

  // ---- code archive ---------------------------------------------------
  const zip = buildZip(submissionId);
  const zipKey = `submissions/${submissionId}/archives/standup-board-submission.zip`;
  await codeStorage.storeArchive(zipKey, zip);
  await SubmissionModel.updateOne(
    { _id: submission._id },
    {
      $set: {
        codeUpload: {
          storageKey: zipKey,
          originalFilename: "standup-board.zip",
          sizeBytes: zip.length,
          sha256: crypto.createHash("sha256").update(zip).digest("hex"),
          uploadedAt: SUBMITTED_AT,
        },
      },
    }
  );
  console.log(`  code archive stored (${zip.length} bytes)`);

  // ---- behavioral grading report + artifacts -------------------------
  const artifactKeys = {
    createUi: `submissions/${submissionId}/behavioral/create-ui.png`,
    wipLimit: `submissions/${submissionId}/behavioral/wip-limit.png`,
  };
  await gradingStorage.storeArtifact(
    artifactKeys.createUi,
    fs.readFileSync(path.join(DEMO_DIR, "artifacts/create-ui.png"))
  );
  await gradingStorage.storeArtifact(
    artifactKeys.wipLimit,
    fs.readFileSync(path.join(DEMO_DIR, "artifacts/wip-limit.png"))
  );
  const behavioralReport = buildBehavioralReport(submissionId, artifactKeys);
  await gradingStorage.storeText(
    behavioralReport.reportArtifactKey,
    JSON.stringify(behavioralReport, null, 2)
  );
  await SubmissionModel.updateOne(
    { _id: submission._id },
    {
      $set: {
        behavioralGradingStatus: "completed",
        behavioralGradingError: null,
        behavioralGradingReport: behavioralReport,
      },
      $unset: { behavioralGradingProgress: "" },
    }
  );
  console.log(
    `  behavioral: ${behavioralReport.score.passed}/${behavioralReport.score.total} pass (rate ${behavioralReport.score.passRate})`
  );

  // ---- proctoring session + video + companion ------------------------
  const proctoring = await ProctoringSessionModel.create({
    submissionId: submission._id,
    token: submission.token,
    status: "completed",
    consent: { granted: true, grantedAt: new Date(T0.getTime() - 90_000), screens: 1 },
    screens: [{ screenIndex: 0, label: "Screen 1", width: 2940, height: 1912, addedAt: new Date(T0.getTime() - 60_000) }],
    sidecarEvents: [
      { type: "window_blur", timestamp: at(414), metadata: { reason: "browser focus" } },
      { type: "window_focus", timestamp: at(438), metadata: {} },
      { type: "window_blur", timestamp: at(598), metadata: { reason: "browser focus" } },
      { type: "window_focus", timestamp: at(640), metadata: {} },
      { type: "window_blur", timestamp: at(1738), metadata: { reason: "browser focus" } },
      { type: "window_focus", timestamp: at(1774), metadata: {} },
    ],
    videoChunks: [],
    mergedVideo: {
      status: "ready",
      storageKey: "", // set below once we know the session id
      sizeBytes: videoStat.size,
      durationSeconds: DURATION_SECONDS,
      mergedAt: new Date(SUBMITTED_AT.getTime() + 90_000),
      error: null,
      chunksDeletedAt: new Date(SUBMITTED_AT.getTime() + 95_000),
    },
    stats: {
      totalFrames: 0,
      uniqueFrames: 0,
      duplicatesSkipped: 0,
      totalSizeBytes: 0,
      captureStartedAt: T0,
      captureEndedAt: at(DURATION_SECONDS),
      videoStats: {
        totalChunks: 60,
        totalVideoSizeBytes: videoStat.size,
        durationSeconds: DURATION_SECONDS,
        extractedFrameCount: 0,
        extractionMethod: null,
      },
    },
    companion: {
      status: "completed",
      conversationId: `conv_demo_${crypto.randomBytes(6).toString("hex")}`,
      startedAt: at(15),
      endedAt: at(1700),
      error: null,
    },
  });
  const sessionId = String(proctoring._id);
  const videoKey = `${sessionId}/playback.webm`;
  await ProctoringSessionModel.updateOne(
    { _id: proctoring._id },
    { $set: { "mergedVideo.storageKey": videoKey } }
  );
  console.log(`  proctoring session ${sessionId} — uploading video (${Math.round(videoStat.size / 1e6)}MB)…`);
  await storage.storeBlobFromFile(videoKey, VIDEO_PATH);
  console.log(`  video stored at ${videoKey}`);

  // Companion transcript as flush-shaped JSONL blobs (~4 messages each).
  for (let i = 0; i < VOICE.length; i += 4) {
    const chunk = VOICE.slice(i, i + 4);
    const key = `${sessionId}/companion/${at(chunk[0].t).getTime()}-${crypto.randomBytes(4).toString("hex")}.jsonl`;
    const content = chunk
      .map((m) => JSON.stringify({ role: m.role, text: m.text, timestampMs: at(m.t).getTime() }))
      .join("\n");
    await storage.storeTranscript(key, content);
  }
  console.log(`  companion transcript stored (${VOICE.length} messages)`);

  // ---- workflow capture session + events + files ---------------------
  const wfSession = await WorkflowCaptureSessionModel.create({
    submissionId: submission._id,
    submissionToken: submission.token,
    captureToken: crypto.randomBytes(24).toString("hex"),
    candidateName: CANDIDATE_NAME,
    source: "claude-code",
    status: "completed",
    consent: { granted: true, grantedAt: new Date(T0.getTime() - 45_000), disclosureVersion: "v1" },
    startedAt: T0,
    lastEventAt: at(1786),
    completedAt: SUBMITTED_AT,
    stats: {
      totalEvents: allEvents.length,
      promptCount: allEvents.filter((e) => e.type === "user_prompt").length,
      toolUseCount: allEvents.filter((e) => e.type === "tool_use").length,
      payloadBytes: eventLikes.reduce((n, e) => n + Buffer.byteLength(e.text || ""), 0),
    },
    environment: {
      cwd: "/Users/jordan/assessments/standup-board",
      gitBranch: null,
      gitRemote: null,
      toolVersion: "claude-code/1.0.98",
      platform: "darwin",
    },
  });

  // Hook events take the low seq range; screen_context appends after, like
  // the real classifier does. Episode evidenceIndices index the at-sorted list.
  const hookOnly = HOOK_EVENTS.filter((e) => e.type !== "screen_context").sort((a, b) => a.t - b.t);
  const screenOnly = [...HOOK_EVENTS.filter((e) => e.type === "screen_context"), ...CARPET].sort(
    (a, b) => a.t - b.t
  );
  let seq = 0;
  const docs = [
    ...hookOnly.map((e) => ({ e, seq: ++seq })),
    ...screenOnly.map((e) => ({ e, seq: ++seq })),
  ];
  await WorkflowEventModel.insertMany(
    docs.map(({ e, seq: s }) => ({
      sessionId: wfSession._id,
      type: e.type,
      at: at(e.t),
      seq: s,
      toolName: e.toolName,
      text: e.text ?? null,
      payload: e.payload ?? undefined,
      truncated: false,
      cwd: "/Users/jordan/assessments/standup-board",
      receivedAt: at(e.t + 1),
    }))
  );

  const sortedByAt = allEvents; // already time-sorted
  const episodes = EPISODE_DEFS.map((ep, i) => ({
    index: i + 1,
    label: ep.label,
    summary: ep.summary,
    startSeconds: ep.start,
    endSeconds: ep.end,
    kind: ep.kind,
    evidenceIndices: sortedByAt
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.t >= ep.start && e.t < ep.end && e.type !== "screen_context")
      .map(({ idx }) => idx)
      .slice(0, 12),
  }));
  await WorkflowCaptureSessionModel.updateOne(
    { _id: wfSession._id },
    { $set: { episodes, episodesComputedAt: SUBMITTED_AT } }
  );

  await WorkflowFileStateModel.insertMany(
    files.map((f) => ({
      sessionId: wfSession._id,
      path: f.path,
      content: f.content,
      truncated: false,
      sizeBytes: Buffer.byteLength(f.content),
      origin: f.origin,
      revision: f.revision,
      updatedAt: at(1704),
    }))
  );
  console.log(
    `  workflow capture: ${allEvents.length} events, ${episodes.length} episodes, ${files.length} file states`
  );
  console.log(
    `  metrics: read:edit ${metrics.readEditRatio}, verified writes ${metrics.verifiedWriteRatio}, agent share ${metrics.authorship.agentShare}, capture ${capture.status}`
  );

  return {
    email,
    assessmentId: String(assessment._id),
    submissionId,
    dashboard: `${getShareLinkBaseUrl()}/SubmissionsDashboard?assessmentId=${assessment._id}`,
  };
}

async function main() {
  if (!fs.existsSync(VIDEO_PATH)) {
    throw new Error(`Demo video not found at ${VIDEO_PATH} — set DEMO_VIDEO_PATH or stage the file.`);
  }
  const videoStat = fs.statSync(VIDEO_PATH);
  await connectMongoose();

  const results = [];
  for (const email of OWNER_EMAILS) {
    console.log(`\nSeeding perfect demo for ${email}…`);
    const r = await seedForOwner(email, videoStat);
    if (r) results.push(r);
  }
  if (!results.length) {
    throw new Error(`No owners seeded. Tried: ${OWNER_EMAILS.join(", ")}`);
  }

  console.log("\n=== Done ===");
  for (const r of results) {
    console.log(`\n${r.email}`);
    console.log(`  assessment : ${r.assessmentId} (${ASSESSMENT_TITLE})`);
    console.log(`  submission : ${r.submissionId} — ${CANDIDATE_NAME}`);
    console.log(`  review     : ${r.dashboard}`);
  }
  console.log(
    "\nNote: behavioral screenshots + report.json live in local grading storage" +
      " (server/storage/grading). They resolve when this machine serves the API;" +
      " the video, companion transcript, and code archive are in S3 and work everywhere."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
