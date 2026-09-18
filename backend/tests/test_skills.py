from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from tests.conftest import CSRF
from tests.test_cron import (  # noqa: F401, F811
    cron_client,
    cron_home,
    cron_password_hash,
    cron_settings,
)


def test_list_skills_matches_config_yaml_disabled_set(cron_client: TestClient) -> None:
    body = cron_client.get("/api/skills").json()
    disabled_names = {s["name"] for s in body["items"] if not s["enabled"]}
    # From exampledata's config.yaml `skills.disabled` list, for skills that actually exist
    # on disk (some entries in `disabled` don't correspond to an installed skill folder).
    assert "gif-search" in disabled_names
    assert "songsee" in disabled_names
    assert "hermes-agent" not in disabled_names  # ESSENTIAL_SKILLS is never disabled


def test_list_skills_excludes_archive_and_dotdirs(cron_client: TestClient) -> None:
    body = cron_client.get("/api/skills").json()
    for item in body["items"]:
        assert not item["path"].split("/")[0].startswith(".")


def test_skill_detail_has_frontmatter_and_files(cron_client: TestClient) -> None:
    items = cron_client.get("/api/skills").json()["items"]
    categorized = next(s for s in items if s["category"] == "creative" and s["name"] == "comfyui")
    detail = cron_client.get(f"/api/skills/{categorized['category']}/{categorized['name']}").json()
    assert detail["name"] == "comfyui"
    assert isinstance(detail["frontmatter"], dict)
    assert any(f.startswith("references/") for f in detail["files"])


def test_skill_supporting_file_preview_and_open(cron_client: TestClient) -> None:
    items = cron_client.get("/api/skills").json()["items"]
    categorized = next(s for s in items if s["category"] == "creative" and s["name"] == "comfyui")
    detail_path = f"/api/skills/{categorized['category']}/{categorized['name']}"
    detail = cron_client.get(detail_path).json()
    supporting_file = next(f for f in detail["files"] if f.startswith("references/") and f.endswith(".md"))

    preview = cron_client.get(f"{detail_path}/files/content", params={"path": supporting_file})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["meta"]["path"] == supporting_file
    assert body["previewable"] is True
    assert isinstance(body["content"], str)

    opened = cron_client.get(f"{detail_path}/files/open", params={"path": supporting_file})
    assert opened.status_code == 200
    assert opened.content
    assert opened.headers["content-disposition"].startswith("inline;")
    assert opened.headers["content-security-policy"] == "sandbox"
    assert opened.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in opened.headers["cache-control"]


def test_skill_supporting_files_refuse_traversal_and_symlinks(
    cron_client: TestClient, cron_home: Path
) -> None:
    base = cron_home / "skills" / "testing" / "safe-files"
    base.mkdir(parents=True)
    (base / "SKILL.md").write_text("---\nname: safe-files\n---\n\n# Safe\n", encoding="utf-8")
    (base / "notes.md").write_text("safe", encoding="utf-8")
    (base / "linked.md").symlink_to(base / "notes.md")
    endpoint = "/api/skills/testing/safe-files/files/content"

    assert cron_client.get(endpoint, params={"path": "../SKILL.md"}).status_code == 400
    assert cron_client.get(endpoint, params={"path": "/etc/passwd"}).status_code == 400
    assert cron_client.get(endpoint, params={"path": "missing.md"}).status_code == 404
    assert cron_client.get(endpoint, params={"path": "linked.md"}).status_code == 400


def test_flat_skill_binary_supporting_file_is_openable(
    cron_client: TestClient, cron_home: Path
) -> None:
    base = cron_home / "skills" / "flat-assets"
    base.mkdir(parents=True)
    (base / "SKILL.md").write_text("---\nname: flat-assets\n---\n\n# Assets\n", encoding="utf-8")
    image = b"\x89PNG\r\n\x1a\nfixture"
    (base / "preview.png").write_bytes(image)
    endpoint = "/api/skills/flat-assets/files"

    preview = cron_client.get(f"{endpoint}/content", params={"path": "preview.png"})
    assert preview.status_code == 200, preview.text
    assert preview.json()["previewable"] is False
    assert preview.json()["content"] is None
    assert preview.json()["meta"]["mime"] == "image/png"

    opened = cron_client.get(f"{endpoint}/open", params={"path": "preview.png"})
    assert opened.status_code == 200
    assert opened.content == image
    assert opened.headers["content-disposition"].startswith("inline;")
    assert opened.headers["content-security-policy"] == "sandbox"


def test_flat_skill_lookup_without_category(cron_client: TestClient) -> None:
    items = cron_client.get("/api/skills").json()["items"]
    flat = next((s for s in items if s["category"] is None), None)
    if flat is None:
        return  # no flat (uncategorized) skills in this example fleet
    resp = cron_client.get(f"/api/skills/{flat['name']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == flat["name"]


def test_skill_create_edit_toggle_delete_lifecycle(cron_client: TestClient, cron_home: Path) -> None:
    path = "/api/skills/testing/Astra Writer"
    initial = "---\nname: astra-writer\ndescription: first\n---\n\n# First\n"
    response = cron_client.put(path, headers=CSRF, json={"content": initial})
    assert response.status_code == 204, response.text
    target = cron_home / "skills" / "testing" / "astra-writer" / "SKILL.md"
    assert target.read_text(encoding="utf-8") == initial

    updated = initial.replace("first", "updated").replace("First", "Updated")
    assert cron_client.put("/api/skills/testing/astra-writer", headers=CSRF, json={"content": updated}).status_code == 204
    assert cron_client.get("/api/skills/testing/astra-writer").json()["content"] == updated

    assert cron_client.post(
        "/api/skills/testing/astra-writer/enabled", headers=CSRF, json={"enabled": False}
    ).status_code == 204
    assert cron_client.get("/api/skills/testing/astra-writer").json()["enabled"] is False
    assert cron_client.post(
        "/api/skills/testing/astra-writer/enabled", headers=CSRF, json={"enabled": True}
    ).status_code == 204

    assert cron_client.delete("/api/skills/testing/astra-writer", headers=CSRF).status_code == 204
    assert not target.exists()


def test_skills_reads_never_mutate_hermes_home_including_kanban_tagged(
    cron_client: TestClient, cron_home: Path
) -> None:
    """Regression test for the SOUL.md-creation side effect found in
    agent.skill_utils.skill_matches_environment (see skills_data.py's module docstring):
    listing/detail must never touch config.yaml/hermes_cli's "ensure home" bootstrap."""
    import hashlib

    def tree_hash(root: Path) -> str:
        h = hashlib.sha256()
        for p in sorted(root.rglob("*")):
            if p.is_file() and not p.is_symlink():
                h.update(str(p.relative_to(root)).encode())
                h.update(p.read_bytes())
        return h.hexdigest()

    before = tree_hash(cron_home)
    items = cron_client.get("/api/skills").json()["items"]
    for s in items:
        if s["category"]:
            cron_client.get(f"/api/skills/{s['category']}/{s['name']}")
        else:
            cron_client.get(f"/api/skills/{s['name']}")
    after = tree_hash(cron_home)
    assert before == after
    assert not (cron_home / "SOUL.md").exists()
