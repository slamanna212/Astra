"""ASGI entrypoint: ``uvicorn astra.main:app``."""

from __future__ import annotations

import logging
import os

from astra.app import create_app
from astra.config import ConfigError, load_settings
from astra.logging import setup_logging

setup_logging(os.environ.get("ASTRA_LOG_LEVEL", "INFO"))

try:
    _settings = load_settings()
except ConfigError as exc:
    logging.getLogger("astra").critical("configuration error: %s", exc)
    raise SystemExit(f"astra: configuration error: {exc}") from None

app = create_app(_settings)
