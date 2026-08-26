const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const PORT = 3210 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "board-")), "tasks.json");
  server = spawn("node", [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_FILE: dataFile },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch (_err) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});

after(() => {
  if (server) server.kill();
});

test("health", async () => {
  const { status, body } = await api("GET", "/health");
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
});

test("create requires title", async () => {
  const { status } = await api("POST", "/api/tasks", { owner: "sam" });
  assert.equal(status, 400);
});

test("create and list", async () => {
  const { status, body } = await api("POST", "/api/tasks", {
    title: "write docs", owner: "sam", ref: "t-docs",
  });
  assert.equal(status, 201);
  assert.equal(body.status, "todo");
  const list = await api("GET", "/api/tasks");
  assert.ok(list.body.tasks.some((t) => t.ref === "t-docs"));
});

test("owner filter is exact match", async () => {
  await api("POST", "/api/tasks", { title: "a", owner: "sam", ref: "t-a" });
  await api("POST", "/api/tasks", { title: "b", owner: "samantha", ref: "t-b" });
  const { body } = await api("GET", "/api/tasks?owner=sam");
  assert.ok(body.tasks.every((t) => t.owner === "sam"));
  assert.ok(!body.tasks.some((t) => t.ref === "t-b"));
});

test("doing holds at most 3", async () => {
  for (const ref of ["w1", "w2", "w3", "w4"]) {
    await api("POST", "/api/tasks", { title: ref, ref });
  }
  for (const ref of ["w1", "w2", "w3"]) {
    const { status } = await api("PATCH", `/api/tasks/ref/${ref}`, { status: "doing" });
    assert.equal(status, 200);
  }
  const refused = await api("PATCH", "/api/tasks/ref/w4", { status: "doing" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "doing_full");
});

test("blocked task cannot move to done", async () => {
  await api("POST", "/api/tasks", { title: "risky", ref: "t-block" });
  await api("PATCH", "/api/tasks/ref/w1", { status: "done" }); // free a doing slot
  await api("PATCH", "/api/tasks/ref/t-block", { status: "doing" });
  await api("PATCH", "/api/tasks/ref/t-block", { blocked: true, blockedReason: "waiting on keys" });
  const refused = await api("PATCH", "/api/tasks/ref/t-block", { status: "done" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "blocked");
  await api("PATCH", "/api/tasks/ref/t-block", { blocked: false });
  const ok = await api("PATCH", "/api/tasks/ref/t-block", { status: "done" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "done");
});
