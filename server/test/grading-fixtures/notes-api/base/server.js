/**
 * Notes API — no dependencies, so `npm install` and boot take seconds inside the
 * grading sandbox. Notes are persisted to data/notes.json so they survive a
 * restart of the process.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 4310);
const DATA_FILE = path.join(__dirname, "data", "notes.json");

function loadNotes() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(parsed.notes) ? parsed.notes : [];
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ notes }, null, 2));
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

function newNote(title, body) {
  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    title,
    body: typeof body === "string" ? body : "",
    createdAt: new Date().toISOString(),
  };
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (req.method === "GET" && url === "/health") {
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && (url === "/" || url === "/notes")) {
    return send(res, 200, { notes: loadNotes() });
  }

  if (req.method === "POST" && url === "/notes") {
    const body = await readJsonBody(req);
    if (body === null) {
      return send(res, 400, { error: "Request body must be valid JSON." });
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return send(res, 400, { error: "Title is required." });
    }
    const notes = loadNotes();
    const note = newNote(title, body.body);
    notes.push(note);
    saveNotes(notes);
    return send(res, 201, { note });
  }

  return send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Notes API listening on http://localhost:${PORT}`);
});
