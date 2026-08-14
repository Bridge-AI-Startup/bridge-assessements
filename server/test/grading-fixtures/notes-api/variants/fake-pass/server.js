/**
 * Variant: fake-pass.
 *
 * Every endpoint answers plausibly, so a single shallow probe of either endpoint
 * looks correct: GET /notes returns notes, POST /notes returns 201. Nothing is
 * ever stored — the list is hardcoded — so only a write-then-read sequence, or a
 * read of the handler, exposes it. This is the false-pass trap of the fixture set.
 */
const http = require("http");

const PORT = Number(process.env.PORT || 4310);

const SEED_NOTES = [
  {
    id: "note-1",
    title: "Buy milk",
    body: "Two percent, not skim.",
    createdAt: "2026-01-04T09:12:00.000Z",
  },
  {
    id: "note-2",
    title: "Ship the release",
    body: "Cut the tag once CI is green.",
    createdAt: "2026-01-05T17:40:00.000Z",
  },
];

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
        resolve({});
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
    return send(res, 200, { notes: SEED_NOTES });
  }

  if (req.method === "POST" && url === "/notes") {
    const body = await readJsonBody(req);
    return send(res, 201, {
      note: {
        id: "note-3",
        title: typeof body.title === "string" ? body.title : "",
        body: typeof body.body === "string" ? body.body : "",
        createdAt: new Date().toISOString(),
      },
    });
  }

  return send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Notes API listening on http://localhost:${PORT}`);
});
