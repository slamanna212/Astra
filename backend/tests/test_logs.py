from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astra import logs as logsmod
from tests.conftest import login

AGENT_LOG = """\
2026-09-15 20:55:52,967 INFO [10e55b1bb794] agent.turn_context: conversation turn: session=10e55b1bb794 model=deepseek-v4-flash
2026-09-15 20:55:55,039 INFO [10e55b1bb794] agent.conversation_loop: Repaired 2 message-alternation violations
2026-09-15 20:55:52,178 WARNING tools.mcp_oauth_manager: Token refresh failed: 400
2026-09-15 20:55:52,597 ERROR mcp.client.auth.oauth2: OAuth flow error, key=sk-ant-abcdefghijklmnop
Traceback (most recent call last):
  File "example.py", line 1, in <module>
    raise ValueError("boom")
ValueError: boom
2026-09-15 20:56:09,037 INFO agent.auxiliary_client: Auxiliary approval: using deepseek
"""


@pytest.fixture
def hermes_home_with_logs(tmp_path: Path) -> Path:
    home = tmp_path / "hermes-home"
    logs_dir = home / "logs"
    logs_dir.mkdir(parents=True)
    (logs_dir / "agent.log").write_text(AGENT_LOG)
    (logs_dir / "errors.log").write_text("2026-09-15 20:00:00,000 ERROR x: boom\n")
    (logs_dir / "gateway.log").write_text("2026-09-15 20:00:00,000 INFO x: gw up\n")
    (logs_dir / "agent.log.1").write_text("2026-09-14 00:00:00,000 INFO x: rotated, must not be readable\n")
    (logs_dir / "container-boot.log").write_text("boot stuff, must not be readable\n")
    return home


@pytest.fixture
def logs_client(make_client: Callable[..., TestClient], hermes_home_with_logs: Path) -> TestClient:
    client = make_client(hermes_home=hermes_home_with_logs)
    login(client)
    return client


# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("file", ["agent.log", "errors.log", "gateway.log"])
def test_allowed_files_readable(logs_client: TestClient, file: str) -> None:
    resp = logs_client.get("/api/logs", params={"file": file})
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize(
    "file",
    [
        "agent.log.1",
        "container-boot.log",
        "../agent.log",
        "logs/agent.log",
        "/etc/passwd",
        "agent.log/../agent.log",
        "",
        "AGENT.LOG",
    ],
)
def test_disallowed_files_rejected(logs_client: TestClient, file: str) -> None:
    resp = logs_client.get("/api/logs", params={"file": file})
    assert resp.status_code == 400, resp.text


def test_missing_file_param_is_422(logs_client: TestClient) -> None:
    resp = logs_client.get("/api/logs")
    assert resp.status_code == 422


def test_symlinked_log_file_refused(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    home = tmp_path / "hermes-home"
    logs_dir = home / "logs"
    logs_dir.mkdir(parents=True)
    (logs_dir / "errors.log").write_text("real\n")
    (logs_dir / "gateway.log").write_text("real\n")
    outside = tmp_path / "outside.log"
    outside.write_text("should never be served as agent.log\n")
    (logs_dir / "agent.log").symlink_to(outside)

    client = make_client(hermes_home=home)
    login(client)
    resp = client.get("/api/logs", params={"file": "agent.log"})
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def test_parses_timestamp_level_logger_message() -> None:
    entry = logsmod.parse_line(
        "2026-09-15 20:55:52,967 INFO [10e55b1bb794] agent.turn_context: conversation turn: hi"
    )
    assert entry.timestamp == "2026-09-15 20:55:52,967"
    assert entry.level == "INFO"
    assert entry.session == "10e55b1bb794"
    assert entry.logger == "agent.turn_context"
    assert entry.message == "conversation turn: hi"


def test_parses_line_without_session_id() -> None:
    entry = logsmod.parse_line("2026-09-15 20:55:52,178 WARNING tools.mcp_oauth_manager: Token refresh failed: 400")
    assert entry.level == "WARNING"
    assert entry.session is None
    assert entry.logger == "tools.mcp_oauth_manager"


def test_traceback_continuation_line_is_unparsed_raw() -> None:
    entry = logsmod.parse_line('  File "example.py", line 1, in <module>')
    assert entry.timestamp is None
    assert entry.level is None
    assert entry.raw == '  File "example.py", line 1, in <module>'


def test_level_filter(logs_client: TestClient) -> None:
    resp = logs_client.get("/api/logs", params={"file": "agent.log", "level": "warning"})
    assert resp.status_code == 200
    lines = resp.json()["lines"]
    assert lines
    assert all((line["level"] or "").upper() == "WARNING" for line in lines)


def test_search_filter(logs_client: TestClient) -> None:
    resp = logs_client.get("/api/logs", params={"file": "agent.log", "search": "auxiliary"})
    assert resp.status_code == 200
    lines = resp.json()["lines"]
    assert lines
    assert all("auxiliary" in line["raw"].lower() for line in lines)


def test_lines_cap_enforced(logs_client: TestClient) -> None:
    resp = logs_client.get("/api/logs", params={"file": "agent.log", "lines": 2})
    assert resp.status_code == 200
    assert len(resp.json()["lines"]) <= 2


def test_lines_over_max_is_422(logs_client: TestClient) -> None:
    resp = logs_client.get("/api/logs", params={"file": "agent.log", "lines": logsmod.MAX_LINES + 1})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------


def test_secret_looking_values_are_redacted(logs_client: TestClient) -> None:
    resp = logs_client.get("/api/logs", params={"file": "agent.log", "search": "oauth flow"})
    assert resp.status_code == 200
    lines = resp.json()["lines"]
    assert lines
    joined = " ".join(line["raw"] for line in lines)
    assert "sk-ant-abcdefghijklmnop" not in joined
    assert "REDACTED" in joined


# ---------------------------------------------------------------------------
# Tail-only / byte cap behaviour
# ---------------------------------------------------------------------------


def test_tail_never_reads_more_than_the_byte_cap(tmp_path: Path) -> None:
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    big = logs_dir / "agent.log"
    line = "2026-09-15 00:00:00,000 INFO x: " + ("a" * 100) + "\n"
    with big.open("w") as fh:
        for _ in range(60_000):  # well over MAX_TAIL_BYTES
            fh.write(line)
    (logs_dir / "errors.log").write_text("x\n")
    (logs_dir / "gateway.log").write_text("x\n")

    tail = logsmod.tail_log(logs_dir, "agent.log", lines=logsmod.MAX_LINES)
    assert tail.truncated is True
    assert tail.total_bytes > logsmod.MAX_TAIL_BYTES
    assert len(tail.lines) <= logsmod.MAX_LINES


def test_missing_log_file_returns_empty_not_error(logs_client: TestClient, hermes_home_with_logs: Path) -> None:
    (hermes_home_with_logs / "logs" / "gateway.log").unlink()
    resp = logs_client.get("/api/logs", params={"file": "gateway.log"})
    assert resp.status_code == 200
    assert resp.json()["lines"] == []


def test_unauthenticated_request_rejected(make_client: Callable[..., TestClient], hermes_home_with_logs: Path) -> None:
    client = make_client(hermes_home=hermes_home_with_logs)
    resp = client.get("/api/logs", params={"file": "agent.log"})
    assert resp.status_code == 401


@pytest.mark.parametrize("level,search", [
    (None, None), ("warning", None), (None, "agent"), ("info", "auxiliary"),
    (None, "REDACTED"), (None, "sk-ant-abcdefghijklmnop"), (None, "no matches"),
])
@pytest.mark.parametrize("limit", [1, 2, 200])
def test_tail_preserves_filter_order_redaction_and_truncation(
    hermes_home_with_logs: Path, level: str | None, search: str | None, limit: int,
) -> None:
    expected = [logsmod.parse_line(raw) for raw in AGENT_LOG.rstrip("\n").split("\n")]
    expected = [e for e in expected if (not level or e.level == level.upper())
                and (not search or search.lower() in e.raw.lower())]
    tail = logsmod.tail_log(hermes_home_with_logs / "logs", "agent.log", lines=limit, level=level, search=search)
    assert tail.lines == expected[-limit:]
    assert tail.truncated == (len(expected) > limit)


def test_tail_stops_parsing_after_extra_match(hermes_home_with_logs: Path, monkeypatch) -> None:
    original = logsmod.parse_line
    parsed = []

    def count(raw):
        parsed.append(raw)
        return original(raw)

    monkeypatch.setattr(logsmod, "parse_line", count)
    tail = logsmod.tail_log(hermes_home_with_logs / "logs", "agent.log", lines=2)
    assert tail.truncated
    assert len(parsed) == 3


def test_tail_normalizes_warn_and_keeps_partial_final_line(tmp_path: Path) -> None:
    (tmp_path / "agent.log").write_text("2026-09-15 00:00:00,000 WARN x: first\n2026-09-15 00:00:00,001 WARNING x: last")
    tail = logsmod.tail_log(tmp_path, "agent.log", lines=2, level="warning")
    assert [e.message for e in tail.lines] == ["first", "last"]
    assert not tail.truncated
