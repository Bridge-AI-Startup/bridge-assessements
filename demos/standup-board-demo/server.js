const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "tasks.json");
const DOING_LIMIT = 3;

// tasks: [{ ref, title, owner, status, blocked, blockedReason, createdAt }]
let tasks = [];

function load() {
  try {
    tasks = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(tasks)) tasks = [];
  } catch (_err) {
    tasks = [];
  }
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

function findByRef(ref) {
  return tasks.find((t) => t.ref === ref) || null;
}

function doingCount() {
  return tasks.filter((t) => t.status === "doing").length;
}

load();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/api/tasks", (req, res) => {
  const { title, owner, ref } = req.body || {};
  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title_required" });
  }
  const taskRef =
    typeof ref === "string" && ref.trim()
      ? ref.trim()
      : crypto.randomBytes(6).toString("hex");
  if (findByRef(taskRef)) {
    return res.status(409).json({ error: "ref_taken" });
  }
  const task = {
    ref: taskRef,
    title: title.trim(),
    owner: typeof owner === "string" && owner.trim() ? owner.trim() : null,
    status: "todo",
    blocked: false,
    blockedReason: null,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  save();
  res.status(201).json(task);
});

app.get("/api/tasks", (req, res) => {
  const { owner } = req.query;
  const list =
    typeof owner === "string" && owner.length
      ? tasks.filter((t) => t.owner === owner)
      : tasks;
  res.status(200).json({ tasks: list });
});

app.patch("/api/tasks/ref/:ref", (req, res) => {
  const task = findByRef(req.params.ref);
  if (!task) {
    return res.status(404).json({ error: "not_found" });
  }
  const { status, blocked, blockedReason, owner } = req.body || {};

  if (status !== undefined) {
    if (!["todo", "doing", "done"].includes(status)) {
      return res.status(400).json({ error: "bad_status" });
    }
    if (status === "done" && task.blocked) {
      return res.status(409).json({ error: "blocked" });
    }
    if (status === "doing" && task.status !== "doing" && doingCount() >= DOING_LIMIT) {
      return res.status(409).json({ error: "doing_full" });
    }
    task.status = status;
  }
  if (blocked !== undefined) {
    task.blocked = Boolean(blocked);
    if (!task.blocked) task.blockedReason = null;
  }
  if (blockedReason !== undefined && task.blocked) {
    task.blockedReason = typeof blockedReason === "string" ? blockedReason : null;
  }
  if (owner !== undefined) {
    task.owner = typeof owner === "string" && owner.trim() ? owner.trim() : null;
  }
  save();
  res.status(200).json(task);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`standup-board listening on http://0.0.0.0:${PORT}`);
});
