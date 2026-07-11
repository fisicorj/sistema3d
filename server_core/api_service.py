from __future__ import annotations
import sqlite3
from pathlib import Path

class ApiService:
    ALLOWED = {
        "clients": "SELECT id,name,email,phone,city,state,created_at FROM clients WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?",
        "products": "SELECT id,name,category,price,active,created_at FROM products WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?",
        "orders": "SELECT id,client_id,work_type,status,quantity,total_price,paid_amount,date FROM orders WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?",
        "quotes": "SELECT id,client_id,status,total_price,created_at FROM quotes WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?",
    }

    def __init__(self, db_file: Path, database_backend=None):
        self.db_file = Path(db_file)
        self._backend = database_backend

    def _use_backend(self) -> bool:
        if not self._backend: return False
        try: return self._backend.load_config().get("engine", "sqlite") != "sqlite"
        except Exception: return False

    def list_resource(self, resource: str, limit=50, offset=0):
        if resource not in self.ALLOWED: raise ValueError("Recurso inválido")
        limit = max(1, min(200, int(limit))); offset = max(0, int(offset))
        if self._use_backend():
            return self._backend.list_items(resource, limit, offset)
        with sqlite3.connect(self.db_file, timeout=10) as c:
            c.row_factory = sqlite3.Row
            rows = [dict(r) for r in c.execute(self.ALLOWED[resource], (limit, offset)).fetchall()]
            total = c.execute(f"SELECT COUNT(*) FROM {resource} WHERE deleted_at IS NULL").fetchone()[0]
        return {"ok": True, "resource": resource, "items": rows, "total": total, "limit": limit, "offset": offset}

    def summary(self):
        if self._use_backend():
            try:
                from sqlalchemy import text
                with self._backend.engine.connect() as conn:
                    def cnt(sql): return conn.execute(text(sql)).scalar() or 0
                    return {
                        "ok": True,
                        "clients": int(cnt("SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL")),
                        "products": int(cnt("SELECT COUNT(*) FROM products WHERE deleted_at IS NULL")),
                        "orders": int(cnt("SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL")),
                        "open_orders": int(cnt("SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND status NOT IN ('delivered','cancelled')")),
                        "revenue": float(cnt("SELECT COALESCE(SUM(total_price),0) FROM orders WHERE deleted_at IS NULL")),
                    }
            except Exception:
                pass  # cai no SQLite local como fallback
        with sqlite3.connect(self.db_file, timeout=10) as c:
            def one(sql): return c.execute(sql).fetchone()[0]
            return {"ok": True, "clients": one("SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL"), "products": one("SELECT COUNT(*) FROM products WHERE deleted_at IS NULL"), "orders": one("SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL"), "open_orders": one("SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND status NOT IN ('delivered','cancelled')"), "revenue": one("SELECT COALESCE(SUM(total_price),0) FROM orders WHERE deleted_at IS NULL")}
