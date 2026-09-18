"""Read-only git branch / dirty status for a workspace directory (the Files header badge).

Only ever runs ``git config`` (reads) and ``git status``; never a mutating command.

Hardening (adapted from ``exampledata/hermes-webui/api/workspace_git.py``, MIT — see the notice in
``astra/files.py``): workspace repos are written by the agent, so repo-local configuration is
treated as untrusted and must not turn a status read into command execution.

* ``core.fsmonitor`` is forced off and ``core.hooksPath`` pointed at ``/dev/null``.
* Every repo-configured ``filter.<name>`` driver (``clean``/``smudge``/``process``) is overridden to
  empty via ``GIT_CONFIG_COUNT`` — ``git status`` may run clean filters on racily-clean files.
* Submodules are ignored entirely (no recursion into nested repos and their configs).
* The environment is scrubbed of ``GIT_DIR``/``GIT_CONFIG_*``-style overrides, prompts are
  disabled, optional locks are skipped, and every call has a short timeout.
* ``GIT_CEILING_DIRECTORIES`` stops repository discovery at the workspace root, so a workspace that
  happens to live inside some other checkout never reports that outer repo.
* The target directory is opened with the same anchored, symlink-refusing walk as Files, and git
  runs with its cwd set to that already-opened fd (``/proc/self/fd/N``), never a re-resolved path.
"""

from __future__ import annotations

import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from astra import files as filesmod

log = logging.getLogger(__name__)

GIT_TIMEOUT_S = 5.0

_HARDENED_CONFIG = (
    ("core.fsmonitor", "false"),
    ("core.hooksPath", "/dev/null"),
    ("core.sshCommand", "ssh"),
    ("core.askPass", ""),
    ("credential.helper", ""),
    ("protocol.ext.allow", "never"),
    ("submodule.recurse", "false"),
)
_ENV_SCRUB_KEYS = (
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_EXTERNAL_DIFF",
    "GIT_PAGER",
    "GIT_EDITOR",
)
_ENV_SCRUB_PREFIXES = ("GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_", "GIT_TRACE")
_FILTER_KEYS = ("clean", "smudge", "process")


@dataclass(frozen=True, slots=True)
class GitStatus:
    branch: str | None  # None when HEAD is detached
    head: str | None  # short commit id; None on an unborn branch
    upstream: str | None
    ahead: int
    behind: int
    staged: int
    unstaged: int
    untracked: int
    conflicted: int

    @property
    def dirty(self) -> bool:
        return bool(self.staged or self.unstaged or self.untracked or self.conflicted)


def _base_env(ceiling: Path) -> dict[str, str]:
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in _ENV_SCRUB_KEYS and not k.startswith(_ENV_SCRUB_PREFIXES)
    }
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["GIT_CEILING_DIRECTORIES"] = str(ceiling)
    env["LC_ALL"] = "C"
    return env


def _run(cwd_fd: int, args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[bytes] | None:
    argv = ["git"]
    for key, value in _HARDENED_CONFIG:
        argv.extend(["-c", f"{key}={value}"])
    argv.extend(args)
    try:
        return subprocess.run(
            argv,
            cwd=f"/proc/self/fd/{cwd_fd}",
            pass_fds=(cwd_fd,),
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=GIT_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        log.info("git %s failed: %s", args[0], type(exc).__name__)
        return None


def _filter_overrides(cwd_fd: int, env: dict[str, str]) -> dict[str, str]:
    """Neutralize every configured filter driver so status never executes one."""
    proc = _run(cwd_fd, ["config", "--null", "--name-only", "--get-regexp", r"^filter\."], env)
    names: set[str] = set()
    if proc is not None and proc.returncode == 0:
        for key in proc.stdout.decode("utf-8", "replace").split("\0"):
            # filter.<name>.<var> — <name> may itself contain dots.
            if key.startswith("filter.") and key.count(".") >= 2:
                names.add(key[len("filter.") : key.rindex(".")])
    overrides: list[tuple[str, str]] = []
    for name in sorted(names):
        overrides.extend((f"filter.{name}.{var}", "") for var in _FILTER_KEYS)
        overrides.append((f"filter.{name}.required", "false"))
    extra = {"GIT_CONFIG_COUNT": str(len(overrides))}
    for i, (key, value) in enumerate(overrides):
        extra[f"GIT_CONFIG_KEY_{i}"] = key
        extra[f"GIT_CONFIG_VALUE_{i}"] = value
    return extra


def parse_porcelain_v2(output: bytes) -> GitStatus:
    """Parse ``git status --porcelain=v2 --branch -z`` output."""
    branch: str | None = None
    head: str | None = None
    upstream: str | None = None
    ahead = behind = staged = unstaged = untracked = conflicted = 0
    records = output.decode("utf-8", "replace").split("\0")
    skip_next = False
    for rec in records:
        if skip_next:  # the original path of a rename/copy record
            skip_next = False
            continue
        if not rec:
            continue
        if rec.startswith("# branch.oid "):
            oid = rec[len("# branch.oid ") :]
            head = None if oid == "(initial)" else oid[:7]
        elif rec.startswith("# branch.head "):
            name = rec[len("# branch.head ") :]
            branch = None if name == "(detached)" else name
        elif rec.startswith("# branch.upstream "):
            upstream = rec[len("# branch.upstream ") :]
        elif rec.startswith("# branch.ab "):
            for token in rec[len("# branch.ab ") :].split():
                if token.startswith("+"):
                    ahead = int(token[1:])
                elif token.startswith("-"):
                    behind = int(token[1:])
        elif rec[0] in "12":
            xy = rec[2:4]
            if xy[0] != ".":
                staged += 1
            if xy[1] != ".":
                unstaged += 1
            skip_next = rec[0] == "2"
        elif rec[0] == "u":
            conflicted += 1
        elif rec[0] == "?":
            untracked += 1
    return GitStatus(
        branch=branch,
        head=head,
        upstream=upstream,
        ahead=ahead,
        behind=behind,
        staged=staged,
        unstaged=unstaged,
        untracked=untracked,
        conflicted=conflicted,
    )


def git_status(root: Path, raw_path: str) -> GitStatus | None:
    """Status of the repo containing ``root/raw_path``, or None if it is not inside a repo.

    Raises ``files.FilesError`` for invalid/denied/symlinked/missing paths, same as Files.
    """
    parts = filesmod.split_relative_path(raw_path)
    filesmod.check_deny_wall(parts)
    env = _base_env(root.resolve().parent)
    with filesmod.anchored_dir_fd(root, parts) as dir_fd:
        env.update(_filter_overrides(dir_fd, env))
        proc = _run(
            dir_fd,
            [
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=normal",
                "--ignore-submodules=all",
                "--no-renames",
            ],
            env,
        )
    if proc is None or proc.returncode != 0:
        # Not a repo (the common case), git missing, or e.g. a "dubious ownership" refusal.
        return None
    return parse_porcelain_v2(proc.stdout)
