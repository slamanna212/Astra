# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build


# Keep this base identical to the image running the Hermes gateway. Astra imports
# Hermes directly, so tag and digest upgrades must be coordinated with the deployment.
FROM nousresearch/hermes-agent:v2026.8.31@sha256:64923faeae267792bf9bf87fe3b4c4869e35004e360c7df01730ad801b74d524 AS runtime

LABEL org.opencontainers.image.title="Astra" \
      org.opencontainers.image.description="Web UI for a single-user Hermes Agent deployment" \
      org.opencontainers.image.source="https://github.com/slamanna212/Astra"

WORKDIR /opt/astra

COPY backend/pyproject.toml backend/uv.lock backend/README.md ./backend/
COPY backend/src ./backend/src

# Reuse Hermes's environment so Astra and the in-process agent load one compatible
# dependency set. Validate Astra's runtime surface directly instead of running a
# whole-environment check: the pinned upstream image has an unrelated, pre-existing
# msal/cryptography metadata conflict.
RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    uv pip install --python /opt/hermes/.venv/bin/python ./backend \
    && /opt/hermes/.venv/bin/python -c \
       "import astra, fastapi, httpx, multipart, uvicorn, yaml; from dotenv import load_dotenv"

COPY --from=frontend-builder /build/frontend/dist ./frontend

RUN groupadd --gid 1000 astra \
    && useradd --uid 1000 --gid astra --home-dir /home/astra --create-home --shell /bin/bash astra \
    && mkdir -p /workspace \
    && chown astra:astra /workspace

# HERMES_HOME is intentionally empty: every deployment must point it at the
# mounted Hermes data directory rather than silently using the base image's path.
ENV HOME=/home/astra \
    HERMES_HOME="" \
    HERMES_WRITE_SAFE_ROOT=/workspace \
    HERMES_LAZY_INSTALL_TARGET=/tmp/astra-lazy-packages \
    ASTRA_STATIC_DIR=/opt/astra/frontend \
    ASTRA_WORKSPACE_DIR=/workspace \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/opt/hermes/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9090/api/health', timeout=3).read()"]

USER astra:astra

ENTRYPOINT ["/opt/hermes/.venv/bin/python", "-m", "uvicorn"]
CMD ["astra.main:app", "--host", "0.0.0.0", "--port", "9090"]
