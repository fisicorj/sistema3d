from __future__ import annotations
import os, tempfile, threading, sqlite3, gc, time
from pathlib import Path
from platform_utils import safe_replace, IS_WINDOWS
from server_core.database_service import validate_sqlite
from server_core.relational_service import RelationalDatabaseService

class DatabaseBackendService(RelationalDatabaseService):
    """Camada relacional persistente usada como fonte única de dados."""

    def __init__(self, local_db: Path, config_file: Path, lock: threading.RLock):
        super().__init__(local_db, config_file, lock)
        self.cleanup_stale_temp_files()

    def cleanup_stale_temp_files(self) -> int:
        """Remove resíduos de gravações interrompidas sem tocar no banco ativo."""
        self.local_db.parent.mkdir(parents=True, exist_ok=True)
        removed = 0
        for candidate in self.local_db.parent.glob("s3d_*.tmp"):
            try:
                candidate.unlink(missing_ok=True)
                removed += 1
            except OSError:
                # Um arquivo ainda aberto será tentado novamente na próxima inicialização.
                continue
        return removed
    def save_snapshot(self, data: bytes):
        if not data.startswith(b"SQLite format 3"): raise ValueError("Arquivo SQLite inválido")
        self.local_db.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix="s3d_", suffix=".tmp", dir=str(self.local_db.parent)); os.close(fd)
        tmp = Path(name); tmp.write_bytes(data)
        try:
            ok, detail = validate_sqlite(tmp)
            if not ok: raise ValueError(detail)
            # Adquire o lock para não colidir com sync_resource/sync que também usam self.lock.
            # Após substituir o arquivo, descarta o pool para que as próximas operações
            # abram conexões frescas apontando para o novo arquivo (evita SQLITE_READONLY_DBMOVED).
            with self.lock:
                # No Windows, qualquer conexão ainda associada ao arquivo impede
                # os.replace. Libere o engine antes da troca, não depois dela.
                if self._engine is not None:
                    self._engine.dispose(close=True)
                gc.collect()
                time.sleep(0.03)

                # O espelho volátil da interface pode não conter tabelas exclusivas
                # do backend; elas são preservadas antes da substituição do arquivo.
                self._preserve_server_tables(tmp)
                if IS_WINDOWS:
                    # Windows frequentemente mantém handles transitórios no arquivo,
                    # impedindo os.replace mesmo após dispose(). Mantemos o arquivo
                    # físico no mesmo caminho e copiamos o banco validado pela API
                    # nativa de backup do SQLite. Assim não há rename/unlink do DB.
                    with sqlite3.connect(str(tmp), timeout=30) as source, \
                         sqlite3.connect(str(self.local_db), timeout=30) as target:
                        source.execute("PRAGMA busy_timeout=30000")
                        target.execute("PRAGMA busy_timeout=30000")
                        source.backup(target, pages=256, sleep=0.05)
                        target.commit()
                    ok_after, detail_after = validate_sqlite(self.local_db)
                    if not ok_after:
                        raise ValueError(f"Falha ao validar banco salvo: {detail_after}")
                else:
                    safe_replace(tmp, self.local_db, retries=30, delay=0.08)
                # Recria o engine imediatamente para as próximas chamadas REST.
                self._engine = self._new_engine(self.load_config(False))
        finally:
            # A limpeza não pode mascarar o resultado da gravação. No Windows,
            # handles antivírus podem permanecer ativos por alguns milissegundos.
            for attempt in range(10):
                try:
                    tmp.unlink(missing_ok=True)
                    break
                except OSError:
                    gc.collect()
                    time.sleep(0.05 * (attempt + 1))
        return {"ok": True, "engine": self.load_config(False)["engine"], "saved_at_ms": int(self.local_db.stat().st_mtime * 1000), "mirror_only": self.load_config(False)["engine"] != "sqlite"}


    _SERVER_AUTHORITATIVE_TABLES = (
        "consignment_locations",
        "consignments",
        "consignment_items",
        "consignment_settlements",
    )

    def _preserve_server_tables(self, incoming_db: Path) -> None:
        """Copia tabelas REST-first do banco atual para o snapshot recebido.

        A interface mantém um espelho SQLite apenas em memória. Tabelas que têm o
        backend como fonte oficial nunca podem ser removidas por esse snapshot.
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
