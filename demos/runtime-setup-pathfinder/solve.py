#!/usr/bin/env python3
"""CLI: python3 solve.py maps/small.txt"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pathfinder import solve_text

ROOT = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect every package and return to the dock.")
    parser.add_argument(
        "map",
        nargs="?",
        default=str(ROOT / "maps" / "small.txt"),
        help="Path to a grid map (default: maps/small.txt)",
    )
    args = parser.parse_args()
    path = Path(args.map)
    if not path.exists():
        print(f"Map not found: {path}", file=sys.stderr)
        return 2

    result = solve_text(path.read_text())
    print(f"Map: {path}")
    print(f"Packages: {result['packageCount']}")
    if result["order"]:
        order = " -> ".join(
            f"{stop['kind']}({stop['row']},{stop['col']})" for stop in result["order"]
        )
        print(f"Order: {order}")
    print(f"Steps: {result['steps']}")
    if result["ok"]:
        print("Status: solved (Held-Karp over A* distances)")
    else:
        print(f"Status: failed — {result['error']}")
        if result.get("unreachable"):
            spots = ", ".join(
                f"({u['row']},{u['col']})" for u in result["unreachable"]
            )
            print(f"Unreachable: {spots}")
    print()
    print(result["ascii"])
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
