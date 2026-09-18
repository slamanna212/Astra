"""Embedded workspace terminal: one shared PTY shell rooted at the workspace.

Off unless ``ASTRA_TERMINAL_ENABLED`` is set. When enabled it is a real interactive shell running as
the Astra process user — anyone past the login can run any command — so the gate lives in config,
the WebSocket requires the session cookie plus a same-origin ``Origin`` header (see
``astra/middleware.py``), and the shell never inherits Astra's own environment (only an allowlist of
harmless variables, so ``ASTRA_SESSION_SECRET`` / API keys are never visible via ``env``).

Single user, so there is exactly one terminal. It outlives any one viewer: navigating away and back
(or a second tab) re-attaches to the same shell and replays a bounded backlog. A terminal nobody
has watched for ``IDLE_GRACE_S`` is closed, as is everything on shutdown.

Lifecycle ideas (unwatched-grace reaping, bounded replay backlog, per-viewer fan-out that drops the
oldest output for slow viewers, env allowlist) are adapted from
``exampledata/hermes-webui/api/terminal.py`` (MIT — see the notice in ``astra/files.py``), rebuilt on
asyncio instead of reader/spawn threads.
"""

from __future__ import annotations

import asyncio
import contextlib
import errno
import fcntl
import logging
import os
import shutil
import signal
import struct
import subprocess
import termios
import time
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

BACKLOG_BYTES = 256 * 1024
READ_CHUNK = 64 * 1024
# Per-viewer queue bound (chunks). A viewer that falls this far behind loses its oldest output.
VIEWER_QUEUE_MAX = 512
IDLE_GRACE_S = 15 * 60
REAPER_INTERVAL_S = 60.0
MAX_PENDING_INPUT = 1024 * 1024

_SAFE_ENV_KEYS = frozenset(
    {"PATH", "HOME", "USER", "LOGNAME", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "TZ", "TMPDIR", "HERMES_HOME"}
)


class TerminalUnavailable(RuntimeError):
    """The shell could not be started (e.g. missing workspace directory)."""


def clamp_size(rows: int, cols: int) -> tuple[int, int]:
    return max(2, min(int(rows), 500)), max(10, min(int(cols), 1000))


def _shell() -> str:
    for candidate in (os.environ.get("SHELL"), shutil.which("bash"), shutil.which("sh"), "/bin/sh"):
        if candidate and Path(candidate).is_file():
            return candidate
    return "/bin/sh"


def _spawn(cwd: Path, rows: int, cols: int) -> tuple[subprocess.Popen[bytes], int]:
    if not cwd.is_dir():
        raise TerminalUnavailable("workspace directory does not exist")
    master, slave = os.openpty()
    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        env = {k: v for k, v in os.environ.items() if k in _SAFE_ENV_KEYS}
        shell = _shell()
        env.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "SHELL": shell, "PWD": str(cwd)})
        argv = [shell, "-i"] if Path(shell).name in {"bash", "zsh", "sh", "dash"} else [shell]
        # A new session with the pty as its *controlling* terminal gives the shell job control and
        # ^C/^Z delivery. `setsid --ctty` does the TIOCSCTTY after setsid(); Popen has no safe way
        # to (preexec_fn is not thread-safe). Without util-linux, fall back to a plain new session.
        setsid = shutil.which("setsid")
        kwargs: dict[str, object] = {}
        if setsid:
            argv = [setsid, "--ctty", *argv]
        else:
            kwargs["start_new_session"] = True
        proc = subprocess.Popen(  # noqa: S603 - argv is fixed, never user input
            argv,
            cwd=str(cwd),
            env=env,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True,
            **kwargs,  # type: ignore[arg-type]
        )
    except BaseException:
        os.close(master)
        raise
    finally:
        os.close(slave)
    os.set_blocking(master, False)
    return proc, master


@dataclass(eq=False)
class Terminal:
    proc: subprocess.Popen[bytes]
    master_fd: int
    loop: asyncio.AbstractEventLoop
    viewers: set[asyncio.Queue[bytes | None]] = field(default_factory=set)
    backlog: bytearray = field(default_factory=bytearray)
    unwatched_since: float | None = field(default_factory=time.monotonic)
    exit_code: int | None = None
    closed: bool = False
    _pending: bytearray = field(default_factory=bytearray)
    _writer_armed: bool = False

    def start(self) -> None:
        self.loop.add_reader(self.master_fd, self._on_readable)

    @property
    def alive(self) -> bool:
        return not self.closed

    # -- output fan-out -------------------------------------------------------------------------

    def _broadcast(self, item: bytes | None) -> None:
        for q in self.viewers:
            if q.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    q.get_nowait()
            q.put_nowait(item)

    def _on_readable(self) -> None:
        try:
            data = os.read(self.master_fd, READ_CHUNK)
        except BlockingIOError:
            return
        except OSError as exc:
            # EIO is what Linux returns once the shell (the last slave holder) has exited.
            if exc.errno not in (errno.EIO, errno.EBADF):
                log.warning("terminal read failed: %s", exc)
            data = b""
        if not data:
            self.close()
            return
        self.backlog += data
        if len(self.backlog) > BACKLOG_BYTES:
            del self.backlog[: len(self.backlog) - BACKLOG_BYTES]
        self._broadcast(data)

    def attach(self) -> tuple[asyncio.Queue[bytes | None], bytes]:
        q: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=VIEWER_QUEUE_MAX)
        self.viewers.add(q)
        self.unwatched_since = None
        return q, bytes(self.backlog)

    def detach(self, q: asyncio.Queue[bytes | None]) -> None:
        self.viewers.discard(q)
        if not self.viewers:
            self.unwatched_since = time.monotonic()

    # -- input ----------------------------------------------------------------------------------

    def write(self, data: bytes) -> None:
        if self.closed or not data:
            return
        if len(self._pending) + len(data) > MAX_PENDING_INPUT:
            return  # the shell is not reading; drop rather than buffer without bound
        self._pending += data
        self._flush()

    def _flush(self) -> None:
        while self._pending and not self.closed:
            try:
                n = os.write(self.master_fd, self._pending)
            except BlockingIOError:
                break
            except OSError:
                self._pending.clear()
                break
            del self._pending[:n]
        want_writer = bool(self._pending) and not self.closed
        if want_writer and not self._writer_armed:
            self.loop.add_writer(self.master_fd, self._flush)
            self._writer_armed = True
        elif not want_writer and self._writer_armed:
            self.loop.remove_writer(self.master_fd)
            self._writer_armed = False

    def resize(self, rows: int, cols: int) -> None:
        if self.closed:
            return
        rows, cols = clamp_size(rows, cols)
        with contextlib.suppress(OSError):
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    # -- teardown -------------------------------------------------------------------------------

    def close(self) -> None:
        """Stop reading, hang up the shell's process group, and notify viewers. Idempotent."""
        if self.closed:
            return
        self.closed = True
        self.loop.remove_reader(self.master_fd)
        if self._writer_armed:
            self.loop.remove_writer(self.master_fd)
            self._writer_armed = False
        with contextlib.suppress(OSError):
            os.close(self.master_fd)
        if self.proc.poll() is None:
            with contextlib.suppress(OSError, ProcessLookupError):
                os.killpg(self.proc.pid, signal.SIGHUP)
        self.exit_code = self.proc.poll()
        self._broadcast(None)
        # Reap off-loop: a shell ignoring SIGHUP gets SIGKILL after a grace period. During
        # interpreter shutdown the default executor may already be gone; reap inline then.
        try:
            self.loop.run_in_executor(None, _reap, self.proc)
        except RuntimeError:
            _reap(self.proc)


def _reap(proc: subprocess.Popen[bytes]) -> None:
    try:
        proc.wait(timeout=2.0)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(OSError, ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=2.0)


class TerminalManager:
    def __init__(self, cwd: Path) -> None:
        self.cwd = cwd
        self._term: Terminal | None = None
        self._lock = asyncio.Lock()
        self._reaper: asyncio.Task[None] | None = None

    @property
    def current(self) -> Terminal | None:
        return self._term if self._term is not None and self._term.alive else None

    async def get_or_start(self, rows: int, cols: int, *, restart: bool = False) -> Terminal:
        async with self._lock:
            term = self._term
            if term is not None and term.alive and not restart:
                term.resize(rows, cols)
                return term
            if term is not None:
                term.close()
            rows, cols = clamp_size(rows, cols)
            loop = asyncio.get_running_loop()
            proc, master = await loop.run_in_executor(None, _spawn, self.cwd, rows, cols)
            term = Terminal(proc=proc, master_fd=master, loop=loop)
            term.start()
            self._term = term
            if self._reaper is None or self._reaper.done():
                self._reaper = asyncio.create_task(self._reap_idle())
            return term

    def reap_idle(self, now: float | None = None) -> bool:
        term = self._term
        if term is None:
            return False
        now = time.monotonic() if now is None else now
        if term.alive and (term.unwatched_since is None or now - term.unwatched_since < IDLE_GRACE_S):
            return False
        term.close()
        self._term = None
        return True

    async def _reap_idle(self) -> None:
        while self._term is not None:
            await asyncio.sleep(REAPER_INTERVAL_S)
            if self.reap_idle():
                log.info("closed idle workspace terminal")

    async def close(self) -> None:
        if self._reaper is not None:
            self._reaper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reaper
        if self._term is not None:
            self._term.close()
            self._term = None
