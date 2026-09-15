from __future__ import annotations

import io
import json
import logging

from astra.logging import JsonFormatter, redact


def test_redacts_common_secrets() -> None:
    samples = {
        "Authorization: Bearer abc.def-ghi": "abc.def-ghi",
        "using key sk-or-v1-0123456789abcdef": "sk-or-v1-0123456789abcdef",
        "url?api_key=supersecretvalue&x=1": "supersecretvalue",
        '{"password": "hunter2"}': "hunter2",
        "OPENVIKING_API_KEY=zzz123": "zzz123",
        "token: tok_live_abc": "tok_live_abc",
        "hash scrypt$16384$8$1$c2FsdA$ZGlnZXN0": "ZGlnZXN0",
        "sha " + "a1" * 20: "a1" * 20,
        "blob " + "Zm9v" * 12: "Zm9v" * 12,
    }
    for text, secret in samples.items():
        out = redact(text)
        assert secret not in out, (text, out)
        assert "[REDACTED]" in out


def test_does_not_redact_benign_fields() -> None:
    text = "input_tokens=1234 message_count=5 source=discord"
    assert redact(text) == text


def test_json_formatter_redacts_message_and_extras() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    lg = logging.getLogger("astra.test.redact")
    lg.handlers = [handler]
    lg.propagate = False
    lg.warning("calling with Bearer abcdefgh", extra={"detail": "api_key=zzz999", "count": 3})
    record = json.loads(stream.getvalue())
    assert "abcdefgh" not in record["msg"]
    assert "zzz999" not in record["detail"]
    assert record["count"] == 3
    assert record["level"] == "WARNING"
