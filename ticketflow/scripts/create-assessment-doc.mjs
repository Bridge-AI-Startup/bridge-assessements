/**
 * Builds the MongoDB assessment document for TicketFlow demo.
 * Usage: node ticketflow/scripts/create-assessment-doc.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const USER_ID = process.env.BRIDGE_USER_ID || "696451ad68f2e4496488fa05";
const challenge = fs.readFileSync(path.join(root, "CHALLENGE.md"), "utf8");
const starterCodeFiles = JSON.parse(
  fs.readFileSync(path.join(__dirname, "starter-files.embedded.json"), "utf8"),
);

const description = [
  "Work in the **starter code** package below. Copy files into a workspace, then run `server` + `client` per `README.md`.",
  "",
  "Start by running `npm test` in `server/` — three tests fail until you fix the planted bugs.",
  "",
  "---",
  "",
  challenge.trimEnd(),
  "",
].join("\n");

const now = new Date().toISOString();

const doc = {
  userId: { $oid: USER_ID },
  title: "TicketFlow — Debug + Build",
  description,
  timeLimit: 90,
  numInterviewQuestions: 2,
  starterFilesGitHubLink: null,
  starterCodeFiles,
  interviewerCustomInstructions: null,
  isSmartInterviewerEnabled: false,
  behavioralChecks: [
    "Invalid status transitions (open → resolved) are rejected with a clear 400 error.",
    "Priority filter returns only exact priority matches (high does not include low).",
    "Ticket list is sorted oldest-first by createdAt.",
    "Search filters tickets by title or description case-insensitively.",
    "Stats endpoint returns accurate counts grouped by status.",
    "All server tests pass after fixes (`npm test` in server/).",
  ],
  evaluationCriteria: [
    "Runs the test suite before and after each bug fix.",
    "Investigates root cause of failures instead of blindly patching symptoms.",
    "Implements search with thoughtful frontend behavior (e.g. debouncing).",
    "Can explain tradeoffs for stats endpoint caching and API design.",
    "Reviews AI-generated code before integrating changes.",
  ],
  createdAt: { $date: now },
  updatedAt: { $date: now },
};

const outPath = path.join(__dirname, "assessment-doc.json");
fs.writeFileSync(outPath, JSON.stringify(doc));
console.error("Wrote", outPath, "bytes:", Buffer.byteLength(JSON.stringify(doc)));
console.log(JSON.stringify({ outPath, userId: USER_ID, title: doc.title }));
