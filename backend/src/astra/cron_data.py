"""Read-only cron data: jobs, per-run output files, execution history.

Every function here is a pure read of the filesystem / a read-only SQLite connection.
See ``astra.hermes_bridge`` for why this module never calls ``cron.jobs.load_jobs()``/
``list_jobs()``/``get_job()`` (chmod side effect + auto-repair-writes-jobs.json risk on a
malformed store) or ``cron.executions.list_executions()`` (opens ``executions.db``
read-write and would create it if missing). Instead:

* ``jobs.json`` is parsed directly, then each record is passed through
  ``cron.jobs._normalize_job_record`` — a pure dict-in/dict-out helper with no I/O — to get
  the exact schedule-display / effective-state / skill-list normalization the scheduler and
  legacy UI use, without touching disk beyond the one read.
* ``executions.db`` is opened with our own ``mode=ro`` connection (mirrors ``astra.db.StateDB``).
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from astra.hermes_bridge import cron_jobs_module

# job ids are uuid4 hex (see cron/jobs.py `uuid.uuid4().hex[:12]`-style ids in practice) —
# validated defensively before ever using one as a path component.
_SAFE_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_SAFE_OUTPUT_FILENAME = re.compile(r"^[A-Za-z0-9_.-]{1,255}\.md$")

MAX_OUTPUT_BYTES = 2 * 1024 * 1024  # 2 MiB cap on a single run's markdown


class InvalidJobId(ValueError):
    pass


class InvalidOutputRun(ValueError):
    pass


def is_safe_job_id(job_id: str) -> bool:
    return bool(_SAFE_JOB_ID.match(job_id))


def _raw_jobs(jobs_path: Path) -> list[dict]:
    """Parse ``jobs.json`` without any of ``cron.jobs.load_jobs()``'s side effects.

    Mirrors its shape-tolerance (accepts ``{"jobs": [...]}`` or a bare list) but never
    writes anything back, even for a shape ``load_jobs()`` would "auto-repair".
    """
    if not jobs_path.is_file():
        return []
    try:
        data = json.loads(jobs_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, dict):
        jobs = data.get("jobs", [])
    elif isinstance(data, list):
        jobs = data
    else:
        return []
    if isinstance(jobs, dict):
        # Legacy id-keyed map shape — flatten in-memory only (load_jobs() would save this
        # back; we never do).
        jobs = [{**v, "id": v.get("id") or k} for k, v in jobs.items() if isinstance(v, dict)]
    return [j for j in jobs if isinstance(j, dict)]


def _normalize(raw: dict) -> dict:
    cj = cron_jobs_module()
    return cj._normalize_job_record(dict(raw))  # noqa: SLF001 — the documented pure helper


def list_jobs(jobs_path: Path) -> list[dict]:
    """All jobs (including disabled/paused), normalized. Newest-created first."""
    jobs = [_normalize(j) for j in _raw_jobs(jobs_path)]
    jobs.sort(key=lambda j: j.get("created_at") or "", reverse=True)
    return jobs


def get_job(jobs_path: Path, job_id: str) -> dict | None:
    for raw in _raw_jobs(jobs_path):
        if str(raw.get("id")) == job_id:
            return _normalize(raw)
    return None


# ── executions.db (read-only) ──────────────────────────────────────────────


def _connect_ro(path: Path) -> sqlite3.Connection | None:
    if not path.is_file():
        return None
    uri = f"file:{quote(str(path))}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
    except sqlite3.Error:
        return None
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=1")
    return conn


def latest_executions(executions_db: Path, job_ids: list[str]) -> dict[str, dict]:
    """Latest execution row per job id, or ``{}`` if the DB doesn't exist yet."""
    clean = [str(j) for j in dict.fromkeys(job_ids) if j]
    if not clean:
        return {}
    conn = _connect_ro(executions_db)
    if conn is None:
        return {}
    try:
        placeholders = ",".join("?" for _ in clean)
        rows = conn.execute(
            f"""SELECT e.* FROM executions e
                WHERE e.job_id IN ({placeholders})
                  AND e.id = (SELECT e2.id FROM executions e2
                              WHERE e2.job_id = e.job_id
                              ORDER BY e2.claimed_at DESC, e2.id DESC LIMIT 1)""",
            clean,
        ).fetchall()
        return {row["job_id"]: dict(row) for row in rows}
    except sqlite3.Error:
        return {}
    finally:
        conn.close()


def list_executions(
    executions_db: Path, job_id: str, *, limit: int = 50, before_claimed_at: str | None = None
) -> list[dict]:
    conn = _connect_ro(executions_db)
    if conn is None:
        return []
    try:
        clauses = ["job_id = ?"]
        params: list[object] = [job_id]
        if before_claimed_at:
            clauses.append("claimed_at < ?")
            params.append(before_claimed_at)
        params.append(max(1, min(int(limit), 500)))
        rows = conn.execute(
            "SELECT * FROM executions WHERE " + " AND ".join(clauses)
            + " ORDER BY claimed_at DESC, id DESC LIMIT ?",
            params,
        ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.Error:
        return []
    finally:
        conn.close()


# ── output/<job_id>/*.md ────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class OutputRun:
    filename: str
    size_bytes: int
    mtime: float


def job_output_dir(output_root: Path, job_id: str) -> Path:
    if not is_safe_job_id(job_id):
        raise InvalidJobId(job_id)
    candidate = (output_root / job_id).resolve()
    if not candidate.is_relative_to(output_root.resolve()):
        raise InvalidJobId(job_id)
    return candidate


def list_outputs(
    output_root: Path, job_id: str, *, limit: int = 50, cursor: str | None = None
) -> tuple[list[OutputRun], str | None]:
    """List ``*.md`` run files for a job, newest filename first (filenames are
    ``YYYY-MM-DD_HH-MM-SS.md``, so lexicographic order is chronological)."""
    job_dir = job_output_dir(output_root, job_id)
    if not job_dir.is_dir():
        return [], None
    runs: list[OutputRun] = []
    for entry in job_dir.iterdir():
        if not entry.is_file() or entry.is_symlink() or not _SAFE_OUTPUT_FILENAME.match(entry.name):
            continue
        try:
            st = entry.stat()
        except OSError:
            continue
        runs.append(OutputRun(filename=entry.name, size_bytes=st.st_size, mtime=st.st_mtime))
    runs.sort(key=lambda r: r.filename, reverse=True)
    if cursor:
        runs = [r for r in runs if r.filename < cursor]
    page = runs[:limit]
    next_cursor = page[-1].filename if len(page) == limit and len(runs) > limit else None
    return page, next_cursor


def read_output(output_root: Path, job_id: str, run: str) -> str:
    """Read one run's markdown. Raises InvalidOutputRun for anything not a plain,
    existing, non-symlinked ``*.md`` file directly inside that job's output dir."""
    if not _SAFE_OUTPUT_FILENAME.match(run) or "/" in run or ".." in run:
        raise InvalidOutputRun(run)
    job_dir = job_output_dir(output_root, job_id)
    candidate = (job_dir / run).resolve()
    if not candidate.is_relative_to(job_dir) or not candidate.is_file():
        raise InvalidOutputRun(run)
    if candidate.is_symlink():
        raise InvalidOutputRun(run)
    data = candidate.read_bytes()
    if len(data) > MAX_OUTPUT_BYTES:
        data = data[:MAX_OUTPUT_BYTES]
    return data.decode("utf-8", errors="replace")


# ── jobs.json change signal (for SSE) ───────────────────────────────────────


def jobs_file_stamp(jobs_path: Path) -> tuple[int, int] | None:
    try:
        st = jobs_path.stat()
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None
