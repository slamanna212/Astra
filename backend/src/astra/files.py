"""Workspace file browser: guarded listing, text preview, streamed download and upload.

Scope (BUILD-SPEC §4.5, §5.6, decided by the user for Phase 1): Files browses **only** the
workspace root (``ASTRA_WORKSPACE_DIR``, defaulting to ``/workspace`` in production). Operations
are browse / preview / download / upload only — no edit, rename, delete or create-directory this
phase.

Security model (adapted from the legacy UI's guards — see
``exampledata/hermes-webui/api/{helpers,workspace}.py`` and
``exampledata/hermes-ui-handoff/audit/webui-baseline.md`` §2.5/§2.6; MIT, notice preserved below):

* Every relative path is validated (no absolute paths, no ``..``, no NUL/control bytes, no empty
  components) before it ever touches the filesystem.
* **Symlink decision: refuse ALL symlinks, unconditionally.** Every path component is opened with
  ``O_NOFOLLOW`` via ``openat(2)`` (``dir_fd``), walking from the workspace root one component at a
  time. If *any* component — including the final one — is a symlink, the open fails with ``ELOOP``
  and the request is refused. This is simpler than "refuse only symlinks that escape the root" (the
  reference UI's model) and closes a class of bugs where a symlink happens to resolve back inside
  the root but still lets an attacker read/write through a target they do not otherwise control
  (e.g. a bind-mounted secret). Listing reports ``is_symlink`` from an ``lstat`` (never followed) so
  the UI can show the entry without the backend ever resolving it.
* The anchored ``openat`` walk is also the TOCTOU defense: because every component is opened
  relative to its already-opened parent directory fd with ``O_NOFOLLOW``, a symlink swapped into
  place *after* a naive ``realpath`` check (but before a second open-by-path) cannot redirect the
  operation outside the root. This mirrors ``open_anchored_fd`` / ``open_anchored_write_fd`` in the
  reference implementation.
* A containment check (``resolved.relative_to(root)``) is still applied to the final resolved path
  as defense in depth, even though the anchored walk cannot escape the root by construction.
* A deny-wall blocks known Hermes secret/state basenames and subdirectories at any depth — relevant
  only if a workspace ever happens to contain (or be pointed at) one of these, since Files browses a
  separate root from ``HERMES_HOME`` by design.

MIT notice (guard logic adapted from ``nesquena/hermes-webui``, commit ``94fd2da83008``,
``exp-v0.52.264``, ``LICENSE`` sha256 ``ad6b89c0...``): Copyright (c) 2025 Hermes Web UI
Contributors. Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files, to deal in the Software without restriction, subject
to including the above copyright notice — see the full text in that project's ``LICENSE``.
"""

from __future__ import annotations

import errno
import mimetypes
import os
import stat as statmod
import unicodedata
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class FilesError(ValueError):
    """Base for all files-module errors that should map to a 4xx response."""


class InvalidPath(FilesError):
    """Malformed or disallowed path (traversal, absolute, NUL, empty component)."""


class SymlinkRefused(FilesError):
    """A path component is a symlink. Refused unconditionally — see module docstring."""


class DeniedPath(FilesError):
    """Path matches the deny-wall (Hermes secret/state basename or subdirectory)."""


class NotFound(FilesError):
    """Path does not exist (or a non-terminal component is not a directory)."""


class NotAFile(FilesError):
    """Path exists but is not a regular file (e.g. a directory, device, fifo)."""


class NotADirectory(FilesError):
    """Path exists but is not a directory."""


class AlreadyExists(FilesError):
    """Upload target already exists and ``overwrite`` was not requested."""


class TooLarge(FilesError):
    """Upload exceeded the configured maximum size."""


# ---------------------------------------------------------------------------
# Deny-wall (BUILD-SPEC §4.5/§5.6; reference: _DENY_FILENAMES / _DENY_SUBDIRS)
# ---------------------------------------------------------------------------

DENY_FILENAMES = frozenset(
    {".env", "auth.json", "state.db", "state.db-wal", "state.db-shm", "config.yaml", "config.yml", "jobs.json", "settings.json"}
)
DENY_SUBDIRS = frozenset(
    {"sessions", "memories", "cron", "logs", "checkpoints", "backups", "media_snapshots"}
)

MAX_LISTING_ENTRIES = 2000
# Hard cap on how many directory entries we will even *scan* before giving up and marking the
# listing truncated — bounds worst-case work for a directory with e.g. a million files.
MAX_LISTING_SCAN = 20_000
MAX_CONTENT_BYTES = 1024 * 1024  # 1 MiB text-preview cap
DOWNLOAD_CHUNK_SIZE = 64 * 1024

# Extensions treated as previewable text in addition to whatever `mimetypes` calls `text/*`.
_EXTRA_TEXT_EXTENSIONS = frozenset(
    {
        ".md", ".markdown", ".mdx", ".py", ".pyi", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
        ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bash", ".zsh",
        ".fish", ".css", ".scss", ".less", ".sql", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp",
        ".hpp", ".cc", ".rb", ".php", ".pl", ".lua", ".r", ".swift", ".m", ".gitignore", ".dockerignore",
        ".env.example", ".editorconfig", ".txt", ".log", ".csv", ".tsv", ".graphql", ".proto",
        ".xml", ".svg",  # SVG text is previewable (never executed as a preview; download forces attachment)
    }
)
_TEXT_BASENAMES = frozenset({"dockerfile", "makefile", "readme", "license", "changelog"})

_DANGEROUS_MIMES = frozenset({"text/html", "application/xhtml+xml", "image/svg+xml"})
_INLINE_DOWNLOAD_MIMES_PREFIX = ("image/",)
_INLINE_DOWNLOAD_MIMES = frozenset({"application/pdf"})

_DIR_FD_SUPPORTED = os.open in getattr(os, "supports_dir_fd", set())
_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)


# ---------------------------------------------------------------------------
# Path validation
# ---------------------------------------------------------------------------


def split_relative_path(raw: str) -> list[str]:
    """Validate a user-supplied relative path and split it into safe components.

    Rejects: absolute paths (POSIX ``/...`` or Windows drive letters), ``..`` segments, NUL or
    other control bytes, and empty components. ``.`` segments and duplicate slashes are ignored.
    """
    if raw is None:
        raise InvalidPath("path is required")
    if "\x00" in raw:
        raise InvalidPath("path contains a NUL byte")
    if any(ord(ch) < 0x20 for ch in raw):
        raise InvalidPath("path contains a control character")
    if raw.startswith("/") or raw.startswith("\\"):
        raise InvalidPath("absolute paths are not allowed")
    if len(raw) >= 2 and raw[1] == ":":
        raise InvalidPath("absolute paths are not allowed")
    parts: list[str] = []
    for segment in raw.replace("\\", "/").split("/"):
        if segment in ("", "."):
            continue
        if segment == "..":
            raise InvalidPath("path traversal ('..') is not allowed")
        norm = unicodedata.normalize("NFC", segment)
        parts.append(norm)
    return parts


def check_deny_wall(parts: list[str]) -> None:
    for part in parts:
        if part.casefold() in DENY_SUBDIRS:
            raise DeniedPath(f"access to {part!r} is not allowed")
    if parts and parts[-1].casefold() in DENY_FILENAMES:
        raise DeniedPath(f"access to {parts[-1]!r} is not allowed")


def sanitize_upload_filename(raw: str) -> str:
    """Reduce an uploaded filename to a single safe path component."""
    if not raw:
        raise InvalidPath("filename is required")
    name = raw.replace("\\", "/").split("/")[-1].strip()
    name = unicodedata.normalize("NFC", name)
    name = "".join(ch for ch in name if ord(ch) >= 0x20)
    name = name.strip().strip(".")
    if not name:
        raise InvalidPath("filename is empty after sanitization")
    if len(name) > 255:
        raise InvalidPath("filename is too long")
    return name


# ---------------------------------------------------------------------------
# Anchored (TOCTOU-safe, symlink-refusing) open
# ---------------------------------------------------------------------------


def _raise_for_oserror(exc: OSError, target_desc: str) -> None:
    if exc.errno == errno.ELOOP:
        raise SymlinkRefused(f"symlink refused: {target_desc}") from exc
    if exc.errno in (errno.ENOENT,):
        raise NotFound(target_desc) from exc
    if exc.errno == errno.ENOTDIR:
        raise NotADirectory(target_desc) from exc
    if exc.errno == errno.EEXIST:
        raise AlreadyExists(target_desc) from exc
    raise


def _open_root_fd(root: Path) -> int:
    root_resolved = root.resolve()
    flags = os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW
    try:
        return os.open(str(root_resolved), flags)
    except OSError as exc:
        _raise_for_oserror(exc, str(root))
        raise  # pragma: no cover - _raise_for_oserror always raises


@contextmanager
def anchored_dir_fd(root: Path, parts: list[str]) -> Iterator[int]:
    """Open the directory at ``root/parts`` anchored, refusing any symlink component."""
    if not _DIR_FD_SUPPORTED:
        raise RuntimeError("this platform lacks dir_fd support required for anchored opens")
    fd = _open_root_fd(root)
    try:
        for part in parts:
            flags = os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW
            try:
                nfd = os.open(part, flags, dir_fd=fd)
            except OSError as exc:
                _raise_for_oserror(exc, part)
                raise  # pragma: no cover
            os.close(fd)
            fd = nfd
        yield fd
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


@contextmanager
def anchored_file_fd(root: Path, parts: list[str], *, flags: int, mode: int = 0o644) -> Iterator[int]:
    """Open the file at ``root/parts`` anchored, refusing any symlink component (incl. the leaf)."""
    if not parts:
        raise InvalidPath("path is required")
    if not _DIR_FD_SUPPORTED:
        raise RuntimeError("this platform lacks dir_fd support required for anchored opens")
    with anchored_dir_fd(root, parts[:-1]) as dir_fd:
        leaf = parts[-1]
        try:
            fd = os.open(leaf, flags | _O_NOFOLLOW, mode, dir_fd=dir_fd)
        except OSError as exc:
            _raise_for_oserror(exc, leaf)
            raise  # pragma: no cover
        try:
            yield fd
        finally:
            try:
                os.close(fd)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FileEntry:
    name: str
    path: str  # relative to workspace root, forward-slash separated
    is_dir: bool
    is_symlink: bool
    size: int
    mtime: float
    mime: str | None


@dataclass(frozen=True, slots=True)
class Listing:
    path: str
    entries: list[FileEntry]
    truncated: bool


def _guess_mime(name: str) -> str | None:
    mime, _ = mimetypes.guess_type(name)
    return mime


def list_directory(root: Path, raw_path: str) -> Listing:
    parts = split_relative_path(raw_path)
    check_deny_wall(parts)
    entries: list[FileEntry] = []
    truncated = False
    with anchored_dir_fd(root, parts) as dir_fd:
        scanned = 0
        with os.scandir(dir_fd) as it:
            for de in it:
                scanned += 1
                if scanned > MAX_LISTING_SCAN:
                    truncated = True
                    break
                try:
                    st = de.stat(follow_symlinks=False)
                except OSError:
                    continue
                is_symlink = statmod.S_ISLNK(st.st_mode)
                is_dir = (not is_symlink) and statmod.S_ISDIR(st.st_mode)
                rel = "/".join((*parts, de.name))
                entries.append(
                    FileEntry(
                        name=de.name,
                        path=rel,
                        is_dir=is_dir,
                        is_symlink=is_symlink,
                        size=0 if is_dir else int(st.st_size),
                        mtime=float(st.st_mtime),
                        mime=None if (is_dir or is_symlink) else _guess_mime(de.name),
                    )
                )

    entries.sort(key=lambda e: (not e.is_dir, e.name.casefold()))
    if len(entries) > MAX_LISTING_ENTRIES:
        entries = entries[:MAX_LISTING_ENTRIES]
        truncated = True
    return Listing(path="/".join(parts), entries=entries, truncated=truncated)


# ---------------------------------------------------------------------------
# Content preview
# ---------------------------------------------------------------------------


def is_previewable_text(name: str, mime: str | None) -> bool:
    if mime and (mime.startswith("text/") or mime in {"application/json", "application/xml", "application/x-yaml"}):
        return True
    ext = Path(name).suffix.lower()
    if ext in _EXTRA_TEXT_EXTENSIONS:
        return True
    if Path(name).name.lower() in _TEXT_BASENAMES:
        return True
    return False


@dataclass(frozen=True, slots=True)
class FileMeta:
    path: str
    name: str
    size: int
    mtime: float
    mime: str | None


@dataclass(frozen=True, slots=True)
class TextContent:
    meta: FileMeta
    content: str
    truncated: bool


def _stat_regular_file(root: Path, parts: list[str]) -> tuple[os.stat_result, str | None]:
    if not parts:
        raise InvalidPath("path is required")
    with anchored_dir_fd(root, parts[:-1]) as dir_fd:
        leaf = parts[-1]
        try:
            st = os.stat(leaf, dir_fd=dir_fd, follow_symlinks=False)
        except OSError as exc:
            _raise_for_oserror(exc, leaf)
            raise  # pragma: no cover
        if statmod.S_ISLNK(st.st_mode):
            raise SymlinkRefused(f"symlink refused: {leaf}")
        if not statmod.S_ISREG(st.st_mode):
            raise NotAFile(f"not a regular file: {leaf}")
        return st, _guess_mime(leaf)


def get_file_meta(root: Path, raw_path: str) -> FileMeta:
    parts = split_relative_path(raw_path)
    check_deny_wall(parts)
    st, mime = _stat_regular_file(root, parts)
    return FileMeta(path="/".join(parts), name=parts[-1], size=int(st.st_size), mtime=float(st.st_mtime), mime=mime)


def read_text_preview(root: Path, raw_path: str, *, max_bytes: int = MAX_CONTENT_BYTES) -> TextContent:
    parts = split_relative_path(raw_path)
    check_deny_wall(parts)
    st, mime = _stat_regular_file(root, parts)
    meta = FileMeta(path="/".join(parts), name=parts[-1], size=int(st.st_size), mtime=float(st.st_mtime), mime=mime)
    if not is_previewable_text(parts[-1], mime):
        raise NotAFile(f"not previewable as text (mime={mime})")
    with anchored_file_fd(root, parts, flags=os.O_RDONLY) as fd:
        raw = os.read(fd, max_bytes + 1)
    truncated = len(raw) > max_bytes
    if truncated:
        raw = raw[:max_bytes]
    text = raw.decode("utf-8", errors="replace")
    return TextContent(meta=meta, content=text, truncated=truncated)


# ---------------------------------------------------------------------------
# Download (streamed)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DownloadTarget:
    meta: FileMeta
    disposition: str  # "inline" | "attachment"
    csp_sandbox: bool


def _classify_download(meta: FileMeta) -> DownloadTarget:
    effective_mime = meta.mime or "application/octet-stream"
    if effective_mime in _DANGEROUS_MIMES:
        # text/html, application/xhtml+xml, image/svg+xml can execute script in the browser:
        # always force download, never inline.
        return DownloadTarget(meta=meta, disposition="attachment", csp_sandbox=False)
    if effective_mime in _INLINE_DOWNLOAD_MIMES or effective_mime.startswith(_INLINE_DOWNLOAD_MIMES_PREFIX):
        return DownloadTarget(meta=meta, disposition="inline", csp_sandbox=True)
    return DownloadTarget(meta=meta, disposition="attachment", csp_sandbox=False)


def resolve_download(root: Path, raw_path: str) -> DownloadTarget:
    """Classify a download target without opening it (used only where a pre-check is convenient)."""
    parts = split_relative_path(raw_path)
    check_deny_wall(parts)
    st, mime = _stat_regular_file(root, parts)
    meta = FileMeta(path="/".join(parts), name=parts[-1], size=int(st.st_size), mtime=float(st.st_mtime), mime=mime)
    return _classify_download(meta)


def open_for_download(root: Path, raw_path: str) -> tuple[int, DownloadTarget]:
    """Open ``raw_path`` for streaming download: one anchored, symlink-refusing, TOCTOU-safe open.

    Returns an **owned** fd (the caller must close it, e.g. after streaming) plus the classified
    :class:`DownloadTarget`. Using a single open (rather than stat-then-reopen) means there is no
    window between the security check and the read where a swapped symlink could matter — the fd
    handed back already points at the exact inode that was validated.
    """
    parts = split_relative_path(raw_path)
    check_deny_wall(parts)
    if not parts:
        raise InvalidPath("path is required")
    with anchored_dir_fd(root, parts[:-1]) as dir_fd:
        leaf = parts[-1]
        try:
            fd = os.open(leaf, os.O_RDONLY | _O_NOFOLLOW, dir_fd=dir_fd)
        except OSError as exc:
            _raise_for_oserror(exc, leaf)
            raise  # pragma: no cover
    try:
        st = os.fstat(fd)
        if not statmod.S_ISREG(st.st_mode):
            raise NotAFile(f"not a regular file: {leaf}")
        meta = FileMeta(path="/".join(parts), name=leaf, size=int(st.st_size), mtime=float(st.st_mtime), mime=_guess_mime(leaf))
        return fd, _classify_download(meta)
    except BaseException:
        os.close(fd)
        raise


def iter_fd_chunks(fd: int, *, chunk_size: int = DOWNLOAD_CHUNK_SIZE) -> Iterator[bytes]:
    """Yield chunks from an already-opened fd, closing it when done or on early termination."""
    try:
        while True:
            chunk = os.read(fd, chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class UploadResult:
    path: str
    size: int


def save_upload_stream(
    root: Path,
    dir_raw_path: str,
    filename: str,
    chunks: Iterator[bytes],
    *,
    overwrite: bool,
    max_bytes: int,
) -> UploadResult:
    """Stream ``chunks`` to a new file under ``dir_raw_path``, never buffering the whole upload.

    Refuses to write through a symlink (leaf or any parent component), refuses traversal, refuses
    the deny-wall, and refuses overwriting an existing file unless ``overwrite=True`` (in which case
    the existing target must still not be a symlink — the anchored open's ``O_NOFOLLOW`` enforces
    that even for the overwrite path). Deletes the partial file if the size cap is exceeded or the
    upload otherwise fails.
    """
    dir_parts = split_relative_path(dir_raw_path)
    check_deny_wall(dir_parts)
    name = sanitize_upload_filename(filename)
    all_parts = [*dir_parts, name]
    check_deny_wall(all_parts)

    flags = os.O_WRONLY | os.O_CREAT
    flags |= os.O_TRUNC if overwrite else os.O_EXCL

    written = 0
    with anchored_dir_fd(root, dir_parts) as dir_fd:
        try:
            fd = os.open(name, flags | _O_NOFOLLOW, 0o644, dir_fd=dir_fd)
        except OSError as exc:
            _raise_for_oserror(exc, name)
            raise  # pragma: no cover
        try:
            for chunk in chunks:
                written += len(chunk)
                if written > max_bytes:
                    raise TooLarge(f"upload exceeds the {max_bytes}-byte limit")
                os.write(fd, chunk)
        except BaseException:
            try:
                os.close(fd)
            finally:
                try:
                    os.unlink(name, dir_fd=dir_fd)
                except OSError:
                    pass
            raise
        else:
            os.close(fd)
    return UploadResult(path="/".join(all_parts), size=written)
