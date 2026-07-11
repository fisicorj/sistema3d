from __future__ import annotations
import json
from pathlib import Path
from threading import RLock
_LOCK=RLock()
def load_json(path: Path, defaults=None):
    with _LOCK:
        try:
            if path.exists():
                data=json.loads(path.read_text(encoding="utf-8"))
                return {**(defaults or {}), **data} if isinstance(data,dict) else (defaults or {})
        except (OSError, json.JSONDecodeError):
            pass
        return dict(defaults or {})
def save_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    with _LOCK:
        tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
        tmp.replace(path)
