"""Native Hermes profile registry and Bots presentation.

Deliberately imports **no** Hermes module: this module runs in the gateway process, which
must never resolve a profile-bound ``HERMES_HOME``. Anything that needs Hermes' own rules
(create/clone/delete, model pins) runs through ``astra.profile_admin`` in a short-lived
subprocess with the *base* home in its environment.

Semantics mirrored from the shipped desktop/gateway implementation
(``tui_gateway/methods_profiles.py`` + ``hermes_cli/profiles.py``):

* a profile is a directory under ``<base>/profiles/<name>`` carrying an identity file
  (``config.yaml``, ``profile.yaml``, ``.env``, ``SOUL.md``, ``auth.json`` or ``state.db``);
* Bot presentation lives in ``profile.yaml`` ``ui_meta['hermes-bots']`` (``title``,
  ``hidden``, ``section``) plus ``assets/avatar.<ext>``;
* the canonical Bot Chat is the session titled exactly ``Bot Chat`` — its name is its
  identity, it is created hidden and pinned, and an archived one is "retired".
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

PROFILE_ID_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
BOT_UI_KEY = "hermes-bots"
CANONICAL_BOT_CHAT_TITLE = "Bot Chat"
BOT_CHAT_SOURCE = "bot_peer_dm"

# Native asset contract: one file per asset, format sniffed (never the declared MIME).
AVATAR_EXTS: dict[str, str] = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
AVATAR_MAGIC: dict[str, list[tuple[int, int, bytes]]] = {
    "png": [(0, 8, b"\x89PNG\r\n\x1a\n")],
    "jpg": [(0, 3, b"\xff\xd8\xff")],
    "webp": [(0, 4, b"RIFF"), (8, 12, b"WEBP")],
}
MAX_AVATAR_BYTES = 2_000_000
MAX_PROFILE_DOC_BYTES = 2 * 1024 * 1024
IDENTITY_FILES = ("config.yaml", "profile.yaml", ".env", "SOUL.md", "auth.json", "state.db")

_ui_meta_lock = threading.Lock()
_admin_runner: Any = None  # test seam: callable(op: dict) -> dict


def profile_root(settings) -> Path:
    """The base Hermes home — the directory that contains ``profiles/``."""
    return Path(settings.hermes_home)


def profiles_dir(root: Path) -> Path:
    return root / "profiles"


def valid_name(name: str) -> bool:
    return bool(name) and bool(PROFILE_ID_RE.fullmatch(name))


def _inside(base: Path, candidate: Path) -> bool:
    try:
        return candidate.resolve(strict=False).is_relative_to(base.resolve())
    except OSError:  # pragma: no cover - unresolvable path
        return False


def profile_home(root: Path, name: str) -> Path:
    """Validated home for an existing profile, or ``404``. Never returns a tombstone."""
    if not valid_name(name):
        raise HTTPException(status_code=404, detail="Profile not found")
    if name == "default":
        return root
    base = profiles_dir(root)
    home = base / name
    if home.is_symlink() or not _inside(base, home):
        raise HTTPException(status_code=404, detail="Profile not found")
    try:
        resolved = home.resolve(strict=False)
    except OSError:  # pragma: no cover
        raise HTTPException(status_code=404, detail="Profile not found") from None
    if resolved != (base.resolve() / name) or not resolved.is_dir():
        raise HTTPException(status_code=404, detail="Profile not found")
    if not any((resolved / item).is_file() for item in IDENTITY_FILES):
        raise HTTPException(status_code=404, detail="Profile not found")
    return resolved


def profile_names(root: Path) -> list[str]:
    """Existing profiles, ``default`` first. A bare directory (logs, cron leftovers) is not one."""
    names = ["default"]
    base = profiles_dir(root)
    if not base.is_dir():
        return names
    for item in sorted(base.iterdir(), key=lambda entry: entry.name.lower()):
        if item.name == "default" or item.name.startswith("."):
            continue
        try:
            profile_home(root, item.name)
        except HTTPException:
            continue
        names.append(item.name)
    return names


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        if path.stat().st_size > MAX_PROFILE_DOC_BYTES:
            raise HTTPException(status_code=409, detail="Profile document too large")
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError, UnicodeDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def read_meta(home: Path) -> dict[str, Any]:
    return _read_yaml(home / "profile.yaml")


def read_config(home: Path) -> dict[str, Any]:
    """``config.yaml`` mapping. Never returned to a client — callers project named keys only."""
    return _read_yaml(home / "config.yaml")


def bot_ui(meta: dict[str, Any]) -> dict[str, Any]:
    ui = meta.get("ui_meta")
    bots = ui.get(BOT_UI_KEY) if isinstance(ui, dict) else None
    return bots if isinstance(bots, dict) else {}


def _atomic_write_yaml(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def write_bot_ui(home: Path, incoming: dict[str, Any]) -> dict[str, int]:
    """Merge Bot presentation keys into ``profile.yaml`` (``None`` deletes), native CAS layout.

    Returns the resulting revision for each touched key. Mirrors
    ``tui_gateway.methods_profiles._configure_ui_meta``: a per-key revision counter,
    bumped on every write, survives deletion so a stale client cannot resurrect a key.
    """
    if len(json.dumps(incoming)) > 65536:
        raise HTTPException(status_code=422, detail="Bot presentation metadata is too large")
    with _ui_meta_lock:
        existing = read_meta(home)
        revisions = existing.get("_ui_meta_revisions")
        revisions = (
            {str(k): max(0, int(v)) for k, v in revisions.items() if isinstance(v, int) and not isinstance(v, bool)}
            if isinstance(revisions, dict)
            else {}
        )
        current = existing.get("ui_meta")
        current = current if isinstance(current, dict) else {}
        bots = current.get(BOT_UI_KEY)
        bots = dict(bots) if isinstance(bots, dict) else {}
        for key, value in incoming.items():
            if value is None:
                bots.pop(key, None)
            else:
                bots[key] = value
            revisions[key] = revisions.get(key, 0) + 1
        if bots:
            current[BOT_UI_KEY] = bots
        else:
            current.pop(BOT_UI_KEY, None)
        if current:
            existing["ui_meta"] = current
        else:
            existing.pop("ui_meta", None)
        existing["_ui_meta_revisions"] = revisions
        _atomic_write_yaml(home / "profile.yaml", existing)
        return {key: revisions[key] for key in incoming}


def avatar_file(home: Path) -> Path | None:
    for ext in AVATAR_EXTS:
        candidate = home / "assets" / f"avatar.{ext}"
        if candidate.is_file():
            return candidate
    return None


def clear_avatar(home: Path) -> int:
    assets = home / "assets"
    if not assets.is_dir():
        return 0
    return sum(1 for ext in AVATAR_EXTS if _unlink(assets / f"avatar.{ext}"))


def _unlink(path: Path) -> bool:
    if path.is_file():
        path.unlink()
        return True
    return False


def store_avatar(home: Path, blob: bytes) -> str:
    """Store PNG/JPEG/WebP ``assets/avatar.<ext>`` atomically. Returns the extension."""
    if len(blob) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="Avatar must be 2 MB or smaller")
    ext = next(
        (
            name
            for name, magics in AVATAR_MAGIC.items()
            if all(blob[first:last] == magic for first, last, magic in magics)
        ),
        None,
    )
    if ext is None:
        raise HTTPException(status_code=415, detail="Avatar must be a PNG, JPEG or WebP image")
    assets = home / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    clear_avatar(home)
    tmp = assets / f"avatar.{ext}.tmp"
    tmp.write_bytes(blob)
    os.chmod(tmp, 0o600)
    tmp.replace(assets / f"avatar.{ext}")
    return ext


def _ro_connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=1.0)
    conn.row_factory = sqlite3.Row
    return conn


def canonical_summary(home: Path) -> dict[str, Any]:
    """Read-only summary of the profile's canonical Bot Chat, or ``{}``.

    Identity is the exact title (native contract), so no client-side session pointer is
    involved. An archived canonical row is a retired registry entry and reports absent.
    """
    db_path = home / "state.db"
    if not db_path.is_file():
        return {}
    try:
        with _ro_connect(db_path) as conn:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if "sessions" not in tables:
                return {}
            columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
            if "title" not in columns:
                return {}
            row = conn.execute(
                "SELECT * FROM sessions WHERE title = ? LIMIT 1", (CANONICAL_BOT_CHAT_TITLE,)
            ).fetchone()
            if row is None:
                return {}
            data = dict(row)
            if data.get("archived"):
                return {}
            if "messages" not in tables:
                return data
            seen = {data.get("id")}
            if "parent_session_id" in columns and "end_reason" in columns:
                while data.get("end_reason") == "compression":
                    child = conn.execute(
                        "SELECT * FROM sessions WHERE parent_session_id = ? ORDER BY started_at DESC LIMIT 1",
                        (data["id"],),
                    ).fetchone()
                    if child is None or child["id"] in seen:
                        break
                    seen.add(child["id"])
                    data = dict(child)
            message_columns = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
            active = " AND active = 1" if "active" in message_columns else ""
            preview = conn.execute(
                "SELECT content FROM messages WHERE session_id = ? AND role IN ('user','assistant')"
                + active
                + " AND content IS NOT NULL AND TRIM(content) != '' ORDER BY id DESC LIMIT 1",
                (data["id"],),
            ).fetchone()
            text = " ".join(str(preview[0] or "").split()) if preview else ""
            data["preview"] = (text[:160] + "…") if len(text) > 160 else text
            return data
    except (sqlite3.Error, OSError, ValueError):
        return {}


def _number(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def profile_view(root: Path, name: str, *, running: bool = False) -> dict[str, Any]:
    home = profile_home(root, name)
    meta = read_meta(home)
    bots = bot_ui(meta)
    config = read_config(home)
    model_section = config.get("model")
    if not isinstance(model_section, dict):
        model_section = {"default": model_section} if isinstance(model_section, str) else {}
    canonical = canonical_summary(home)
    last_active = _number(canonical.get("last_activity_at") or canonical.get("started_at"))
    last_read = _number(canonical.get("last_read_at"))
    has_avatar = avatar_file(home) is not None
    model = model_section.get("default") if isinstance(model_section.get("default"), str) else None
    provider = model_section.get("provider") if isinstance(model_section.get("provider"), str) else None
    section = bots.get("section")
    return {
        "name": name,
        "title": str(bots.get("title") or meta.get("display_name") or name),
        "description": str(meta.get("description") or ""),
        "role": meta.get("role") if meta.get("role") in {"worker", "orchestrator"} else None,
        "avatar_url": f"/api/bots/{name}/avatar" if has_avatar else None,
        "has_avatar": has_avatar,
        "model": model,
        "provider": provider,
        "is_default": name == "default",
        "hidden": bool(bots.get("hidden", False)),
        "section": str(section) if section else None,
        "bot_session_id": canonical.get("id") if canonical else None,
        "running": bool(running),
        "updated_at": last_active,
        "preview": canonical.get("preview") or None,
        "message_count": int(canonical.get("message_count") or 0) if canonical else 0,
        # Native watermark semantics: NULL = never tracked = read.
        "unread": bool(canonical) and last_read is not None and bool(last_active and last_active > last_read),
        # Readiness only: never the key, never which provider account it belongs to.
        "credentials_ready": credentials_ready(home),
    }


def credentials_ready(home: Path) -> bool:
    """Whether this bot can authenticate at all: its own .env, an auth.json, or an inherited key."""
    if _dotenv_has_credentials(home / ".env"):
        return True
    if (home / "auth.json").is_file():
        return True
    return any(key.endswith(("_API_KEY", "_API_TOKEN", "_AUTH_TOKEN")) for key in os.environ)


def _dotenv_has_credentials(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip().endswith(("_API_KEY", "_API_TOKEN", "_AUTH_TOKEN")) and value.strip().strip('"\''):
            return True
    return False


def profile_soul(home: Path) -> str:
    path = home / "SOUL.md"
    try:
        return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""
    except OSError:
        return ""


def write_soul(home: Path, soul: str) -> None:
    path = home / "SOUL.md"
    tmp = path.with_name(f".SOUL.md.{os.getpid()}.tmp")
    tmp.write_text(soul, encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def model_options(home: Path) -> dict[str, Any]:
    """Model picker data for the Bot editor: config defaults, aliases and fallbacks only.

    Never returns credentials: nothing here reads ``.env`` or ``auth.json``.
    """
    config = read_config(home)
    raw_model = config.get("model")
    section: dict[str, Any] = raw_model if isinstance(raw_model, dict) else {}
    aliases: list[dict[str, Any]] = []
    top = config.get("model_aliases")
    if isinstance(top, dict):
        for alias, entry in top.items():
            if isinstance(entry, dict) and isinstance(entry.get("model"), str):
                aliases.append({"name": str(alias), "model": entry["model"], "provider": entry.get("provider")})
    simple = section.get("aliases")
    if isinstance(simple, dict):
        for alias, entry in simple.items():
            if isinstance(entry, str):
                aliases.append({"name": str(alias), "model": entry, "provider": section.get("provider")})
            elif isinstance(entry, dict) and isinstance(entry.get("model"), str):
                aliases.append({"name": str(alias), "model": entry["model"], "provider": entry.get("provider")})
    providers: list[str] = []
    if isinstance(section.get("provider"), str):
        providers.append(section["provider"])
    fallbacks = config.get("fallback_providers")
    if isinstance(fallbacks, list):
        for item in fallbacks:
            if isinstance(item, dict) and isinstance(item.get("provider"), str):
                providers.append(item["provider"])
    for alias in aliases:
        if isinstance(alias.get("provider"), str):
            providers.append(alias["provider"])
    return {
        "model": section.get("default") if isinstance(section.get("default"), str) else None,
        "provider": section.get("provider") if isinstance(section.get("provider"), str) else None,
        "aliases": aliases,
        "providers": list(dict.fromkeys(providers)),
    }


# --------------------------------------------------------------------------- admin subprocess


def _hermes_candidates() -> list[str]:
    candidates = []
    explicit = os.environ.get("ASTRA_HERMES_SRC")
    if explicit:
        candidates.append(explicit)
    candidates.extend(["/opt/hermes", str(Path.home() / ".hermes" / "hermes-agent")])
    return candidates


def run_admin(op: dict[str, Any], settings) -> dict[str, Any]:
    """Run one native profile operation in a subprocess with the BASE home.

    Hermes' profile primitives resolve ``profiles/`` from ``HERMES_HOME`` at import time, so
    they cannot run in the gateway process without poisoning every later request.
    """
    if _admin_runner is not None:  # tests exercise the HTTP layer without the Hermes tree
        return _admin_runner(op)
    env = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "LANG", "LC_ALL", "TZ", "HOME", "SSL_CERT_FILE", "SSL_CERT_DIR", "TMPDIR"}
    }
    source_root = str(Path(__file__).resolve().parent.parent)
    env["HERMES_HOME"] = str(settings.hermes_home)
    env["PYTHONPATH"] = os.pathsep.join([source_root, *_hermes_candidates()])
    env["PYTHONUNBUFFERED"] = "1"
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "astra.profile_admin"],
            input=json.dumps(op),
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
            cwd=source_root,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Profile operation timed out") from None
    payload = _parse_admin_output(completed.stdout)
    if completed.returncode != 0 or payload.get("error"):
        detail = payload.get("error") or _last_line(completed.stderr) or "Profile operation failed"
        raise HTTPException(status_code=400, detail=str(detail)[:400])
    return payload


def _last_line(text: str | None) -> str:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    return lines[-1] if lines else ""


def _parse_admin_output(raw: str) -> dict[str, Any]:
    for line in reversed((raw or "").strip().splitlines()):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            return value
    return {"error": "Profile operation produced no result"}


def create_profile(settings, *, name: str, clone_from: str | None = None, title: str | None = None,
                   description: str | None = None, soul: str | None = None,
                   model: str | None = None, provider: str | None = None) -> dict[str, Any]:
    root = profile_root(settings)
    if not valid_name(name) or name == "default":
        raise HTTPException(
            status_code=422, detail="Profile names must be lowercase letters, digits, '-' or '_'"
        )
    if name in profile_names(root):
        raise HTTPException(status_code=409, detail=f"Profile '{name}' already exists")
    if clone_from is not None and not valid_name(clone_from):
        raise HTTPException(status_code=422, detail="Invalid clone source")
    run_admin(
        {"op": "create", "name": name, "clone_from": clone_from, "model": model, "provider": provider},
        settings,
    )
    try:
        home = profile_home(root, name)
    except HTTPException:
        raise HTTPException(status_code=500, detail="Profile was not created") from None
    if description is not None:
        run_admin({"op": "describe", "name": name, "description": description}, settings)
    if soul:
        write_soul(home, soul)
    ui: dict[str, Any] = {}
    if title:
        ui["title"] = title.strip()[:80]
    if ui:
        write_bot_ui(home, ui)
    return profile_view(root, name)


def update_profile(settings, name: str, changes: dict[str, Any]) -> dict[str, Any]:
    root = profile_root(settings)
    home = profile_home(root, name)
    ui: dict[str, Any] = {}
    if "title" in changes:
        value = (changes["title"] or "").strip()
        ui["title"] = value[:80] if value else None
    if "hidden" in changes:
        ui["hidden"] = bool(changes["hidden"])
    if "section" in changes:
        value = (changes["section"] or "").strip()
        ui["section"] = value[:80] if value else None
    if ui:
        write_bot_ui(home, ui)
    if changes.get("description") is not None:
        run_admin({"op": "describe", "name": name, "description": changes["description"]}, settings)
    if changes.get("soul") is not None:
        write_soul(home, changes["soul"])
    model = (changes.get("model") or "").strip()
    provider = (changes.get("provider") or "").strip()
    if model and provider:
        run_admin({"op": "pin_model", "name": name, "model": model, "provider": provider}, settings)
    elif bool(model) != bool(provider):
        raise HTTPException(status_code=422, detail="Model and provider must be set together")
    return profile_view(root, name)


def delete_profile(settings, name: str) -> None:
    root = profile_root(settings)
    if name == "default":
        raise HTTPException(status_code=409, detail="The default profile cannot be deleted")
    home = profile_home(root, name)
    run_admin({"op": "delete", "name": name}, settings)
    if home.exists():  # native delete declined; never silently half-delete
        raise HTTPException(status_code=500, detail="Profile deletion did not complete")
