"""Read-only access to Hermes' ``state.db``.

Rules (BUILD-SPEC §4.4, §6.9, §10):
* ``file:...?mode=ro`` URI, never ``immutable=1`` (the DB is a live WAL database).
* ``PRAGMA query_only=1`` on every connection as a second guard.
* Queries run in a worker thread, never on the event loop.
* Columns are introspected; code selects only columns that actually exist.

Note on sidecar files: a ``mode=ro`` connection never creates the database file itself, but if the
database is in WAL mode and ``-wal``/``-shm`` are absent, SQLite creates them (they are the WAL
coordination files Hermes itself keeps open while running). A rollback-journal DB gets no sidecars.
"""

from __future__ import annotations

import logging
import queue
import sqlite3
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar
from urllib.parse import quote

import anyio.to_thread

log = logging.getLogger(__name__)

T = TypeVar("T")

INTROSPECTED_TABLES = ("sessions", "messages")


class StateDBUnavailable(RuntimeError):
    """state.db is missing or cannot be opened."""


@dataclass(frozen=True, slots=True)
class Schema:
    columns: dict[str, frozenset[str]]

    def has(self, table: str, column: str) -> bool:
        return column in self.columns.get(table, frozenset())

    def table(self, table: str) -> frozenset[str]:
        return self.columns.get(table, frozenset())


class StateDB:
    """Small pool of read-only SQLite connections, used from worker threads."""

    def __init__(self, path: Path, *, pool_size: int = 4, busy_timeout_s: float = 5.0) -> None:
        self.path = path
        self._pool: queue.LifoQueue[sqlite3.Connection] = queue.LifoQueue(maxsize=pool_size)
        self._busy_timeout_s = busy_timeout_s
        self._schema: Schema | None = None
        self._schema_lock = threading.Lock()
        self._closed = False

    # -- connections -------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        if not self.path.is_file():
            # Checked explicitly so we never even attempt to open a non-existent path.
            raise StateDBUnavailable("state.db not found")
        uri = f"file:{quote(str(self.path))}?mode=ro"
        try:
            conn = sqlite3.connect(
                uri, uri=True, check_same_thread=False, timeout=self._busy_timeout_s
            )
        except sqlite3.Error as exc:
            raise StateDBUnavailable(f"cannot open state.db: {exc}") from exc
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=1")
        return conn

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        """Borrow a connection. Blocking; call only from a worker thread."""
        if self._closed:
            raise StateDBUnavailable("state.db pool is closed")
        try:
            conn = self._pool.get_nowait()
        except queue.Empty:
            conn = self._connect()
        broken = False
        try:
            yield conn
        except sqlite3.DatabaseError as exc:
            # Operational errors like "no such column" leave the connection usable; anything
            # else (corruption, I/O) — drop it and reconnect next time.
            broken = not isinstance(exc, sqlite3.OperationalError)
            raise
        finally:
            if conn.in_transaction:
                conn.rollback()
            if broken or self._closed:
                conn.close()
            else:
                try:
                    self._pool.put_nowait(conn)
                except queue.Full:
                    conn.close()

    def close(self) -> None:
        self._closed = True
        while True:
            try:
                self._pool.get_nowait().close()
            except queue.Empty:
                break

    async def run(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        """Run ``fn(conn)`` in a worker thread with a pooled read-only connection."""

        def _call() -> T:
            with self.connection() as conn:
                return fn(conn)

        return await anyio.to_thread.run_sync(_call)

    # -- schema ------------------------------------------------------------

    def introspect(self) -> Schema:
        """(Re)read column sets for the tables we query. Blocking."""
        with self.connection() as conn:
            columns: dict[str, frozenset[str]] = {}
            for table in INTROSPECTED_TABLES:
                rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
                columns[table] = frozenset(row["name"] for row in rows)
        schema = Schema(columns)
        with self._schema_lock:
            self._schema = schema
        log.info(
            "state.db schema introspected",
            extra={f"{t}_columns": len(c) for t, c in columns.items()},
        )
        return schema

    @property
    def schema(self) -> Schema:
        """Cached schema; introspects lazily (blocking) if not yet loaded."""
        schema = self._schema
        if schema is None:
            schema = self.introspect()
        return schema

    def query_with_schema(self, fn: Callable[[sqlite3.Connection, Schema], T]) -> T:
        """Run ``fn`` with the cached schema; on "no such column" (Hermes upgrade dropped a
        column while we were running) re-introspect once and retry. Blocking."""
        schema = self.schema
        try:
            with self.connection() as conn:
                return fn(conn, schema)
        except sqlite3.OperationalError as exc:
            if "no such column" not in str(exc):
                raise
            log.warning("state.db column set changed; re-introspecting")
            schema = self.introspect()
            with self.connection() as conn:
                return fn(conn, schema)

    async def run_with_schema(self, fn: Callable[[sqlite3.Connection, Schema], T]) -> T:
        return await anyio.to_thread.run_sync(self.query_with_schema, fn)

    # -- health ------------------------------------------------------------

    def ping(self) -> bool:
        """Cheap liveness check. Blocking."""
        try:
            with self.connection() as conn:
                conn.execute("PRAGMA schema_version").fetchone()
            return True
        except (sqlite3.Error, StateDBUnavailable):
            return False
