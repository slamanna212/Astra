"""Dev-only stand-in for Hermes' top-level ``utils`` module — see README.md in this directory.

Missing from ``exampledata/hermes-ui-handoff/hermes-agent-src``. Implements only the symbols
imported by the handful of Hermes modules Astra's read-only cron/skills endpoints touch
(``cron/jobs.py``, ``hermes_cli/config.py``, ``tools/skills_tool.py``). Astra never calls the
mutating functions that would actually exercise ``atomic_replace``/``atomic_write_text`` (job
save, config write) — they're defined only so importing those modules doesn't fail.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path
from typing import Any


def atomic_replace(src: str | Path, dst: str | Path) -> None:
    os.replace(src, dst)


def atomic_write_text(path: str | Path, text: str, encoding: str = "utf-8") -> None:
    path = Path(path)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        atomic_replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def fast_safe_load(stream: Any) -> Any:
    import yaml

    return yaml.safe_load(stream)


def env_var_enabled(name: str, default: bool = False) -> bool:
    val = os.environ.get(name)
    if val is None or val.strip() == "":
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}
