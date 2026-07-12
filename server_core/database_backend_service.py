from __future__ import annotations
import os, tempfile, threading, sqlite3
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
            # Adquire o lock para não colidir com sync_resource/sync que também usam self.lock.
            # Após substituir o arquivo, descarta o pool para que as próximas operações
            # abram conexões frescas apontando para o novo arquivo (evita SQLITE_READONLY_DBMOVED).
            with self.lock:
                # O frontend ainda envia um snapshot do sql.js para módulos legados.
                # Consignações já são REST-first e não existem necessariamente nesse
                # snapshot. Preservamos as tabelas relacionais antes da substituição,
                # evitando que um salvamento posterior apague dados criados pela API.
                self._preserve_server_tables(tmp)
                safe_replace(tmp, self.local_db, retries=20, delay=0.1)
                if self._engine is not None:
                    self._engine.dispose(close=False)
        finally:
            tmp.unlink(missing_ok=True)
        return {"ok": True, "engine": self.load_config(False)["engine"], "saved_at_ms": int(self.local_db.stat().st_mtime * 1000), "mirror_only": self.load_config(False)["engine"] != "sqlite"}


    _SERVER_AUTHORITATIVE_TABLES = (
        "consignment_locations",
        "consignments",
        "consignment_items",
        "consignment_settlements",
    )

    def _preserve_server_tables(self, incoming_db: Path) -> None:
        """Copia tabelas REST-first do banco atual para o snapshot recebido.

        O navegador mantém um SQLite parcial para compatibilidade. Tabelas que já
        têm o backend como fonte oficial nunca podem ser removidas por esse arquivo.
        A rotina funciona inclusive quando o snapshot antigo não contém o schema.
        """
        if not self.local_db.exists() or self.local_db.resolve() == incoming_db.resolve():
            return

        source_uri = self.local_db.resolve().as_uri() + "?mode=ro"
        with sqlite3.connect(incoming_db) as target:
            target.execute("PRAGMA foreign_keys=OFF")
            target.execute("ATTACH DATABASE ? AS serverdb", (source_uri,))
            try:
                source_tables = {
                    row[0] for row in target.execute(
                        "SELECT name FROM serverdb.sqlite_master WHERE type='table'"
                    ).fetchall()
                }
                # O snapshot do navegador pode conter uma versão antiga dessas
                # tabelas. Copiar com ``SELECT *`` falha quando o schema do servidor
                # ganhou colunas novas (por exemplo, default_days em
                # consignment_locations). Como estas tabelas são autoritativas no
                # backend, substituímos completamente o schema recebido pela versão
                # atual do servidor antes de copiar os dados.
                tables_to_restore = [
                    table for table in self._SERVER_AUTHORITATIVE_TABLES
                    if table in source_tables
                ]

                # Remove primeiro as tabelas dependentes. As FKs estão desativadas,
                # mas a ordem reversa também deixa a intenção explícita.
                for table in reversed(tables_to_restore):
                    quoted = '"' + table.replace('"', '""') + '"'
                    target.execute(f"DROP TABLE IF EXISTS main.{quoted}")

                for table in tables_to_restore:
                    quoted = '"' + table.replace('"', '""') + '"'
                    create_sql = target.execute(
                        "SELECT sql FROM serverdb.sqlite_master "
                        "WHERE type='table' AND name=?",
                        (table,),
                    ).fetchone()
                    if not create_sql or not create_sql[0]:
                        continue
                    target.execute(create_sql[0])

                    # Copia por nomes de coluna explícitos. Além de documentar o
                    # contrato, isto evita novas regressões caso a ordem física das
                    # colunas seja alterada em uma migração futura.
                    columns = [
                        row[1] for row in target.execute(
                            f"PRAGMA serverdb.table_info({quoted})"
                        ).fetchall()
                    ]
                    if not columns:
                        continue
                    column_list = ", ".join(
                        '"' + col.replace('"', '""') + '"' for col in columns
                    )
                    target.execute(
                        f"INSERT INTO main.{quoted} ({column_list}) "
                        f"SELECT {column_list} FROM serverdb.{quoted}"
                    )

                # Recria índices próprios dessas tabelas quando ainda não existem.
                placeholders = ",".join("?" for _ in self._SERVER_AUTHORITATIVE_TABLES)
                indexes = target.execute(
                    f"SELECT name, sql FROM serverdb.sqlite_master "
                    f"WHERE type='index' AND tbl_name IN ({placeholders}) AND sql IS NOT NULL",
                    self._SERVER_AUTHORITATIVE_TABLES,
                ).fetchall()
                for _name, sql in indexes:
                    try:
                        target.execute(sql.replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ", 1).replace(
                            "CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ", 1
                        ))
                    except sqlite3.Error:
                        pass
                target.commit()
            finally:
                target.execute("DETACH DATABASE serverdb")
                target.execute("PRAGMA foreign_keys=ON")

    def load_snapshot(self):
        if not self.local_db.exists(): return None, 0, "none"
        return self.local_db.read_bytes(), int(self.local_db.stat().st_mtime * 1000), "sqlite-mirror"
