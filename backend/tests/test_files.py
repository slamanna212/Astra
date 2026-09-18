from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astra import files as filesmod
from tests.conftest import CSRF, login


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    (root / "notes").mkdir(parents=True)
    (root / "notes" / "todo.txt").write_text("- buy milk\n- write tests\n")
    (root / "notes" / "readme.md").write_text("# Notes\n\nHello **world**.\n")
    (root / "empty_dir").mkdir()
    (root / "big.txt").write_text("x" * (filesmod.MAX_CONTENT_BYTES + 100))
    (root / "image.png").write_bytes(b"\x89PNG\r\n\x1a\nnotarealpngbutthatsok")
    (root / "page.html").write_text("<html><body>hi</body></html>")
    (root / "icon.svg").write_text("<svg></svg>")
    (root / "config.yaml").write_text("secret: nope\n")
    (root / "logs").mkdir()
    (root / "logs" / "agent.log").write_text("should never be listed via Files\n")

    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("outside the workspace root\n")
    (root / "escape.txt").symlink_to(outside / "secret.txt")
    (root / "escape_dir").symlink_to(outside, target_is_directory=True)
    return root


@pytest.fixture
def files_client(make_client: Callable[..., TestClient], workspace: Path) -> TestClient:
    client = make_client(workspace_dir=workspace, upload_max_bytes=1024)
    login(client)
    return client


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def test_list_root_sorted_dirs_first(files_client: TestClient) -> None:
    resp = files_client.get("/api/files", params={"path": ""})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    names = [e["name"] for e in body["entries"]]
    # escape_dir is a symlink: per our "refuse ALL symlinks" decision it is reported as a
    # non-directory (is_dir comes from an lstat, never followed), so it sorts with the files.
    dirs = {"notes", "empty_dir", "logs"}
    first_file_index = min(i for i, n in enumerate(names) if n not in dirs)
    assert all(n in dirs for n in names[:first_file_index])
    assert names == sorted(names, key=lambda n: (n not in dirs, n.casefold()))


def test_list_symlinked_entries_reported_but_not_followed(files_client: TestClient) -> None:
    resp = files_client.get("/api/files", params={"path": ""})
    entries = {e["name"]: e for e in resp.json()["entries"]}
    assert entries["escape.txt"]["is_symlink"] is True
    assert entries["escape.txt"]["is_dir"] is False
    assert entries["escape_dir"]["is_symlink"] is True
    assert entries["escape_dir"]["is_dir"] is False


def test_list_nested_directory(files_client: TestClient) -> None:
    resp = files_client.get("/api/files", params={"path": "notes"})
    assert resp.status_code == 200
    names = {e["name"] for e in resp.json()["entries"]}
    assert names == {"todo.txt", "readme.md"}


# ---------------------------------------------------------------------------
# Path validation / traversal
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_path",
    [
        "../outside",
        "notes/../../outside",
        "..",
        "/etc/passwd",
        "notes/\x00/x",
    ],
)
def test_traversal_and_invalid_paths_rejected(files_client: TestClient, bad_path: str) -> None:
    resp = files_client.get("/api/files", params={"path": bad_path})
    assert resp.status_code == 400, resp.text


def test_windows_style_absolute_path_rejected(files_client: TestClient) -> None:
    resp = files_client.get("/api/files", params={"path": "C:/windows"})
    assert resp.status_code == 400


def test_missing_path_is_not_found(files_client: TestClient) -> None:
    resp = files_client.get("/api/files", params={"path": "does/not/exist"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Symlink refusal (decision: refuse ALL symlinks, not just escaping ones)
# ---------------------------------------------------------------------------


def test_descending_into_symlinked_directory_refused(files_client: TestClient) -> None:
    resp = files_client.get("/api/files", params={"path": "escape_dir"})
    assert resp.status_code == 400, resp.text


def test_reading_through_symlink_refused(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/content", params={"path": "escape.txt"})
    assert resp.status_code == 400, resp.text


def test_downloading_through_symlink_refused(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/download", params={"path": "escape.txt"})
    assert resp.status_code == 400, resp.text


def test_uploading_into_symlinked_directory_refused(files_client: TestClient) -> None:
    resp = files_client.post(
        "/api/files/upload",
        data={"directory": "escape_dir"},
        files={"file": ("x.txt", b"hi", "text/plain")},
        headers=CSRF,
    )
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# Deny-wall
# ---------------------------------------------------------------------------


def test_deny_wall_blocks_listing_logs_subdir(files_client: TestClient) -> None:
    resp = files_client.get("/api/files", params={"path": "logs"})
    assert resp.status_code == 400, resp.text


def test_deny_wall_blocks_config_yaml_content(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/content", params={"path": "config.yaml"})
    assert resp.status_code == 400, resp.text


def test_deny_wall_blocks_config_yaml_download(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/download", params={"path": "config.yaml"})
    assert resp.status_code == 400, resp.text


def test_deny_wall_applies_at_any_depth(files_client: TestClient) -> None:
    resp = files_client.get("/api/files", params={"path": "notes/logs/whatever"})
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# Content preview
# ---------------------------------------------------------------------------


def test_text_preview(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/content", params={"path": "notes/todo.txt"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["previewable"] is True
    assert "buy milk" in body["content"]
    assert body["truncated"] is False


def test_text_preview_truncates_at_cap(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/content", params={"path": "big.txt"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["truncated"] is True
    assert len(body["content"]) == filesmod.MAX_CONTENT_BYTES


def test_binary_like_extension_not_previewed_reports_metadata(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/content", params={"path": "image.png"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["previewable"] is False
    assert body["content"] is None
    assert body["meta"]["size"] > 0


# ---------------------------------------------------------------------------
# Download disposition guards
# ---------------------------------------------------------------------------


def test_html_download_forces_attachment(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/download", params={"path": "page.html"})
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_svg_download_forces_attachment(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/download", params={"path": "icon.svg"})
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]


def test_png_download_is_inline_with_sandbox_csp(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/download", params={"path": "image.png"})
    assert resp.status_code == 200
    assert "inline" in resp.headers["content-disposition"]
    assert resp.headers.get("content-security-policy") == "sandbox"
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_text_download_forces_attachment(files_client: TestClient) -> None:
    resp = files_client.get("/api/files/download", params={"path": "notes/todo.txt"})
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.content == b"- buy milk\n- write tests\n"


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


def test_upload_creates_file(files_client: TestClient, workspace: Path) -> None:
    resp = files_client.post(
        "/api/files/upload",
        data={"directory": "notes"},
        files={"file": ("new.txt", b"hello upload", "text/plain")},
        headers=CSRF,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["path"] == "notes/new.txt"
    assert (workspace / "notes" / "new.txt").read_bytes() == b"hello upload"


def test_upload_without_overwrite_conflicts(files_client: TestClient) -> None:
    resp = files_client.post(
        "/api/files/upload",
        data={"directory": "notes"},
        files={"file": ("todo.txt", b"clobber", "text/plain")},
        headers=CSRF,
    )
    assert resp.status_code == 409, resp.text


def test_upload_with_overwrite_replaces(files_client: TestClient, workspace: Path) -> None:
    resp = files_client.post(
        "/api/files/upload",
        data={"directory": "notes", "overwrite": "true"},
        files={"file": ("todo.txt", b"clobbered", "text/plain")},
        headers=CSRF,
    )
    assert resp.status_code == 200, resp.text
    assert (workspace / "notes" / "todo.txt").read_bytes() == b"clobbered"


def test_upload_oversize_rejected(files_client: TestClient) -> None:
    # files_client's workspace was built with upload_max_bytes=1024.
    resp = files_client.post(
        "/api/files/upload",
        data={"directory": ""},
        files={"file": ("big.bin", b"x" * 2048, "application/octet-stream")},
        headers=CSRF,
    )
    assert resp.status_code == 413, resp.text


def test_upload_oversize_does_not_leave_partial_file(files_client: TestClient, workspace: Path) -> None:
    files_client.post(
        "/api/files/upload",
        data={"directory": ""},
        files={"file": ("orphan.bin", b"x" * 2048, "application/octet-stream")},
        headers=CSRF,
    )
    assert not (workspace / "orphan.bin").exists()


def test_upload_directory_traversal_rejected(files_client: TestClient) -> None:
    resp = files_client.post(
        "/api/files/upload",
        data={"directory": "../outside"},
        files={"file": ("x.txt", b"hi", "text/plain")},
        headers=CSRF,
    )
    assert resp.status_code == 400


def test_upload_filename_is_sanitized_to_basename(files_client: TestClient, workspace: Path) -> None:
    resp = files_client.post(
        "/api/files/upload",
        data={"directory": ""},
        files={"file": ("../../etc/sneaky.txt", b"hi", "text/plain")},
        headers=CSRF,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["path"] == "sneaky.txt"
    assert (workspace / "sneaky.txt").read_bytes() == b"hi"


def test_upload_into_deny_walled_directory_rejected(files_client: TestClient) -> None:
    resp = files_client.post(
        "/api/files/upload",
        data={"directory": "logs"},
        files={"file": ("x.txt", b"hi", "text/plain")},
        headers=CSRF,
    )
    assert resp.status_code == 400


def test_unauthenticated_request_rejected(make_client: Callable[..., TestClient], workspace: Path) -> None:
    client = make_client(workspace_dir=workspace)
    resp = client.get("/api/files", params={"path": ""})
    assert resp.status_code == 401
