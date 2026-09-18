"""Authorization helpers for local images referenced by Hermes ``MEDIA:`` tokens."""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from astra.db import Schema

MEDIA_TOKEN_RE = re.compile(r"MEDIA:\s*([^\s\)\]>`\"']+)")


def session_allows_media_path(
    conn: sqlite3.Connection, schema: Schema, session_id: str, target: Path
) -> bool:
    """Return whether a non-user message in ``session_id`` emitted this exact local path.

    User-authored tokens cannot grant access.  The endpoint separately restricts responses to
    raster image MIME types, so this allow-list never exposes arbitrary transcript-referenced
    files.
    """

    columns = schema.table("messages")
    if not {"session_id", "role", "content"}.issubset(columns):
        return False
    try:
        resolved_target = target.expanduser().resolve(strict=False)
    except (OSError, RuntimeError):
        return False

    rows = conn.execute(
        "SELECT content FROM messages WHERE session_id = ? "
        "AND LOWER(COALESCE(role, '')) != 'user' AND content LIKE '%MEDIA:%'",
        (session_id,),
    ).fetchall()
    for row in rows:
        content = row[0]
        if not isinstance(content, str):
            continue
        for match in MEDIA_TOKEN_RE.finditer(content):
            ref = match.group(1)
            if "://" in ref:
                continue
            try:
                if Path(ref).expanduser().resolve(strict=False) == resolved_target:
                    return True
            except (OSError, RuntimeError):
                continue
    return False
