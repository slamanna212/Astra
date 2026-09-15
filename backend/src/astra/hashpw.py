"""Generate an ASTRA_PASSWORD_HASH: ``uv run python -m astra.hashpw``.

Reads the password from stdin when piped, otherwise prompts (twice) without echo.
"""

from __future__ import annotations

import getpass
import sys

from astra.auth import hash_password


def main() -> int:
    if sys.stdin.isatty():
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Confirm: "):
            print("Passwords do not match.", file=sys.stderr)
            return 1
    else:
        password = sys.stdin.readline().rstrip("\r\n")
    if len(password) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1
    print(hash_password(password))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
