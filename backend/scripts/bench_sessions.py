"""Benchmark the 50-row session list against a real HERMES_HOME (read-only).

    uv run python scripts/bench_sessions.py ../exampledata/hermes-home [--iterations 200]

Reports p50/p95 for (1) the raw SQL query on a pooled read-only connection and (2) the full
HTTP endpoint through httpx's ASGI transport (auth middleware, threadpool hop, serialization).
Also walks every page to verify counts and prints the query plan. Acceptance: < 50 ms for 50 rows.
"""

from __future__ import annotations

import argparse
import asyncio
import secrets
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

import httpx

from astra.app import create_app
from astra.auth import hash_password
from astra.config import Settings
from astra.db import StateDB
from astra.sessions import ListParams, build_list_query, list_sessions

ACCEPT_MS = 50.0


def pct(samples: list[float], q: float) -> float:
    ordered = sorted(samples)
    idx = min(len(ordered) - 1, max(0, round(q / 100 * (len(ordered) - 1))))
    return ordered[idx]


def report(name: str, samples: list[float]) -> bool:
    p50, p95 = pct(samples, 50), pct(samples, 95)
    ok = p95 < ACCEPT_MS
    print(
        f"{name:<34} n={len(samples):<4} p50={p50:7.2f} ms  p95={p95:7.2f} ms  "
        f"max={max(samples):7.2f} ms  mean={statistics.fmean(samples):7.2f} ms  "
        f"[{'PASS' if ok else 'FAIL'} <{ACCEPT_MS:.0f}ms]"
    )
    return ok


def bench_sql(db_path: Path, iterations: int) -> bool:
    db = StateDB(db_path)
    schema = db.introspect()
    params = ListParams(limit=50)
    sql, args = build_list_query(schema, params)
    with db.connection() as conn:
        plan = [r["detail"] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, args)]
        indexes = [r["name"] for r in conn.execute("PRAGMA index_list(sessions)")]
        list_sessions(conn, schema, params)  # warm page cache
        samples = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            items, _ = list_sessions(conn, schema, params)
            samples.append((time.perf_counter() - t0) * 1000)
    db.close()
    print(f"sessions indexes: {', '.join(indexes)}")
    print("query plan:", " | ".join(plan))
    return report("SQL list_sessions(limit=50)", samples)


async def bench_http(home: Path, iterations: int) -> bool:
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

        # Walk everything first (also warms up).
        seen: list[dict] = []
        cursor = None
        while True:
            params: dict = {"limit": 50, "include_archived": "true", "include_hidden": "true"}
            if cursor:
                params["cursor"] = cursor
            body = (await client.get("/api/sessions", params=params)).json()
            seen.extend(body["items"])
            cursor = body["next_cursor"]
            if not cursor:
                break
        ids = [s["id"] for s in seen]
        print(
            f"walked all pages: {len(ids)} sessions, {len(set(ids))} unique; sources: "
            + ", ".join(f"{k}={v}" for k, v in sorted(Counter(s['source'] for s in seen).items()))
        )
        default_total = 0
        cursor = None
        while True:
            params = {"limit": 50}
            if cursor:
                params["cursor"] = cursor
            body = (await client.get("/api/sessions", params=params)).json()
            default_total += len(body["items"])
            cursor = body["next_cursor"]
            if not cursor:
                break
        print(f"default view (no archived/hidden): {default_total} sessions")

        samples = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            resp = await client.get("/api/sessions", params={"limit": 50})
            samples.append((time.perf_counter() - t0) * 1000)
            assert resp.status_code == 200 and len(resp.json()["items"]) == 50
    app.state.ctx.db.close()
    return report("HTTP GET /api/sessions?limit=50", samples)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("hermes_home", type=Path)
    ap.add_argument("--iterations", type=int, default=200)
    args = ap.parse_args()
    home = args.hermes_home.resolve()
    db_path = home / "state.db"
    if not db_path.is_file():
        print(f"no state.db under {home}", file=sys.stderr)
        return 2
    print(f"state.db: {db_path.stat().st_size / 1e6:.1f} MB")
    ok_sql = bench_sql(db_path, args.iterations)
    ok_http = asyncio.run(bench_http(home, args.iterations))
    return 0 if ok_sql and ok_http else 1


if __name__ == "__main__":
    raise SystemExit(main())
