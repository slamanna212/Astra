"""Change-signal broadcaster for ``cron/jobs.json`` (BUILD-SPEC §6.5: push, not poll).

One shared background task does a cheap ``stat()`` on an interval and fans a "jobs-changed"
event out to every subscribed browser only when the file's (mtime_ns, size) actually changes —
never a fixed-interval poll visible to clients, and never more than one stat per tick no matter
how many browsers are subscribed.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from pathlib import Path

import anyio.to_thread

from astra.cron_data import jobs_file_stamp

log = logging.getLogger(__name__)


class CronEventBroadcaster:
    def __init__(self, jobs_path: Path, *, poll_interval_s: float = 1.0) -> None:
        self._path = jobs_path
        self._interval = poll_interval_s
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._task: asyncio.Task[None] | None = None
        self._last_stamp: tuple[int, int] | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._last_stamp = await anyio.to_thread.run_sync(jobs_file_stamp, self._path)
        self._task = asyncio.create_task(self._run(), name="cron-events-watcher")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        try:
            while True:
                await asyncio.sleep(self._interval)
                stamp = await anyio.to_thread.run_sync(jobs_file_stamp, self._path)
                if stamp != self._last_stamp:
                    self._last_stamp = stamp
                    self._broadcast()
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover — defensive: a watcher crash must not take the app down
            log.exception("cron events watcher crashed")

    def _broadcast(self) -> None:
        for queue in list(self._subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait("jobs-changed")

    @contextlib.asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[str]]:
        await self.start()
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=8)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)
