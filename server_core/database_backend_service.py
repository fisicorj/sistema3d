from __future__ import annotations
import os, tempfile, threading
from pathlib import Path
from platform_utils import safe_replace
from server_core.database_service import validate_sqlite
from server_core.relational_service import RelationalDatabaseService

class DatabaseBackendService(RelationalDatabaseService):
    """Camada relacional real. O SQLite local continua como espelho temporário
    para os módulos ainda não migrados; PostgreSQL/SQL Server usam tabelas nativas."""
    def save_snapshot(self, data: bytes):
        if not data.startswith(b"SQLite format 3"): raise ValueError("Arquivo SQLite inválido")
        self.local_db.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix="s3d_", suffix=".sqlite.tmp", dir=str(self.local_db.parent)); os.close(fd)
        tmp = Path(name); tmp.write_bytes(data)
        try:
            ok, detail = validate_sqlite(tmp)
            if not ok: raise ValueError(detail)
            safe_replace(tmp, self.local_db, retries=20, delay=0.1)
        finally:
            tmp.unlink(missing_ok=True)
        return {"ok": True, "engine": self.load_config(False)["engine"], "saved_at_ms": int(self.local_db.stat().st_mtime * 1000), "mirror_only": self.load_config(False)["engine"] != "sqlite"}

    def load_snapshot(self):
        if not self.local_db.exists(): return None, 0, "none"
        return self.local_db.read_bytes(), int(self.local_db.stat().st_mtime * 1000), "sqlite-mirror"
