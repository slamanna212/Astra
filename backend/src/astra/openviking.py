"""Small, read-only server-side adapter for the versioned OpenViking API."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from astra.config import Settings


class OpenVikingUnavailable(RuntimeError):
    pass


class OpenVikingClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: httpx.AsyncClient | None = None
        self._requests = asyncio.Semaphore(4)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def configured(self) -> bool:
        return bool(self.settings.openviking_endpoint and self.settings.openviking_api_key)

    def _headers(self) -> dict[str, str]:
        return {"X-API-Key": self.settings.openviking_api_key or "", "X-OpenViking-Account": self.settings.openviking_account, "X-OpenViking-User": self.settings.openviking_user}

    async def request(self, method: str, path: str, *, params: dict[str, Any] | None = None, body: dict[str, Any] | None = None, auth: bool = True) -> Any:
        if not self.configured:
            raise OpenVikingUnavailable("OpenViking is not configured")
        try:
            async with self._requests:
                if self._client is None:
                    self._client = httpx.AsyncClient(
                        base_url=self.settings.openviking_endpoint,
                        timeout=httpx.Timeout(35, connect=4),
                        limits=httpx.Limits(max_connections=4, max_keepalive_connections=4),
                    )
                response = await self._client.request(method, path, params=params, json=body, headers=self._headers() if auth else {})
        except httpx.HTTPError as exc:
            raise OpenVikingUnavailable("OpenViking is unreachable") from exc
        if response.status_code >= 500:
            raise OpenVikingUnavailable("OpenViking is unavailable")
        if response.status_code >= 400:
            detail = response.text[:500]
            raise ValueError(detail or "OpenViking rejected the request")
        data = response.json()
        return data.get("result", data) if isinstance(data, dict) else data
