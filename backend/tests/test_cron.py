from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import shutil
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from astra.config import REPO_DIR, Settings
from tests.conftest import CSRF, PASSWORD, SECRET

REAL_HERMES_HOME = REPO_DIR / "exampledata" / "hermes-home"
HERMES_SRC = REPO_DIR / "exampledata" / "hermes-ui-handoff" / "hermes-agent-src"


def _tree_hash(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(root.rglob("*")):
        if p.is_file() and not p.is_symlink():
            h.update(str(p.relative_to(root)).encode())
            h.update(p.read_bytes())
    return h.hexdigest()


@pytest.fixture(scope="session")
def cron_password_hash() -> str:
    from astra.auth import hash_password

    return hash_password(PASSWORD, n=2**14)


@pytest.fixture
def cron_home(tmp_path: Path) -> Path:
    """A tmp HERMES_HOME with real cron/skills/scripts/config.yaml — never mutates
    exampledata/. Function-scoped (fresh copy per test) because a few tests below
    deliberately write into it (symlink guards, the SSE change signal)."""
    if not (REAL_HERMES_HOME / "cron" / "jobs.json").is_file():
        pytest.skip(f"example HERMES_HOME missing: {REAL_HERMES_HOME}")
    home = tmp_path / "hermes-home"
    home.mkdir()
    for name in ("cron", "skills", "scripts", "config.yaml"):
        src = REAL_HERMES_HOME / name
        dst = home / name
        if src.is_dir():
            shutil.copytree(src, dst, symlinks=True)
        elif src.is_file():
            shutil.copy2(src, dst)
    return home


@pytest.fixture
def cron_settings(cron_home: Path, cron_password_hash: str, tmp_path: Path) -> Settings:
    static_dir = tmp_path / "no-static"
    static_dir.mkdir()
    return Settings.from_env(
        {
            "HERMES_HOME": str(cron_home),
            "ASTRA_HERMES_SRC": str(HERMES_SRC),
            "ASTRA_PASSWORD_HASH": cron_password_hash,
            "ASTRA_SESSION_SECRET": SECRET,
            "ASTRA_COOKIE_SECURE": "false",
            "ASTRA_STATIC_DIR": str(static_dir),
            "ASTRA_CRON_POLL_INTERVAL_S": "0.05",
        }
    )


@pytest.fixture
def cron_client(cron_settings: Settings) -> Iterator[TestClient]:
    from astra.app import create_app

    client = TestClient(create_app(cron_settings))
    with client:
        resp = client.post("/api/auth/login", json={"password": PASSWORD}, headers=CSRF)
        assert resp.status_code == 204, resp.text
        yield client


# ── side-effect freedom ──────────────────────────────────────────────────────


def test_cron_and_skills_reads_never_mutate_hermes_home(cron_client: TestClient, cron_home: Path) -> None:
    before = _tree_hash(cron_home)

    jobs = cron_client.get("/api/cron").json()["items"]
    assert len(jobs) == 9
    for job in jobs:
        cron_client.get(f"/api/cron/{job['id']}")
        cron_client.get(f"/api/cron/{job['id']}/output")
    daily = next(j for j in jobs if j["name"] == "Daily Briefing")
    cron_client.get(f"/api/cron/{daily['id']}/script/post_script")

    skills = cron_client.get("/api/skills").json()["items"]
    assert len(skills) > 0
    for s in skills[:20]:
        if s["category"]:
            cron_client.get(f"/api/skills/{s['category']}/{s['name']}")
        else:
            cron_client.get(f"/api/skills/{s['name']}")

    after = _tree_hash(cron_home)
    assert before == after, "a read-only endpoint mutated HERMES_HOME"


# ── cron: fields, §4.5 receipts ──────────────────────────────────────────────


def _by_name(jobs: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next(j for j in jobs if j["name"] == name)


def test_list_includes_all_nine_jobs_including_disabled(cron_client: TestClient) -> None:
    body = cron_client.get("/api/cron").json()
    assert len(body["items"]) == 9
    assert all("enabled" in j for j in body["items"])


def test_daily_briefing_shows_post_script(cron_client: TestClient) -> None:
    job = _by_name(cron_client.get("/api/cron").json()["items"], "Daily Briefing")
    assert job["post_script"] == "briefing_post_webhook.py"
    assert job["no_agent"] is True


def test_memory_reflection_shows_context_from(cron_client: TestClient) -> None:
    job = _by_name(cron_client.get("/api/cron").json()["items"], "memory-reflection")
    assert job["context_from"] == ["self"]


def test_mail_watcher_shows_monitor_script(cron_client: TestClient) -> None:
    job = _by_name(cron_client.get("/api/cron").json()["items"], "Astra mail watcher")
    assert job["monitor_script"] == "astra_mail_monitor.py"
    assert job["attach_to_session"] is True


def test_job_detail_matches_list_entry(cron_client: TestClient) -> None:
    jobs = cron_client.get("/api/cron").json()["items"]
    job = jobs[0]
    detail = cron_client.get(f"/api/cron/{job['id']}").json()
    assert detail["id"] == job["id"]
    assert detail["name"] == job["name"]
    assert detail["schedule"] == job["schedule"]


def test_unknown_job_404s(cron_client: TestClient) -> None:
    assert cron_client.get("/api/cron/does-not-exist").status_code == 404
    assert cron_client.get("/api/cron/does-not-exist/output").status_code == 404
    assert cron_client.get("/api/cron/does-not-exist/script/script").status_code == 404


def test_cron_full_write_lifecycle_and_advanced_fields(cron_client: TestClient, cron_home: Path) -> None:
    created_response = cron_client.post(
        "/api/cron",
        headers=CSRF,
        json={
            "name": "Astra phase three test",
            "prompt": "Exercise cron mutation fields",
            "schedule": "every 30m",
            "deliver": "local",
            "skills": ["summarize"],
            "repeat": 3,
            "post_script": "after.py",
            "context_from": ["self"],
            "attach_to_session": True,
            "monitor_script": "watch.py",
            "workdir": str(cron_home),
            "model": "test-model",
            "provider": "test-provider",
            "reasoning_effort": "low",
            "enabled_toolsets": ["web"],
        },
    )
    assert created_response.status_code == 201, created_response.text
    job = created_response.json()
    job_id = job["id"]
    assert job["post_script"] == "after.py"
    assert job["context_from"] == ["self"]
    assert job["monitor_script"] == "watch.py"

    updated_response = cron_client.patch(
        f"/api/cron/{job_id}",
        headers=CSRF,
        json={"schedule": "every 45m", "post_script": "after-v2.py", "context_from": ["other-job"]},
    )
    assert updated_response.status_code == 200, updated_response.text
    updated = updated_response.json()
    assert updated["schedule"]["kind"] == "interval"
    assert updated["post_script"] == "after-v2.py"
    assert updated["context_from"] == ["other-job"]

    assert cron_client.post(f"/api/cron/{job_id}/pause", headers=CSRF, json={"reason": "test"}).json()["enabled"] is False
    assert cron_client.post(f"/api/cron/{job_id}/resume", headers=CSRF).json()["enabled"] is True

    persisted = json.loads((cron_home / "cron" / "jobs.json").read_text(encoding="utf-8"))
    persisted_job = next(item for item in persisted["jobs"] if item["id"] == job_id)
    assert persisted_job["post_script"] == "after-v2.py"
    assert persisted_job["context_from"] == ["other-job"]

    response = cron_client.delete(f"/api/cron/{job_id}", headers=CSRF)
    assert response.status_code == 204
    assert cron_client.get(f"/api/cron/{job_id}").status_code == 404


def test_script_endpoint_rejects_unknown_field(cron_client: TestClient) -> None:
    jobs = cron_client.get("/api/cron").json()["items"]
    job = jobs[0]
    resp = cron_client.get(f"/api/cron/{job['id']}/script/prompt")
    assert resp.status_code == 400


def test_script_endpoint_404_when_field_unset(cron_client: TestClient) -> None:
    job = _by_name(cron_client.get("/api/cron").json()["items"], "Wiki lint (weekly)")
    assert job.get("post_script") is None
    resp = cron_client.get(f"/api/cron/{job['id']}/script/post_script")
    assert resp.status_code == 404


# ── output listing/reading, traversal ─────────────────────────────────────────


def test_output_listing_and_read(cron_client: TestClient) -> None:
    job = _by_name(cron_client.get("/api/cron").json()["items"], "Daily Briefing")
    page = cron_client.get(f"/api/cron/{job['id']}/output").json()
    assert page["items"], "expected at least one run"
    first = page["items"][0]
    assert first["filename"].endswith(".md")
    content = cron_client.get(f"/api/cron/{job['id']}/output/{first['filename']}").json()
    assert content["filename"] == first["filename"]
    assert "Cron Job:" in content["content"]


@pytest.mark.parametrize(
    "run",
    ["../../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", "/etc/passwd", "not-a-run.md", "no-ext"],
)
def test_output_read_rejects_traversal_and_unknown(cron_client: TestClient, run: str) -> None:
    job = _by_name(cron_client.get("/api/cron").json()["items"], "Daily Briefing")
    resp = cron_client.get(f"/api/cron/{job['id']}/output/{run}")
    assert resp.status_code in (400, 404), resp.text


def test_output_read_rejects_symlinked_file(cron_client: TestClient, cron_home: Path) -> None:
    job = _by_name(cron_client.get("/api/cron").json()["items"], "Daily Briefing")
    output_dir = cron_home / "cron" / "output" / job["id"]
    target = output_dir / "evil-symlink.md"
    outside = cron_home / "outside.md"
    outside.write_text("not yours", encoding="utf-8")
    target.symlink_to(outside)
    try:
        resp = cron_client.get(f"/api/cron/{job['id']}/output/evil-symlink.md")
        assert resp.status_code == 404
    finally:
        target.unlink(missing_ok=True)
        outside.unlink(missing_ok=True)


def test_output_job_id_traversal_rejected(cron_client: TestClient) -> None:
    resp = cron_client.get("/api/cron/..%2F..%2Fetc/output")
    assert resp.status_code == 404


# ── skills ─────────────────────────────────────────────────────────────────


def test_skills_list_has_categories_and_disabled_flags(cron_client: TestClient) -> None:
    body = cron_client.get("/api/skills").json()
    assert len(body["items"]) > 100
    assert ".archive" not in [c for c in body["categories"]]
    disabled_names = {s["name"] for s in body["items"] if not s["enabled"]}
    assert "gif-search" in disabled_names  # from config.yaml's skills.disabled


def test_skill_detail_by_category_and_flat(cron_client: TestClient) -> None:
    items = cron_client.get("/api/skills").json()["items"]
    categorized = next(s for s in items if s["category"])
    resp = cron_client.get(f"/api/skills/{categorized['category']}/{categorized['name']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == categorized["name"]
    assert "SKILL" in body["content"] or body["content"]


def test_skill_detail_rejects_traversal(cron_client: TestClient) -> None:
    resp = cron_client.get("/api/skills/..%2F..%2Fetc/passwd")
    assert resp.status_code in (400, 404)


def test_skill_detail_rejects_symlinked_skill_md(cron_client: TestClient, cron_home: Path) -> None:
    skill_dir = cron_home / "skills" / "_evil"
    skill_dir.mkdir(exist_ok=True)
    outside = cron_home / "outside-skill.md"
    outside.write_text("---\nname: evil\n---\nbody", encoding="utf-8")
    (skill_dir / "SKILL.md").symlink_to(outside)
    try:
        resp = cron_client.get("/api/skills/_evil")
        assert resp.status_code == 403
    finally:
        (skill_dir / "SKILL.md").unlink(missing_ok=True)
        outside.unlink(missing_ok=True)
        skill_dir.rmdir()


def test_unknown_skill_404s(cron_client: TestClient) -> None:
    assert cron_client.get("/api/skills/nonexistent-skill-xyz").status_code == 404


# ── SSE change signal ────────────────────────────────────────────────────────
#
# httpx.ASGITransport (used by both starlette's TestClient and a plain
# httpx.AsyncClient) buffers the ENTIRE response and only returns once the ASGI
# app's `__call__` coroutine itself returns (see its `handle_async_request`:
# `await self.app(...)` before building the Response) — it does not support
# incrementally reading a response while the app is still sending, so it
# cannot observe an intentionally-infinite SSE stream at all (confirmed by
# hanging both TestClient.stream(...) and httpx.AsyncClient.stream(...) against
# this exact endpoint). Instead, drive the ASGI callable directly: our own
# `send` pushes each `http.response.body` chunk onto a queue as it arrives,
# and we cancel the app-call task ourselves when the test is done.


async def _read_cron_events(app, *, touch: Path | None) -> list[str]:
    import httpx

    # Login first — a normal bounded request, where ASGITransport's buffering is fine.
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        login = await ac.post("/api/auth/login", json={"password": PASSWORD}, headers=CSRF, timeout=5.0)
        assert login.status_code == 204, login.text
        cookie_header = "; ".join(f"{k}={v}" for k, v in ac.cookies.items())

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "path": "/api/cron/events",
        "raw_path": b"/api/cron/events",
        "query_string": b"",
        "headers": [(b"cookie", cookie_header.encode())],
        "scheme": "http",
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 12345),
        "root_path": "",
    }

    body_queue: asyncio.Queue[bytes] = asyncio.Queue()
    request_sent = False

    async def receive() -> dict:
        nonlocal request_sent
        if not request_sent:
            request_sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.sleep(3600)  # never disconnect on our own; the test cancels the task
        return {"type": "http.disconnect"}  # pragma: no cover — unreachable in practice

    async def send(message: dict) -> None:
        if message["type"] == "http.response.body":
            await body_queue.put(message.get("body", b""))

    task = asyncio.create_task(app(scope, receive, send))
    buf = b""

    async def next_line() -> str:
        nonlocal buf
        while b"\n" not in buf:
            buf += await asyncio.wait_for(body_queue.get(), timeout=3.0)
        line, buf = buf.split(b"\n", 1)
        return line.decode()

    events: list[str] = []
    try:
        events.append(await next_line())  # the initial ": connected" comment
        if touch is not None:
            await asyncio.sleep(0.15)
            data = json.loads(touch.read_text())
            touch.write_text(json.dumps(data), encoding="utf-8")
        deadline = asyncio.get_running_loop().time() + 5.0
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                line = await asyncio.wait_for(next_line(), timeout=remaining)
            except TimeoutError:
                break
            events.append(line)
            if "jobs-changed" in line:
                break
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    return events


def test_cron_events_stream_opens(cron_settings: Settings) -> None:
    from astra.app import create_app

    app = create_app(cron_settings)
    events = asyncio.run(_read_cron_events(app, touch=None))
    assert events, "expected at least the initial SSE comment"


def test_cron_events_emits_on_jobs_json_change(cron_settings: Settings, cron_home: Path) -> None:
    from astra.app import create_app

    app = create_app(cron_settings)
    jobs_path = cron_home / "cron" / "jobs.json"
    events = asyncio.run(_read_cron_events(app, touch=jobs_path))
    assert any("jobs-changed" in e for e in events), (
        f"expected a jobs-changed SSE event after touching jobs.json, got: {events}"
    )
