from __future__ import annotations

import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astra.workspace_git import parse_porcelain_v2
from tests.conftest import login

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")

GIT_ID = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"]


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *GIT_ID, *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    repo = root / "proj"
    repo.mkdir(parents=True)
    (root / "plain").mkdir()
    git(repo, "init", "-q", "-b", "main")
    (repo / "a.txt").write_text("one\n")
    (repo / "b.txt").write_text("two\n")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "init")
    (repo / "sub").mkdir()
    return root


@pytest.fixture
def git_client(make_client: Callable[..., TestClient], workspace: Path) -> TestClient:
    client = make_client(workspace_dir=workspace)
    login(client)
    return client


def test_not_a_repo(git_client: TestClient) -> None:
    for path in ("", "plain"):
        resp = git_client.get("/api/files/git", params={"path": path})
        assert resp.status_code == 200
        assert resp.json()["repo"] is False


def test_clean_repo(git_client: TestClient) -> None:
    body = git_client.get("/api/files/git", params={"path": "proj"}).json()
    assert body["repo"] is True
    assert body["branch"] == "main"
    assert body["dirty"] is False
    assert body["head"] and len(body["head"]) == 7
    # A subdirectory reports its enclosing repo.
    assert git_client.get("/api/files/git", params={"path": "proj/sub"}).json()["branch"] == "main"


def test_dirty_counts(git_client: TestClient, workspace: Path) -> None:
    repo = workspace / "proj"
    (repo / "a.txt").write_text("changed\n")
    (repo / "b.txt").write_text("staged\n")
    git(repo, "add", "b.txt")
    (repo / "new.txt").write_text("new\n")
    body = git_client.get("/api/files/git", params={"path": "proj"}).json()
    assert body["dirty"] is True
    assert (body["staged"], body["unstaged"], body["untracked"]) == (1, 1, 1)


def test_detached_head(git_client: TestClient, workspace: Path) -> None:
    git(workspace / "proj", "checkout", "-q", "--detach")
    body = git_client.get("/api/files/git", params={"path": "proj"}).json()
    assert body["repo"] is True and body["branch"] is None


def test_repo_config_cannot_execute_commands(git_client: TestClient, workspace: Path, tmp_path: Path) -> None:
    repo = workspace / "proj"
    marker = tmp_path / "pwned"
    script = tmp_path / "evil.sh"
    script.write_text(f"#!/bin/sh\ntouch {marker}\ncat\n")
    script.chmod(0o755)
    git(repo, "config", "core.fsmonitor", str(script))
    git(repo, "config", "filter.evil.clean", str(script))
    git(repo, "config", "filter.evil.required", "true")
    (repo / ".gitattributes").write_text("*.txt filter=evil\n")
    (repo / "a.txt").write_text("touched\n")
    body = git_client.get("/api/files/git", params={"path": "proj"}).json()
    assert body["repo"] is True
    assert not marker.exists()


def test_outer_repo_is_not_reported(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    outer = tmp_path / "outer"
    (outer / "workspace").mkdir(parents=True)
    git(outer, "init", "-q")
    client = make_client(workspace_dir=outer / "workspace")
    login(client)
    assert client.get("/api/files/git", params={"path": ""}).json()["repo"] is False


def test_path_guards(git_client: TestClient, workspace: Path, tmp_path: Path) -> None:
    (workspace / "link").symlink_to(workspace / "proj", target_is_directory=True)
    assert git_client.get("/api/files/git", params={"path": "link"}).status_code == 400
    assert git_client.get("/api/files/git", params={"path": "../"}).status_code == 400
    assert git_client.get("/api/files/git", params={"path": "missing"}).status_code == 404


def test_requires_auth(make_client: Callable[..., TestClient], workspace: Path) -> None:
    client = make_client(workspace_dir=workspace)
    assert client.get("/api/files/git").status_code == 401


def test_parse_ahead_behind_and_conflicts() -> None:
    out = (
        b"# branch.oid 0123456789abcdef\0# branch.head feat\0# branch.upstream origin/feat\0"
        b"# branch.ab +2 -3\0u UU N... 100644 100644 100644 100644 a b c file.txt\0? x\0"
    )
    st = parse_porcelain_v2(out)
    assert (st.branch, st.head, st.upstream, st.ahead, st.behind) == ("feat", "0123456", "origin/feat", 2, 3)
    assert st.conflicted == 1 and st.untracked == 1 and st.dirty
