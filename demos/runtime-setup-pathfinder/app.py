#!/usr/bin/env python3
"""Tiny stdlib HTTP UI around the pathfinder CLI solver."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from pathfinder import solve_text

ROOT = Path(__file__).resolve().parent
MAPS = ROOT / "maps"
PORT = int(os.environ.get("PORT") or 8000)

PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Warehouse Pathfinder</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #161513;
      color: #f4f2e9;
    }
    header {
      padding: 16px 20px 8px;
      border-bottom: 1px solid #2c2a26;
    }
    h1 { font-size: 16px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.02em; }
    p.sub { margin: 0; color: #9a9588; font-size: 12px; }
    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 12px 20px;
    }
    select, button {
      font: inherit;
      background: #21201c;
      color: #f4f2e9;
      border: 1px solid #3a3832;
      border-radius: 6px;
      padding: 6px 10px;
    }
    button { cursor: pointer; }
    button:hover { background: #2c2a26; }
    .stats {
      padding: 0 20px 12px;
      font-size: 12px;
      color: #c8c3b4;
      min-height: 2.4em;
    }
    .stats.error { color: #d4a08c; }
    .board {
      padding: 8px 20px 24px;
      overflow: auto;
    }
    .grid {
      display: grid;
      gap: 2px;
      width: max-content;
    }
    .cell {
      width: 22px;
      height: 22px;
      border-radius: 3px;
      background: #24221e;
      display: grid;
      place-items: center;
      font-size: 10px;
      color: #161513;
    }
    .cell.wall { background: #3a3832; }
    .cell.floor { background: #24221e; }
    .cell.start { background: #6b8f71; }
    .cell.pkg { background: #c4a574; }
    .cell.path { background: #7d8f6b; }
    .cell.here { outline: 2px solid #f4f2e9; outline-offset: -2px; }
  </style>
</head>
<body>
  <header>
    <h1>Warehouse Pathfinder</h1>
    <p class="sub">A* between cells · Held-Karp over packages · return to dock</p>
  </header>
  <div class="bar">
    <label>Map
      <select id="map"></select>
    </label>
    <button id="solve" type="button">Solve</button>
  </div>
  <div class="stats" id="stats">Pick a map and solve.</div>
  <div class="board"><div class="grid" id="grid"></div></div>
  <script>
    const mapSel = document.getElementById("map");
    const stats = document.getElementById("stats");
    const gridEl = document.getElementById("grid");
    let timer = null;

    async function loadMaps() {
      const res = await fetch("/api/maps");
      const data = await res.json();
      mapSel.innerHTML = (data.maps || []).map((name) =>
        `<option value="${name}">${name}</option>`
      ).join("");
      if (data.maps && data.maps.length) solve();
    }

    function draw(grid, path, cursor) {
      const rows = grid.length;
      const cols = rows ? grid[0].length : 0;
      gridEl.style.gridTemplateColumns = `repeat(${cols}, 22px)`;
      const marks = new Set((path || []).map((p) => p.row + "," + p.col));
      const here = cursor ? cursor.row + "," + cursor.col : "";
      const html = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ch = grid[r][c];
          const key = r + "," + c;
          let cls = "floor";
          let label = "";
          if (ch === "#") cls = "wall";
          else if (ch === "S") { cls = "start"; label = "S"; }
          else if (ch === "P") { cls = "pkg"; label = "P"; }
          else if (marks.has(key)) cls = "path";
          if (key === here) cls += " here";
          html.push(`<div class="cell ${cls}">${label}</div>`);
        }
      }
      gridEl.innerHTML = html.join("");
    }

    async function solve() {
      if (timer) { clearInterval(timer); timer = null; }
      const name = mapSel.value;
      stats.textContent = "Solving " + name + "…";
      stats.className = "stats";
      const res = await fetch("/api/solve?map=" + encodeURIComponent(name));
      const data = await res.json();
      if (!data.ok) {
        stats.className = "stats error";
        const extra = (data.unreachable || []).map((u) => `(${u.row},${u.col})`).join(", ");
        stats.textContent = (data.error || "Failed") + (extra ? " Unreachable: " + extra : "");
        draw(data.grid || [], data.path || [], null);
        return;
      }
      const order = (data.order || []).map((s) => `${s.kind}(${s.row},${s.col})`).join(" → ");
      stats.textContent = `Steps ${data.steps} · ${order}`;
      const path = data.path || [];
      let i = 0;
      draw(data.grid, path.slice(0, 1), path[0] || null);
      timer = setInterval(() => {
        i += 1;
        if (i >= path.length) {
          clearInterval(timer);
          timer = null;
          draw(data.grid, path, path[path.length - 1] || null);
          return;
        }
        draw(data.grid, path.slice(0, i + 1), path[i]);
      }, 70);
    }

    document.getElementById("solve").addEventListener("click", solve);
    mapSel.addEventListener("change", solve);
    loadMaps().catch((err) => {
      stats.className = "stats error";
      stats.textContent = String(err);
    });
  </script>
</body>
</html>
"""


def list_maps() -> list[str]:
    if not MAPS.is_dir():
        return []
    names = sorted(p.stem for p in MAPS.glob("*.txt"))
    return names


def map_path(name: str) -> Path | None:
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    path = (MAPS / f"{name}.txt").resolve()
    try:
        path.relative_to(MAPS.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys_stdout = __import__("sys").stdout
        sys_stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys_stdout.flush()

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        self._send(
            code,
            json.dumps(payload).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path in ("/", "/index.html"):
            self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
            return
        if path == "/health":
            self._json(200, {"ok": True})
            return
        if path == "/api/maps":
            self._json(200, {"maps": list_maps()})
            return
        if path == "/api/solve":
            qs = parse_qs(parsed.query)
            name = (qs.get("map") or ["small"])[0]
            found = map_path(name)
            if not found:
                self._json(404, {"ok": False, "error": f"Unknown map: {name}"})
                return
            result = solve_text(found.read_text())
            result["map"] = name
            self._json(200, result)
            return
        self._json(404, {"ok": False, "error": "not found"})


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[pathfinder] listening on 0.0.0.0:{PORT}", flush=True)
    print("[pathfinder] GET /health  GET /api/solve?map=small", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
