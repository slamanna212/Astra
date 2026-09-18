"""Benchmark ``GET /api/search`` against a real HERMES_HOME (read-only).

    uv run python scripts/bench_search.py ../exampledata/hermes-home [--iterations 50]

Reports p50/p95 for the raw ``search_messages()`` call (pooled read-only connection, no HTTP/auth
overhead) across several representative queries, including the two words the BUILD-SPEC's own
§0 measurement used ("hermes") and the most common word in English ("the") — the worst case for a
non-selective FTS5 MATCH. Acceptance: p95 well under 1000 ms for every query (§4.5).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from astra.db import StateDB
from astra.search import SearchParams, search_messages

ACCEPT_MS = 1000.0

QUERIES = [
    "the",
    "hermes",
    "config",
    "error",
    "skill",
    "hermes agent configuration",
    'NEAR "quote" (parens) *',
    "",
]


def pct(samples: list[float], q: float) -> float:
    ordered = sorted(samples)
    idx = min(len(ordered) - 1, max(0, round(q / 100 * (len(ordered) - 1))))
    return ordered[idx]


def report(name: str, samples: list[float]) -> bool:
    p50, p95 = pct(samples, 50), pct(samples, 95)
    ok = p95 < ACCEPT_MS
    print(
        f"{name:<45} n={len(samples):<4} p50={p50:8.2f} ms  p95={p95:8.2f} ms  "
        f"max={max(samples):8.2f} ms  [{'PASS' if ok else 'FAIL'} <{ACCEPT_MS:.0f}ms]"
    )
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("hermes_home", type=Path)
    ap.add_argument("--iterations", type=int, default=50)
    args = ap.parse_args()
    db_path = args.hermes_home.resolve() / "state.db"
    if not db_path.is_file():
        print(f"no state.db under {args.hermes_home}", file=sys.stderr)
        return 2
    print(f"state.db: {db_path.stat().st_size / 1e6:.1f} MB")

    db = StateDB(db_path)
    schema = db.introspect()
    all_ok = True
    with db.connection() as conn:
        for q in QUERIES:
            params = SearchParams(q=q, limit=20)
            search_messages(conn, schema, params)  # warm
            samples = []
            hits = 0
            for _ in range(args.iterations):
                t0 = time.perf_counter()
                page = search_messages(conn, schema, params)
                samples.append((time.perf_counter() - t0) * 1000)
                hits = len(page.items)
            ok = report(f"q={q!r} (last page {hits} hits)", samples)
            all_ok = all_ok and ok
    db.close()
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
