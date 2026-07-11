from __future__ import annotations
from urllib.parse import urlparse
def require_http_url(value: str, field="URL") -> str:
    value=(value or "").strip()
    parsed=urlparse(value)
    if value and parsed.scheme not in {"http","https"}:
        raise ValueError(f"{field} deve começar com http:// ou https://")
    return value
def clamp_text(value, max_length=500):
    return str(value or "").strip()[:max_length]
