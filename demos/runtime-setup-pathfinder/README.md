# Warehouse Pathfinder

Python 3, stdlib only. A warehouse floor is a grid: `S` dock, `P` packages, `#` walls, `.` floor. Collect every package and return to the dock.

- Distances: **A\*** (4-connected, Manhattan heuristic)
- Visit order: **Held-Karp** over those distances (exact TSP for the toy maps)

## CLI

```bash
python3 solve.py maps/small.txt
python3 solve.py maps/warehouse.txt
python3 solve.py maps/blocked.txt
```

Exit `0` on a full tour, `1` if a package is unreachable.

## HTTP (for runtime preview)

```bash
python3 app.py
```

- App: http://localhost:8000
- Health: http://localhost:8000/health
- Solve: http://localhost:8000/api/solve?map=small

## Runtime setup (suggested)

| Field | Value |
|---|---|
| Root directory | `.` |
| Runtime | Python 3.12 |
| Install command | _(leave empty — stdlib only)_ |
| Build command | _(leave empty)_ |
| Start command | `python3 app.py` |
| Port | `8000` |
| Health path | `/health` |
| Execution profile | Web server |

Optional env: `PORT=8000`.
