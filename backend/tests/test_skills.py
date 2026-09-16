from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from tests.test_cron import cron_client, cron_home, cron_password_hash, cron_settings  # noqa: F401
from tests.conftest import CSRF


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
