/**
 * Variant: no-persistence.
 *
 * Identical to the reference implementation except notes live in a module-level
 * array, so everything works until the process restarts and they are all gone.
 */
const http = require("http");

const PORT = Number(process.env.PORT || 4310);

let notes = [];

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

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (req.method === "GET" && url === "/health") {
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && (url === "/" || url === "/notes")) {
    return send(res, 200, { notes });
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
    const note = {
      id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      title,
      body: typeof body.body === "string" ? body.body : "",
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    return send(res, 201, { note });
  }

  return send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Notes API listening on http://localhost:${PORT}`);
});
