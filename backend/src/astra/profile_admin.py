"""One native Hermes profile operation per process — the gateway's admin boundary.

Runs with ``HERMES_HOME`` pointing at the **base** home so ``hermes_cli.profiles`` resolves
``profiles/`` correctly, and exits immediately after the operation. Hermes' profile
primitives memoise home-derived paths at import time, which is exactly why this cannot run
inside the gateway process.

Protocol: one JSON object on stdin, one JSON object on stdout (last line wins). Any failure
prints ``{"error": ...}`` and exits non-zero.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import sys
from pathlib import Path


def _base_home() -> Path:
    raw = (os.environ.get("HERMES_HOME") or "").strip()
    if not raw:
        raise RuntimeError("HERMES_HOME must name the base hermes home")
    return Path(raw).expanduser()


def _env_has_content(path: Path) -> bool:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return False
    return any(line and not line.startswith("#") for line in map(str.strip, lines))


def _mirror_file(source: Path, target: Path) -> bool:
    if not (source.is_file() and not target.exists()):
        return False
    shutil.copy2(source, target)
    with contextlib.suppress(OSError):
        os.chmod(target, 0o600)
    return True


def _inherit_launch_settings(profile_dir: Path, base: Path) -> dict:
    """Give a fresh profile the launch profile's credentials and model, natively ordered.

    Mirrors the native create path (``profiles.create`` with ``mirror_credentials``): static
    keys travel so the new bot works on first message, while ``auth.json`` travels only when
    the profile has none of its own.
    """
    from hermes_cli.config import read_user_config_raw

    mirrored = {"env": False, "auth": False, "model": False}
    with contextlib.suppress(Exception):
        env_path = profile_dir / ".env"
        if not _env_has_content(env_path):
            mirrored["env"] = _mirror_file(base / ".env", env_path)
    with contextlib.suppress(Exception):
        mirrored["auth"] = _mirror_file(base / "auth.json", profile_dir / "auth.json")

    # The model decision belongs to the NEW profile, not to this process: HERMES_HOME is the
    # base home here, so reading "the current config" would always describe the parent.
    if not _profile_has_model(profile_dir):
        launch = read_user_config_raw()
        launch_model = launch.get("model") if isinstance(launch, dict) else None
        launch_model = launch_model if isinstance(launch_model, dict) else {}
        provider = launch_model.get("provider")
        model = launch_model.get("default")
        if isinstance(provider, str) and isinstance(model, str) and provider and model:
            _pin_model(profile_dir, provider, model, base)
            mirrored["model"] = _profile_has_model(profile_dir)
    return mirrored


def _profile_has_model(profile_dir: Path) -> bool:
    """True when the profile's own config.yaml already pins a provider and model."""
    import yaml

    path = profile_dir / "config.yaml"
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) if path.is_file() else None
    except (OSError, yaml.YAMLError):
        return False
    model = data.get("model") if isinstance(data, dict) else None
    model = model if isinstance(model, dict) else {}
    return bool(model.get("provider") and model.get("default"))


def _pin_model(profile_dir: Path, provider: str, model: str, base: Path) -> None:
    """Write the profile's main model assignment through Hermes' validated /model shape."""
    try:
        from hermes_cli.web_routers.profiles import _write_profile_model

        _write_profile_model(profile_dir, provider, model, validate_in=base)
        return
    except Exception:
        # The dashboard router pulls FastAPI app state; a direct, shape-identical write is the
        # documented fallback and still keeps keys out of config.yaml.
        from hermes_cli.config import load_config, save_config

        cfg = load_config() or {}
        current = cfg.get("model") if isinstance(cfg, dict) else None
        cfg["model"] = {
            **(current if isinstance(current, dict) else {}),
            "default": model,
            "provider": provider,
        }
        try:
            save_config(cfg)
        except Exception:
            # Hermes' writer needs ruamel; a partial environment (astra installed next to it
            # rather than inside it) must still produce a working profile rather than a bot
            # that cannot answer. The shape written is the same one _write_profile_model emits.
            import yaml

            path = Path(profile_dir) / "config.yaml"
            existing = {}
            if path.is_file():
                existing = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
                existing = existing if isinstance(existing, dict) else {}
            existing["model"] = cfg["model"]
            path.write_text(yaml.safe_dump(existing, sort_keys=False), encoding="utf-8")


def op_create(params: dict, base: Path) -> dict:
    from hermes_cli import profiles as profiles_mod

    name = str(params.get("name") or "").strip()
    clone_from = str(params.get("clone_from") or "").strip() or None
    path = profiles_mod.create_profile(
        name=name,
        clone_from=clone_from,
        clone_config=bool(clone_from),
    )
    if not clone_from:
        with contextlib.suppress(Exception):
            profiles_mod.seed_profile_skills(path, quiet=True)
        mirrored = _inherit_launch_settings(path, base)
    else:
        mirrored = {"env": False, "auth": False, "model": True}
    model = str(params.get("model") or "").strip()
    provider = str(params.get("provider") or "").strip()
    model_set = False
    if model and provider:
        _pin_model(path, provider, model, base)
        model_set = True
    return {"ok": True, "name": name, "path": str(path), "model_set": model_set, "mirrored": mirrored}


def op_delete(params: dict, base: Path) -> dict:
    from hermes_cli import profiles as profiles_mod

    path = profiles_mod.delete_profile(str(params.get("name") or "").strip(), yes=True)
    return {"ok": True, "path": str(path)}


def op_describe(params: dict, base: Path) -> dict:
    from hermes_cli.profiles import get_profile_dir, write_profile_meta

    path = Path(get_profile_dir(str(params.get("name") or "").strip()))
    write_profile_meta(path, description=str(params.get("description") or ""), description_auto=False)
    return {"ok": True, "path": str(path)}


def op_pin_model(params: dict, base: Path) -> dict:
    from hermes_cli.profiles import get_profile_dir

    path = Path(get_profile_dir(str(params.get("name") or "").strip()))
    _pin_model(path, str(params.get("provider") or ""), str(params.get("model") or ""), base)
    return {"ok": True, "path": str(path)}


OPERATIONS = {
    "create": op_create,
    "delete": op_delete,
    "describe": op_describe,
    "pin_model": op_pin_model,
}


def main() -> int:
    try:
        params = json.loads(sys.stdin.read() or "{}")
        if not isinstance(params, dict):
            raise RuntimeError("operation payload must be an object")
        operation = OPERATIONS.get(str(params.get("op") or ""))
        if operation is None:
            raise RuntimeError(f"unknown operation {params.get('op')!r}")
        result = operation(params, _base_home())
        print(json.dumps(result), flush=True)
        return 0
    except Exception as exc:  # every failure becomes one machine-readable line
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
