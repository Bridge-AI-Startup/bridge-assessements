const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const PORT = Number(process.env.PORT) || 5050;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "";

const NoteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    done: { type: Boolean, default: false },
  },
  { timestamps: true }
);

let Note = null;
const memory = [];

function memoryId() {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function listNotes() {
  if (Note) return Note.find().sort({ createdAt: -1 }).lean();
  return [...memory].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function createNote(title) {
  if (Note) return Note.create({ title, done: false });
  const doc = {
    _id: memoryId(),
    title,
    done: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  memory.unshift(doc);
  return doc;
}

async function patchNote(id, patch) {
  if (Note) {
    return Note.findByIdAndUpdate(id, patch, { new: true });
  }
  const doc = memory.find((n) => n._id === id);
  if (!doc) return null;
  Object.assign(doc, patch, { updatedAt: new Date() });
  return doc;
}

async function deleteNote(id) {
  if (Note) {
    const doc = await Note.findByIdAndDelete(id);
    return Boolean(doc);
  }
  const i = memory.findIndex((n) => n._id === id);
  if (i < 0) return false;
  memory.splice(i, 1);
  return true;
}

async function initDb() {
  if (!MONGO_URI) {
    console.log("[notes-board] No MONGO_URI — using in-memory store");
    return;
  }
  try {
    await mongoose.connect(MONGO_URI);
    Note = mongoose.models.Note || mongoose.model("Note", NoteSchema);
    console.log("[notes-board] Connected to MongoDB");
  } catch (err) {
    console.warn(
      "[notes-board] Mongo connect failed, using in-memory store:",
      err instanceof Error ? err.message : err
    );
  }
}

async function main() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, store: Note ? "mongo" : "memory" });
  });

  app.get("/api/notes", async (_req, res) => {
    res.json(await listNotes());
  });

  app.post("/api/notes", async (req, res) => {
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "title is required" });
    const note = await createNote(title);
    res.status(201).json(note);
  });

  app.patch("/api/notes/:id", async (req, res) => {
    const note = await patchNote(req.params.id, {
      ...(typeof req.body?.title === "string" ? { title: req.body.title } : {}),
      ...(typeof req.body?.done === "boolean" ? { done: req.body.done } : {}),
    });
    if (!note) return res.status(404).json({ error: "not found" });
    res.json(note);
  });

  app.delete("/api/notes/:id", async (req, res) => {
    const ok = await deleteNote(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  });

  const clientDist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[notes-board] listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
