"""Single-user authentication: scrypt password hash + HMAC-signed session cookie. Stdlib only."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass, field

COOKIE_NAME = "astra_session"
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
CLOCK_SKEW_SECONDS = 60

CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "astra"

# scrypt defaults: N=2^15, r=8, p=1 (~32 MiB, tens of ms)
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
SCRYPT_SALT_BYTES = 16


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


@dataclass(frozen=True, slots=True)
class ParsedHash:
    n: int
    r: int
    p: int
    salt: bytes
    digest: bytes


def _maxmem(n: int, r: int, p: int) -> int:
    return 128 * r * (n + p + 2) + 16 * 1024 * 1024


def parse_password_hash(encoded: str) -> ParsedHash:
    """Parse ``scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>``; raises ValueError if malformed."""
    parts = encoded.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        raise ValueError("expected format scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>")
    try:
        n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
        salt, digest = _b64d(parts[4]), _b64d(parts[5])
    except (ValueError, binascii.Error):
        raise ValueError("non-numeric parameters or invalid base64") from None
    if n < 2**14 or n & (n - 1) or not (1 <= r <= 32) or not (1 <= p <= 16):
        raise ValueError("scrypt parameters out of range (n must be a power of two >= 16384)")
    if len(salt) < 16 or len(digest) < 32:
        raise ValueError("salt or digest too short")
    return ParsedHash(n, r, p, salt, digest)


def hash_password(password: str, *, n: int = SCRYPT_N, r: int = SCRYPT_R, p: int = SCRYPT_P) -> str:
    salt = secrets.token_bytes(SCRYPT_SALT_BYTES)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=SCRYPT_DKLEN, maxmem=_maxmem(n, r, p)
    )
    return f"scrypt${n}${r}${p}${_b64e(salt)}${_b64e(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    """Constant-time verification. Blocking (~tens of ms): call from a worker thread."""
    try:
        parsed = parse_password_hash(encoded)
    except ValueError:
        return False
    candidate = hashlib.scrypt(
        password.encode("utf-8"),
        salt=parsed.salt,
        n=parsed.n,
        r=parsed.r,
        p=parsed.p,
        dklen=len(parsed.digest),
        maxmem=_maxmem(parsed.n, parsed.r, parsed.p),
    )
    return hmac.compare_digest(candidate, parsed.digest)


# ---------------------------------------------------------------------------
# Signed session tokens
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SessionToken:
    issued_at: int
    expires_at: int
    nonce: str


def _sign(secret: bytes, payload_b64: str) -> str:
    return _b64e(hmac.new(secret, payload_b64.encode("ascii"), hashlib.sha256).digest())


def issue_token(secret: bytes, *, now: float | None = None, ttl: int = SESSION_TTL_SECONDS) -> tuple[str, SessionToken]:
    issued = int(now if now is not None else time.time())
    token = SessionToken(issued_at=issued, expires_at=issued + ttl, nonce=secrets.token_hex(16))
    payload = json.dumps(
        {"iat": token.issued_at, "exp": token.expires_at, "nonce": token.nonce},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    payload_b64 = _b64e(payload)
    return f"{payload_b64}.{_sign(secret, payload_b64)}", token


def verify_token(secret: bytes, value: str | None, *, now: float | None = None) -> SessionToken | None:
    """Return the decoded token if the signature is valid and it is not expired, else None."""
    if not value or value.count(".") != 1 or len(value) > 512:
        return None
    payload_b64, signature = value.split(".", 1)
    if not hmac.compare_digest(_sign(secret, payload_b64), signature):
        return None
    try:
        data = json.loads(_b64d(payload_b64))
        token = SessionToken(
            issued_at=int(data["iat"]), expires_at=int(data["exp"]), nonce=str(data["nonce"])
        )
    except (ValueError, KeyError, TypeError, binascii.Error):
        return None
    current = now if now is not None else time.time()
    if token.expires_at <= current or token.issued_at > current + CLOCK_SKEW_SECONDS:
        return None
    return token


class RevokedNonces:
    """In-memory logout revocation list (pruned at token expiry).

    Stateless cookies cannot be revoked across restarts; rotating ASTRA_SESSION_SECRET
    invalidates every session.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, int] = {}

    def revoke(self, token: SessionToken) -> None:
        with self._lock:
            self._prune()
            self._items[token.nonce] = token.expires_at

    def is_revoked(self, token: SessionToken) -> bool:
        with self._lock:
            return token.nonce in self._items

    def _prune(self) -> None:
        now = time.time()
        for nonce in [k for k, exp in self._items.items() if exp <= now]:
            del self._items[nonce]


# ---------------------------------------------------------------------------
# Login rate limiting
# ---------------------------------------------------------------------------


@dataclass
class LoginRateLimiter:
    """Sliding window: ``max_failures`` failed logins per ``window_seconds`` per client key."""

    max_failures: int = 5
    window_seconds: float = 300.0
    max_tracked_clients: int = 10_000
    _failures: dict[str, deque[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def _window(self, key: str, now: float) -> deque[float]:
        q = self._failures.setdefault(key, deque())
        while q and q[0] <= now - self.window_seconds:
            q.popleft()
        return q

    def retry_after(self, key: str, *, now: float | None = None) -> int | None:
        """Seconds until another attempt is allowed, or None if allowed now."""
        current = now if now is not None else time.monotonic()
        with self._lock:
            q = self._window(key, current)
            if len(q) < self.max_failures:
                if not q:
                    self._failures.pop(key, None)
                return None
            return max(1, int(q[0] + self.window_seconds - current) + 1)

    def record_failure(self, key: str, *, now: float | None = None) -> None:
        current = now if now is not None else time.monotonic()
        with self._lock:
            if len(self._failures) >= self.max_tracked_clients and key not in self._failures:
                self._prune(current)
            self._window(key, current).append(current)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    def _prune(self, now: float) -> None:
        for key in list(self._failures):
            if not self._window(key, now):
                del self._failures[key]
