"""Astra: web UI backend for a single-user Hermes Agent deployment."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("astra")
except PackageNotFoundError:  # pragma: no cover - running from a bare source tree
    __version__ = "0.0.0+unknown"

__all__ = ["__version__"]
