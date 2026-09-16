"""Dev-only stand-in for Hermes' ``hermes_time`` module — see README.md in this directory.

Missing from ``exampledata/hermes-ui-handoff/hermes-agent-src``. The real module resolves
``now()`` against Hermes' *configured* timezone (see ``config.yaml``'s timezone setting);
this shim just uses UTC. That distinction never matters for Astra: the only callers on
Astra's read paths that reach ``_hermes_now()`` are mutating helpers (schedule computation,
job save) that Astra's Phase 1 code never invokes.
"""

from __future__ import annotations

from datetime import datetime, timezone


def now() -> datetime:
    return datetime.now(timezone.utc)
