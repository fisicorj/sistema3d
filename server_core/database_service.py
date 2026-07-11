from __future__ import annotations
import sqlite3
from pathlib import Path
def validate_sqlite(path: Path) -> tuple[bool,str]:
    try:
        con=sqlite3.connect(str(path)); result=con.execute("PRAGMA quick_check").fetchone(); con.close()
        ok=bool(result and result[0]=="ok")
        return ok, result[0] if result else "sem resposta"
    except Exception as exc:
        return False, str(exc)
def database_metadata(path: Path) -> dict:
    ok,check=validate_sqlite(path)
    return {"exists":path.exists(),"size":path.stat().st_size if path.exists() else 0,"quick_check":check,"valid":ok}
