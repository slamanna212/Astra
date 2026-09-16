"""Benchmark GET /api/insights against a real HERMES_HOME (read-only).

    uv run python scripts/bench_insights.py ../exampledata/hermes-home [--iterations 50]

Reports p50/p95 for (1) the raw ``build_insights`` aggregation on a pooled read-only connection
and (2) the full HTTP endpoint through httpx's ASGI transport, for both ``days=30`` and
``days=all``. No hard latency budget is asserted (unlike bench_sessions.py's 50ms/50-rows target)
since this endpoint scans the whole `sessions` + `session_model_usage` window rather than a fixed
page — but it must stay comfortably sub-second on the real DB, since it's a dashboard fetched on
navigation, not a per-keystroke query.
"""

from __future__ import annotations

import argparse
import asyncio
import secrets
import statistics
import sys
import time
from pathlib import Path

import httpx

from astra.app import create_app
from astra.auth import hash_password
from astra.config import Settings
from astra.db import StateDB
from astra.insights import build_insights

ACCEPT_MS = 1000.0


def pct(samples: list[float], q: float) -> float:
    ordered = sorted(samples)
    idx = min(len(ordered) - 1, max(0, round(q / 100 * (len(ordered) - 1))))
    return ordered[idx]


def report(name: str, samples: list[float]) -> bool:
    p50, p95 = pct(samples, 50), pct(samples, 95)
    ok = p95 < ACCEPT_MS
    print(
        f"{name:<38} n={len(samples):<4} p50={p50:8.2f} ms  p95={p95:8.2f} ms  "
        f"max={max(samples):8.2f} ms  mean={statistics.fmean(samples):8.2f} ms  "
        f"[{'PASS' if ok else 'FAIL'} <{ACCEPT_MS:.0f}ms]"
    )
    return ok


def bench_sql(db_path: Path, iterations: int, days: str) -> bool:
    db = StateDB(db_path)
    schema = db.introspect()
    with db.connection() as conn:
        report_obj = build_insights(conn, schema, days=days, tz="UTC")  # warm page cache
        print(
            f"  days={days:<4} sessions={report_obj.totals.sessions:<5} "
            f"daily_points={len(report_obj.daily):<5} models={len(report_obj.models):<3} "
            f"top_sessions={len(report_obj.top_sessions)}"
        )
        samples = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            build_insights(conn, schema, days=days, tz="UTC")
            samples.append((time.perf_counter() - t0) * 1000)
    db.close()
    return report(f"SQL build_insights(days={days})", samples)


async def bench_http(home: Path, iterations: int, days: str) -> bool:
    password = secrets.token_urlsafe(16)
    settings = Settings.from_env(
        {
            "HERMES_HOME": str(home),
            "ASTRA_PASSWORD_HASH": hash_password(password, n=2**14),
            "ASTRA_SESSION_SECRET": secrets.token_urlsafe(48),
            "ASTRA_COOKIE_SECURE": "false",
            "ASTRA_STATIC_DIR": str(home / ".nonexistent-static"),
        }
    )
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://bench") as client:
        r = await client.post(
            "/api/auth/login", json={"password": password}, headers={"X-Requested-With": "astra"}
        )
        r.raise_for_status()

        resp = await client.get("/api/insights", params={"days": days})
        resp.raise_for_status()

        samples = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            resp = await client.get("/api/insights", params={"days": days})
            samples.append((time.perf_counter() - t0) * 1000)
            assert resp.status_code == 200
    app.state.ctx.db.close()
    return report(f"HTTP GET /api/insights?days={days}", samples)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("hermes_home", type=Path)
    ap.add_argument("--iterations", type=int, default=50)
    args = ap.parse_args()
    home = args.hermes_home.resolve()
    db_path = home / "state.db"
    if not db_path.is_file():
        print(f"no state.db under {home}", file=sys.stderr)
        return 2
    print(f"state.db: {db_path.stat().st_size / 1e6:.1f} MB")

    ok = True
    for days in ("30", "all"):
        ok = bench_sql(db_path, args.iterations, days) and ok
        ok = asyncio.run(bench_http(home, args.iterations, days)) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
