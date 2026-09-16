"""Lazy, side-effect-audited access to Hermes' own cron/skills Python modules.

Why lazy: ``astra.config.apply_hermes_src`` must run first (it prepends ``ASTRA_HERMES_SRC``
to ``sys.path`` *and* mirrors our resolved ``hermes_home`` into ``os.environ["HERMES_HOME"]`` —
see its docstring). Several Hermes modules read ``HERMES_HOME`` at *import time* into
module-level constants (``cron/jobs.py``'s ``HERMES_DIR``/``CRON_DIR``/``JOBS_FILE``,
``tools/skills_tool.py``'s ``SKILLS_DIR``), so importing them before that point — e.g. at
``astra.routes.cron`` module load, which happens before ``create_app()`` runs — would freeze
the wrong (platform-default ``~/.hermes``) path. Every function here imports Hermes modules
inside the function body, on first call, so the import always happens after app startup.

Why "side-effect-audited": read endpoints must never mutate Hermes state (BUILD-SPEC §6.9).
Investigation (2026-09-16, see Phase 1 cron/skills report) found:

* ``cron.jobs.load_jobs()`` / ``list_jobs()`` / ``get_job()`` call ``ensure_dirs()``, which
  unconditionally ``chmod 0700``s ``cron/`` and ``cron/output/`` on every call — a metadata-only
  (permission bits, not content) side effect that happens on every real Hermes tick too, so we
  accept it. ``load_jobs()`` can also *rewrite* ``jobs.json`` as an auto-repair path (id-keyed
  map, bare list, or control-character corruption) — never for a well-formed store, but not
  something a browser-facing read should ever risk. We avoid all of this by parsing
  ``jobs.json`` ourselves (plain read, no lock, no repair) and calling only ``cron.jobs``'s pure
  dict-in/dict-out helpers (``_normalize_job_record`` et al. — no I/O) for the exact same
  schedule-display/effective-state logic the scheduler and legacy UI use. See ``cron_data.py``.
* ``cron.executions.list_executions()`` / ``latest_execution(s)()`` open ``executions.db`` with
  a plain (read-write) ``sqlite3.connect`` — no ``mode=ro`` — and re-run
  ``CREATE TABLE/INDEX IF NOT EXISTS`` on *every* call; against a fresh home with no
  ``executions.db`` yet, calling them would create the file. We bypass them entirely and open
  our own ``mode=ro`` connection, mirroring ``astra.db.StateDB``'s pattern.
* ``tools.skills_tool._find_all_skills()`` is in-memory-cache-only (no disk writes) but is tied
  to gateway/session context (project dirs, active org, disabled-set via
  ``hermes_cli.config.load_config()``) that doesn't exist in this process and scans directories
  BUILD-SPEC §4.5 doesn't ask us to (project-local, external skill dirs). We instead list
  ``$HERMES_HOME/skills`` ourselves using Hermes' own frontmatter parser/dir walker
  (``agent.skill_utils.parse_frontmatter`` / ``iter_skill_index_files`` / ``EXCLUDED_SKILL_DIRS``)
  and Hermes' own disabled-skill resolution (``agent.skill_utils.get_disabled_skill_names``),
  which is a pure read of ``config.yaml``. See ``skills_data.py``.

Dev-environment note: ``exampledata/hermes-ui-handoff/hermes-agent-src`` is missing two files
its own ``SOURCES.txt`` lists (``utils.py``, ``hermes_time.py``), which breaks importing
``cron.jobs`` / ``tools.skills_tool`` outright. ``_patch_dev_hermes_gaps()`` below appends
``backend/scripts/dev_hermes_shims`` to ``sys.path`` (never in front of ``ASTRA_HERMES_SRC``)
only when those modules aren't otherwise importable — a no-op against a real Hermes install/
container image. See ``backend/scripts/dev_hermes_shims/README.md``.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import threading
from pathlib import Path
from types import ModuleType

_patch_lock = threading.Lock()
_patched = False

# backend/src/astra/hermes_bridge.py -> backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_DEV_SHIM_DIR = _BACKEND_DIR / "scripts" / "dev_hermes_shims"


def _patch_dev_hermes_gaps() -> None:
    """Append the dev shim dir to ``sys.path`` iff Hermes' own modules aren't importable."""
    global _patched
    if _patched:
        return
    with _patch_lock:
        if _patched:
            return
        missing = [
            name for name in ("utils", "hermes_time") if importlib.util.find_spec(name) is None
        ]
        if missing and _DEV_SHIM_DIR.is_dir():
            shim = str(_DEV_SHIM_DIR)
            if shim not in sys.path:
                sys.path.append(shim)
            importlib.invalidate_caches()
        _patched = True


def _import(name: str) -> ModuleType:
    _patch_dev_hermes_gaps()
    return importlib.import_module(name)


def cron_jobs_module() -> ModuleType:
    """The ``cron.jobs`` module. Import only — never call its I/O functions directly;
    use ``astra.cron_data`` instead, which reads ``jobs.json`` itself and calls only the
    pure normalization helpers this module exposes."""
    return _import("cron.jobs")


def skill_utils_module() -> ModuleType:
    """The ``agent.skill_utils`` module (frontmatter parsing, dir walking, disabled-set)."""
    return _import("agent.skill_utils")


class HermesImportError(RuntimeError):
    """Raised when a required Hermes module cannot be imported."""
