"""Structured JSON-lines logging to stdout with secret redaction.

Inside this package ``import logging`` still resolves to the stdlib (absolute imports).
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from typing import Any

REDACTED = "[REDACTED]"

_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Authorization: Bearer xxx / Basic xxx
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9\-._~+/]+=*"), r"\1 " + REDACTED),
    # Provider-style keys: sk-..., sk-or-v1-..., sk-ant-...
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}"), REDACTED),
    # key=value / key: value / "key": "value" for secret-ish key names
    (
        re.compile(
            r"(?i)(\"?\b(?:[\w\-]*[_\-])?(?:api[_-]?key|apikey|key|secret|token|password|passwd|"
            r"pwd|authorization|cookie|credentials?)\"?\s*[=:]\s*\"?)([^\s\"&,;}]+)"
        ),
        r"\1" + REDACTED,
    ),
    # scrypt password hashes
    (re.compile(r"scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=_\-]+\$[A-Za-z0-9+/=_\-]+"), REDACTED),
    # Long hex strings (>= 32 chars)
    (re.compile(r"\b[0-9a-fA-F]{32,}\b"), REDACTED),
    # Long base64 / base64url blobs (>= 40 chars)
    (re.compile(r"[A-Za-z0-9+/_\-]{40,}={0,2}"), REDACTED),
]


def redact(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


_RESERVED = set(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_") or key == "color_message":
                continue
            if isinstance(value, (int, float, bool)) or value is None:
                payload[key] = value
            else:
                payload[key] = redact(str(value))
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str = "INFO") -> None:
    """Route root + uvicorn loggers through one JSON handler on stdout."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
