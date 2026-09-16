"""Tail the three allowlisted Hermes logs (BUILD-SPEC §4.5, §5.8, §10).

**The allowlist is exactly three files**: ``agent.log``, ``errors.log``, ``gateway.log`` under
``$HERMES_HOME/logs``. Anything else — a rotated file (``agent.log.1``), a traversal attempt, an
absolute path — is a 400. This is deliberately minimal (reference: legacy UI's
``_LOG_FILE_WHITELIST`` / ``_handle_logs``, audit §2.7): a log viewer is new read surface, and widening
the allowlist widens what a compromised session can read.

Line format observed in the real logs (``exampledata/hermes-home/logs/*.log``, 2026-09-16)::

    2026-09-15 20:56:08,838 INFO [10e55b1bb794] agent.conversation_loop: API call #96: ...
    2026-09-15 20:55:23,109 WARNING agent.codex_runtime: Codex Responses request failed: ...

i.e. ``YYYY-MM-DD HH:MM:SS,mmm LEVEL [optional-session-id] logger.name: message``. Python
traceback continuation lines (no leading timestamp) follow an entry and are returned as unparsed
raw lines — see :func:`parse_line`.

Tail only: seek from the end and read at most ``MAX_TAIL_BYTES``; never read the whole file (these
rotate at ~5 MB and can have older un-rotated siblings well past that).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from astra.logging import redact

ALLOWED_LOG_FILES: tuple[str, ...] = ("agent.log", "errors.log", "gateway.log")

MAX_TAIL_BYTES = 2 * 1024 * 1024  # 2 MiB hard cap on how much we ever read from disk
MAX_LINES = 5000
DEFAULT_LINES = 200

_LINE_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+"
    r"(?P<level>DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+"
    r"(?:\[(?P<session>[^\]]+)\]\s+)?"
    r"(?P<logger>[A-Za-z0-9_.\-]+):\s?"
    r"(?P<message>.*)$"
)


class InvalidLogFile(ValueError):
    """``file`` is not exactly one of the three allowlisted names."""


class LogNotFound(FileNotFoundError):
    """The allowlisted file does not exist on disk (yet)."""


@dataclass(frozen=True, slots=True)
class LogEntry:
    raw: str
    timestamp: str | None
    level: str | None
    logger: str | None
    session: str | None
    message: str | None


@dataclass(frozen=True, slots=True)
class LogTail:
    file: str
    lines: list[LogEntry]
    truncated: bool
    total_bytes: int
    mtime: float


def resolve_log_path(logs_dir: Path, file: str) -> Path:
    """Resolve ``file`` under ``logs_dir``, enforcing the exact 3-file allowlist.

    Rejects rotated siblings (``agent.log.1``), traversal, absolute paths, and anything not
    byte-for-byte one of :data:`ALLOWED_LOG_FILES`. Also refuses a symlink at the leaf (defense in
    depth — the allowlist alone should make this unreachable, but a compromised/misconfigured
    HERMES_HOME should not be able to redirect a "known-safe" filename elsewhere).
    """
    if file not in ALLOWED_LOG_FILES:
        raise InvalidLogFile(f"unknown log file {file!r}; allowed: {', '.join(ALLOWED_LOG_FILES)}")
    logs_dir_resolved = logs_dir.resolve()
    candidate = logs_dir_resolved / file
    resolved = candidate.resolve()
    if resolved.parent != logs_dir_resolved:
        # Cannot happen given the exact-match allowlist above, but keep the containment check
        # as defense in depth against a future allowlist change.
        raise InvalidLogFile(f"unknown log file {file!r}")
    if candidate.is_symlink():
        raise InvalidLogFile(f"refusing symlinked log file {file!r}")
    return candidate


def parse_line(raw: str) -> LogEntry:
    redacted = redact(raw)
    m = _LINE_RE.match(raw)
    if not m:
        return LogEntry(raw=redacted, timestamp=None, level=None, logger=None, session=None, message=None)
    level = m.group("level")
    if level == "WARN":
        level = "WARNING"
    return LogEntry(
        raw=redacted,
        timestamp=m.group("ts"),
        level=level,
        logger=m.group("logger"),
        session=m.group("session"),
        message=redact(m.group("message")),
    )


def _read_tail_bytes(path: Path, max_bytes: int) -> tuple[bytes, bool, int, float]:
    st = path.stat()
    total_bytes = st.st_size
    read_size = min(max_bytes, total_bytes)
    with path.open("rb") as fh:
        fh.seek(total_bytes - read_size, os.SEEK_SET)
        data = fh.read(read_size)
    truncated_head = read_size < total_bytes
    return data, truncated_head, total_bytes, st.st_mtime


def tail_log(
    logs_dir: Path,
    file: str,
    *,
    lines: int = DEFAULT_LINES,
    level: str | None = None,
    search: str | None = None,
) -> LogTail:
    """Tail ``file``, then filter by ``level``/``search`` server-side on the tailed window only.

    Filtering happens *after* tailing, not instead of it: this stays a bounded tail (never a full
    file scan), so a search on a huge log is still cheap but can legitimately return fewer than
    ``lines`` matches if the match is further back than the byte cap reaches.
    """
    lines = max(1, min(lines, MAX_LINES))
    path = resolve_log_path(logs_dir, file)
    try:
        data, byte_truncated, total_bytes, mtime = _read_tail_bytes(path, MAX_TAIL_BYTES)
    except FileNotFoundError as exc:
        raise LogNotFound(f"{file} does not exist") from exc

    text = data.decode("utf-8", errors="replace")
    raw_lines = text.split("\n")
    # The first line of a byte-seeked read is very likely a partial line; drop it unless we read
    # from the true start of the file.
    if byte_truncated and raw_lines:
        raw_lines = raw_lines[1:]
    if raw_lines and raw_lines[-1] == "":
        raw_lines = raw_lines[:-1]

    entries = [parse_line(ln) for ln in raw_lines]

    level_norm = level.upper() if level else None
    search_norm = search.lower() if search else None
    if level_norm or search_norm:
        filtered = []
        for e in entries:
            if level_norm and (e.level or "").upper() != level_norm:
                continue
            if search_norm and search_norm not in e.raw.lower():
                continue
            filtered.append(e)
        entries = filtered

    window_truncated = byte_truncated or len(entries) > lines
    if len(entries) > lines:
        entries = entries[-lines:]

    return LogTail(file=file, lines=entries, truncated=window_truncated, total_bytes=total_bytes, mtime=mtime)
