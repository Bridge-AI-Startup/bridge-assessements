"""Grid pathfinding: A* between cells, Held-Karp tour over packages."""

from __future__ import annotations

from heapq import heappop, heappush
from typing import Iterable

WALL = "#"
START = "S"
PACKAGE = "P"
FLOOR = "."

INF = 10**9
Point = tuple[int, int]


def parse_grid(text: str) -> list[list[str]]:
    rows = [list(line.rstrip("\n")) for line in text.splitlines() if line.strip()]
    if not rows:
        raise ValueError("Map is empty.")
    width = max(len(r) for r in rows)
    if any(len(r) != width for r in rows):
        rows = [r + [FLOOR] * (width - len(r)) for r in rows]
    return rows


def find_cells(grid: list[list[str]], ch: str) -> list[Point]:
    found: list[Point] = []
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if cell == ch:
                found.append((r, c))
    return found


def walkable(grid: list[list[str]], p: Point) -> bool:
    r, c = p
    if r < 0 or c < 0 or r >= len(grid) or c >= len(grid[0]):
        return False
    return grid[r][c] != WALL


def neighbors(grid: list[list[str]], p: Point) -> Iterable[Point]:
    r, c = p
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nxt = (r + dr, c + dc)
        if walkable(grid, nxt):
            yield nxt


def manhattan(a: Point, b: Point) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def astar(grid: list[list[str]], start: Point, goal: Point) -> list[Point] | None:
    if start == goal:
        return [start]
    if not walkable(grid, start) or not walkable(grid, goal):
        return None

    open_heap: list[tuple[int, int, Point]] = []
    heappush(open_heap, (manhattan(start, goal), 0, start))
    came: dict[Point, Point] = {}
    gscore: dict[Point, int] = {start: 0}
    closed: set[Point] = set()
    seq = 0

    while open_heap:
        _, _, current = heappop(open_heap)
        if current in closed:
            continue
        if current == goal:
            return _reconstruct(came, current)
        closed.add(current)
        for nxt in neighbors(grid, current):
            tentative = gscore[current] + 1
            if tentative >= gscore.get(nxt, INF):
                continue
            came[nxt] = current
            gscore[nxt] = tentative
            seq += 1
            heappush(
                open_heap,
                (tentative + manhattan(nxt, goal), seq, nxt),
            )
    return None


def _reconstruct(came: dict[Point, Point], current: Point) -> list[Point]:
    path = [current]
    while current in came:
        current = came[current]
        path.append(current)
    path.reverse()
    return path


def stitch(segments: list[list[Point]]) -> list[Point]:
    out: list[Point] = []
    for seg in segments:
        if not seg:
            continue
        if out and out[-1] == seg[0]:
            out.extend(seg[1:])
        else:
            out.extend(seg)
    return out


def shortest_tour(grid: list[list[str]]) -> dict:
    starts = find_cells(grid, START)
    if len(starts) != 1:
        return {
            "ok": False,
            "error": f"Map needs exactly one S, found {len(starts)}.",
            "path": [],
            "steps": 0,
            "order": [],
            "unreachable": [],
        }

    start = starts[0]
    packages = find_cells(grid, PACKAGE)
    nodes = [start, *packages]
    n = len(nodes)

    dist: list[list[int | None]] = [[None] * n for _ in range(n)]
    hops: list[list[list[Point] | None]] = [[None] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                dist[i][j] = 0
                hops[i][j] = [nodes[i]]
                continue
            p = astar(grid, nodes[i], nodes[j])
            if p is None:
                continue
            dist[i][j] = len(p) - 1
            hops[i][j] = p

    unreachable = [
        {"row": r, "col": c}
        for i, (r, c) in enumerate(packages, start=1)
        if dist[0][i] is None
    ]
    if unreachable:
        return {
            "ok": False,
            "error": "One or more packages cannot be reached from the dock.",
            "path": hops[0][0] or [start],
            "steps": 0,
            "order": [_label(start, "S")],
            "unreachable": unreachable,
        }

    if n == 1:
        return {
            "ok": True,
            "error": None,
            "path": [start],
            "steps": 0,
            "order": [_label(start, "S")],
            "unreachable": [],
        }

    n_pkg = n - 1
    full = (1 << n_pkg) - 1
    dp = [[INF] * n for _ in range(1 << n_pkg)]
    parent = [[-1] * n for _ in range(1 << n_pkg)]

    for j in range(1, n):
        d = dist[0][j]
        if d is None:
            continue
        mask = 1 << (j - 1)
        dp[mask][j] = d

    for mask in range(1 << n_pkg):
        for j in range(1, n):
            if not (mask & (1 << (j - 1))):
                continue
            if dp[mask][j] >= INF:
                continue
            for k in range(1, n):
                bit = 1 << (k - 1)
                if mask & bit:
                    continue
                d = dist[j][k]
                if d is None:
                    continue
                new_mask = mask | bit
                cost = dp[mask][j] + d
                if cost < dp[new_mask][k]:
                    dp[new_mask][k] = cost
                    parent[new_mask][k] = j

    best = INF
    end = -1
    for j in range(1, n):
        d = dist[j][0]
        if d is None or dp[full][j] >= INF:
            continue
        cost = dp[full][j] + d
        if cost < best:
            best = cost
            end = j

    if end < 0:
        return {
            "ok": False,
            "error": "No tour returns to the dock.",
            "path": [start],
            "steps": 0,
            "order": [_label(start, "S")],
            "unreachable": [],
        }

    order_idx = []
    mask = full
    node = end
    while node != -1:
        order_idx.append(node)
        prev = parent[mask][node]
        if prev == -1:
            break
        mask ^= 1 << (node - 1)
        node = prev
    order_idx.reverse()
    order_idx = [0, *order_idx, 0]

    segments = [hops[a][b] or [] for a, b in zip(order_idx, order_idx[1:])]
    path = stitch(segments)
    order = [_label(nodes[i], "S" if i == 0 else "P") for i in order_idx]

    return {
        "ok": True,
        "error": None,
        "path": path,
        "steps": len(path) - 1 if path else 0,
        "order": order,
        "unreachable": [],
    }


def _label(p: Point, kind: str) -> dict:
    return {"kind": kind, "row": p[0], "col": p[1]}


def render_ascii(grid: list[list[str]], path: list[Point] | None = None) -> str:
    marks = set(path or [])
    starts = set(find_cells(grid, START))
    pkgs = set(find_cells(grid, PACKAGE))
    lines = []
    for r, row in enumerate(grid):
        cells = []
        for c, ch in enumerate(row):
            p = (r, c)
            if p in starts:
                cells.append("S")
            elif p in pkgs:
                cells.append("P")
            elif p in marks:
                cells.append("*")
            else:
                cells.append(ch)
        lines.append("".join(cells))
    return "\n".join(lines)


def solve_text(text: str) -> dict:
    grid = parse_grid(text)
    result = shortest_tour(grid)
    result["grid"] = ["".join(row) for row in grid]
    result["ascii"] = render_ascii(grid, result.get("path") or [])
    result["rows"] = len(grid)
    result["cols"] = len(grid[0]) if grid else 0
    result["packageCount"] = len(find_cells(grid, PACKAGE))
    result["path"] = [{"row": r, "col": c} for r, c in result.get("path") or []]
    return result
