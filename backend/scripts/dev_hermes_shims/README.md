# Dev-only Hermes shims

`exampledata/hermes-ui-handoff/hermes-agent-src` (used as `ASTRA_HERMES_SRC` in local dev) is
missing 14 of the 1,067 `.py` files listed in its own `hermes_agent.egg-info/SOURCES.txt` —
verified 2026-09-16 by diffing `SOURCES.txt` against the files actually on disk. Two of the
missing files, `utils.py` and `hermes_time.py`, are top-level modules imported by `cron/jobs.py`,
`hermes_cli/config.py`, and `tools/skills_tool.py`, which makes `import cron.jobs` /
`import tools.skills_tool` fail outright against the example tree.

This directory provides minimal stand-ins for just the symbols Astra's read-only cron/skills
code needs those modules to expose, so the dev server and test suite can run against
`exampledata/`. They are **not** faithful reimplementations — e.g. `hermes_time.now()` here is
plain `datetime.now(UTC)`, not Hermes' configured-timezone clock — and must never be relied on
for anything that writes to `jobs.json`/`config.yaml` or computes schedules; Astra's Phase 1
cron/skills endpoints never call functions that would exercise the parts of these shims that
matter (the mutating `cron.jobs` paths and `compute_next_run` are never invoked — stored
`next_run_at`/`schedule_display` values are displayed as-is).

`astra.hermes_bridge` only appends this directory to `sys.path` (at the end, never in front of
`ASTRA_HERMES_SRC`) when `utils`/`hermes_time` are not already importable — i.e. it is a no-op
against a real Hermes install/container image, which bundles the genuine modules. See
`astra.hermes_bridge._patch_dev_hermes_gaps` for the detection logic.

If the real `hermes-agent-src` handoff tree is ever refreshed with these files present, this
directory can be deleted along with the sys.path patch.
