from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

from sqlalchemy import (Boolean, Float, Integer, String, Text, create_engine, select, delete, func, case, inspect,
    ForeignKey, CheckConstraint, UniqueConstraint, Index, event)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import NullPool

from server_core.config_store import load_json, save_json


DEFAULT_CONFIG = {
    "engine": "sqlite",
    "host": "localhost",
    "port": 5432,
    "database": "sistema3d",
    "username": "",
    "password": "",
    "sslmode": "prefer",
    "odbc_driver": "ODBC Driver 18 for SQL Server",
    "trust_server_certificate": True,
}


class Base(DeclarativeBase):
    pass


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (
        UniqueConstraint("email", name="uq_clients_email"),
        UniqueConstraint("document", name="uq_clients_document"),
        CheckConstraint("length(name) > 0", name="ck_clients_name"),
        CheckConstraint("length(phone) > 0", name="ck_clients_phone"),
        CheckConstraint("length(postal_code) > 0", name="ck_clients_postal_code"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255))
    address_number: Mapped[str | None] = mapped_column(String(30))
    address_complement: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(2))
    document: Mapped[str | None] = mapped_column(String(30))
    postal_code: Mapped[str] = mapped_column(String(12), nullable=False)
    total_spent: Mapped[float] = mapped_column(Float, default=0)
    last_order: Mapped[str | None] = mapped_column(String(40))
    deleted_at: Mapped[str | None] = mapped_column(String(40), index=True)


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (
        CheckConstraint("spool_weight >= 0", name="ck_materials_spool_weight"),
        CheckConstraint("cost >= 0", name="ck_materials_cost"),
        CheckConstraint("stock >= 0", name="ck_materials_stock"),
        CheckConstraint("min_alert >= 0", name="ck_materials_min_alert"),
        Index("ix_materials_name", "name"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    color: Mapped[str | None] = mapped_column(String(100))
    spool_weight: Mapped[float] = mapped_column(Float, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0)
    stock: Mapped[float] = mapped_column(Float, default=0)
    min_alert: Mapped[float] = mapped_column(Float, default=0)
    energy_factor: Mapped[float] = mapped_column(Float, default=1)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("sku", name="uq_products_sku"),
        CheckConstraint("weight_g >= 0", name="ck_products_weight"),
        CheckConstraint("print_time_h >= 0", name="ck_products_print_time"),
        CheckConstraint("cost_price >= 0", name="ck_products_cost"),
        CheckConstraint("sale_price >= 0", name="ck_products_sale"),
        CheckConstraint("stock_qty >= 0", name="ck_products_stock"),
        Index("ix_products_name", "name"),
        Index("ix_products_category_active", "category", "active"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str | None] = mapped_column(String(80), unique=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(120))
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id", ondelete="SET NULL"))
    material_name: Mapped[str | None] = mapped_column(String(160))
    printer_id: Mapped[int | None] = mapped_column(ForeignKey("printers.id", ondelete="SET NULL"))
    weight_g: Mapped[float] = mapped_column(Float, default=0)
    print_time_h: Mapped[float] = mapped_column(Float, default=0)
    print_time_label: Mapped[str | None] = mapped_column(String(80))
    difficulty: Mapped[float] = mapped_column(Float, default=1)
    cost_price: Mapped[float] = mapped_column(Float, default=0)
    cost_with_fail: Mapped[float] = mapped_column(Float, default=0)
    sale_price: Mapped[float] = mapped_column(Float, default=0)
    direct_price: Mapped[float] = mapped_column(Float, default=0)
    margin_pct: Mapped[float] = mapped_column(Float, default=0)
    stock_qty: Mapped[int] = mapped_column(Integer, default=0)
    min_stock: Mapped[int] = mapped_column(Integer, default=0)
    production_mode: Mapped[str] = mapped_column(String(30), default="demand")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str | None] = mapped_column(String(40))
    updated_at: Mapped[str | None] = mapped_column(String(40))
    deleted_at: Mapped[str | None] = mapped_column(String(40), index=True)


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_orders_quantity"),
        CheckConstraint("weight >= 0", name="ck_orders_weight"),
        CheckConstraint("print_time >= 0", name="ck_orders_print_time"),
        CheckConstraint("unit_price >= 0", name="ck_orders_unit_price"),
        CheckConstraint("total_price >= 0", name="ck_orders_total_price"),
        CheckConstraint("paid_amount >= 0", name="ck_orders_paid_amount"),
        CheckConstraint("paid_amount <= total_price", name="ck_orders_paid_not_over_total"),
        Index("ix_orders_client_date", "client_id", "date"),
        Index("ix_orders_status_date", "status", "date"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), index=True)
    work_type: Mapped[str | None] = mapped_column(String(80))
    printer_id: Mapped[int | None] = mapped_column(ForeignKey("printers.id", ondelete="SET NULL"))
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id", ondelete="SET NULL"), index=True)
    material_name: Mapped[str | None] = mapped_column(String(160))
    weight: Mapped[float] = mapped_column(Float, default=0)
    print_time: Mapped[float] = mapped_column(Float, default=0)
    difficulty: Mapped[float] = mapped_column(Float, default=1)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    total_price: Mapped[float] = mapped_column(Float, default=0)
    profit: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str | None] = mapped_column(String(60), index=True)
    shipping_cost: Mapped[float] = mapped_column(Float, default=0)
    date: Mapped[str | None] = mapped_column(String(40), index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), index=True)
    channel: Mapped[str | None] = mapped_column(String(80))
    deleted_at: Mapped[str | None] = mapped_column(String(40), index=True)
    printing_started_at: Mapped[str | None] = mapped_column(String(40))
    paid_amount: Mapped[float] = mapped_column(Float, default=0)


class Quote(Base):
    __tablename__ = "quotes"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_quotes_quantity"),
        CheckConstraint("unit_price >= 0", name="ck_quotes_unit_price"),
        CheckConstraint("total_price >= 0", name="ck_quotes_total_price"),
        CheckConstraint("shipping_cost >= 0", name="ck_quotes_shipping"),
        Index("ix_quotes_client_created", "client_id", "created_at"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), index=True)
    client_name: Mapped[str | None] = mapped_column(String(200))
    item_description: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    total_price: Mapped[float] = mapped_column(Float, default=0)
    shipping_cost: Mapped[float] = mapped_column(Float, default=0)
    total_with_shipping: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(60), default="aguardando", index=True)
    whatsapp_text: Mapped[str | None] = mapped_column(Text)
    validity_date: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[str | None] = mapped_column(String(40), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    deleted_at: Mapped[str | None] = mapped_column(String(40), index=True)


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_expenses_amount"),
        Index("ix_expenses_date_category", "date", "category"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(120), default="Geral", index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0)
    recurrence: Mapped[str] = mapped_column(String(30), default="once")
    date: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    recurrence_parent_id: Mapped[int | None] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    recurrence_key: Mapped[str | None] = mapped_column(String(100), unique=True)


class Printer(Base):
    __tablename__ = "printers"
    __table_args__ = (
        CheckConstraint("value >= 0", name="ck_printers_value"),
        CheckConstraint("lifetime_hours >= 0", name="ck_printers_lifetime"),
        CheckConstraint("hours_used >= 0", name="ck_printers_hours_used"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    value: Mapped[float] = mapped_column(Float, default=0)
    lifetime_hours: Mapped[float] = mapped_column(Float, default=0)
    wattage: Mapped[float] = mapped_column(Float, default=0)
    speed_gph: Mapped[float] = mapped_column(Float, default=0)
    hours_used: Mapped[float] = mapped_column(Float, default=0)
    bambu_ip: Mapped[str | None] = mapped_column(String(80))
    bambu_serial: Mapped[str | None] = mapped_column(String(120))
    bambu_access_code: Mapped[str | None] = mapped_column(String(120))

class MaintenanceItem(Base):
    __tablename__ = "maintenance_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    cost: Mapped[float] = mapped_column(Float, default=0)
    lifespan_hours: Mapped[float] = mapped_column(Float, default=100)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)

class FailedPrint(Base):
    __tablename__ = "failed_prints"
    __table_args__ = (CheckConstraint("material_lost >= 0", name="ck_failed_prints_material"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    fail_reason: Mapped[str | None] = mapped_column(Text)
    material_lost: Mapped[float] = mapped_column(Float, default=0)
    date: Mapped[str | None] = mapped_column(String(40), index=True)

class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    notification_key: Mapped[str] = mapped_column(String(220), unique=True, nullable=False)
    type: Mapped[str] = mapped_column(String(80), nullable=False)
    priority: Mapped[str] = mapped_column(String(30), default="medium")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    target_tab: Mapped[str | None] = mapped_column(String(100))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False)

class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    table_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    record_id: Mapped[str | None] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    old_data: Mapped[str | None] = mapped_column(Text)
    new_data: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, index=True)

class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(160))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)

class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)

class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)

class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_active_role", "active", "role_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id", ondelete="SET NULL"), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    last_login: Mapped[str | None] = mapped_column(String(40))


class ConsignmentLocation(Base):
    __tablename__ = "consignment_locations"
    __table_args__ = (CheckConstraint("commission_pct >= 0 AND commission_pct <= 100", name="ck_consignment_locations_commission"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact: Mapped[str | None] = mapped_column(String(160))
    phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(String(300))
    commission_pct: Mapped[float] = mapped_column(Float, default=0)
    default_days: Mapped[int] = mapped_column(Integer, default=30)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)

class Consignment(Base):
    __tablename__ = "consignments"
    __table_args__ = (
        CheckConstraint("commission_pct >= 0 AND commission_pct <= 100", name="ck_consignments_commission"),
        Index("ix_consignments_status_due", "status", "due_date"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("consignment_locations.id", ondelete="RESTRICT"), nullable=False, index=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    start_date: Mapped[str] = mapped_column(String(40), nullable=False)
    due_date: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    commission_pct: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)
    closed_at: Mapped[str | None] = mapped_column(String(40))

class ConsignmentItem(Base):
    __tablename__ = "consignment_items"
    __table_args__ = (
        CheckConstraint("quantity_sent > 0", name="ck_consignment_items_sent"),
        CheckConstraint("quantity_sold >= 0", name="ck_consignment_items_sold"),
        CheckConstraint("quantity_returned >= 0", name="ck_consignment_items_returned"),
        CheckConstraint("unit_price >= 0", name="ck_consignment_items_price"),
        Index("ix_consignment_items_consignment", "consignment_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    consignment_id: Mapped[int] = mapped_column(ForeignKey("consignments.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), index=True)
    description: Mapped[str] = mapped_column(String(240), nullable=False)
    quantity_sent: Mapped[int] = mapped_column(Integer, default=1)
    quantity_sold: Mapped[int] = mapped_column(Integer, default=0)
    quantity_returned: Mapped[int] = mapped_column(Integer, default=0)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)

class ConsignmentSettlement(Base):
    __tablename__ = "consignment_settlements"
    __table_args__ = (CheckConstraint("gross_amount >= 0", name="ck_consignment_settlements_gross"), Index("ix_consignment_settlements_date", "settlement_date"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    consignment_id: Mapped[int] = mapped_column(ForeignKey("consignments.id", ondelete="CASCADE"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("consignment_items.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity_sold: Mapped[int] = mapped_column(Integer, nullable=False)
    gross_amount: Mapped[float] = mapped_column(Float, default=0)
    location_amount: Mapped[float] = mapped_column(Float, default=0)
    owner_amount: Mapped[float] = mapped_column(Float, default=0)
    settlement_date: Mapped[str] = mapped_column(String(40), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)


MODEL_MAP = {
    "clients": Client, "materials": Material, "products": Product,
    "orders": Order, "quotes": Quote, "expenses": Expense,
    "printers": Printer, "maintenance_items": MaintenanceItem,
    "failed_prints": FailedPrint, "notifications": Notification,
    "audit_log": AuditLog, "attachments": Attachment,
    "settings": Setting, "roles": Role, "users": User,
    "consignment_locations": ConsignmentLocation, "consignments": Consignment,
    "consignment_items": ConsignmentItem, "consignment_settlements": ConsignmentSettlement,
}


class RelationalDatabaseService:
    def __init__(self, local_db: Path, config_file: Path, lock: threading.RLock):
        self.local_db = Path(local_db)
        self.config_file = Path(config_file)
        self.lock = lock
        self._engine = None
        self.last_error = ""
        self.last_sync_at: str | None = None

    def load_config(self, redact: bool = False) -> dict[str, Any]:
        cfg = DEFAULT_CONFIG.copy(); cfg.update(load_json(self.config_file, {}))
        cfg["engine"] = str(cfg.get("engine") or "sqlite").lower()
        if redact:
            cfg["password_configured"] = bool(cfg.get("password")); cfg["password"] = ""
        return cfg

    def _url(self, cfg: dict[str, Any]) -> str:
        engine = cfg["engine"]
        if engine == "sqlite":
            return f"sqlite:///{self.local_db.as_posix()}"
        user = quote_plus(str(cfg.get("username") or "")); pwd = quote_plus(str(cfg.get("password") or ""))
        host = cfg.get("host") or "localhost"; port = int(cfg.get("port") or (5432 if engine == "postgresql" else 1433))
        database = quote_plus(str(cfg.get("database") or "sistema3d"))
        if engine == "postgresql":
            sslmode = quote_plus(str(cfg.get("sslmode") or "prefer"))
            return f"postgresql+psycopg://{user}:{pwd}@{host}:{port}/{database}?sslmode={sslmode}"
        if engine == "sqlserver":
            driver = quote_plus(str(cfg.get("odbc_driver") or "ODBC Driver 18 for SQL Server"))
            trust = "yes" if cfg.get("trust_server_certificate", True) else "no"
            return f"mssql+pyodbc://{user}:{pwd}@{host}:{port}/{database}?driver={driver}&Encrypt=yes&TrustServerCertificate={trust}"
        raise ValueError("Banco não suportado")

    def _new_engine(self, cfg: dict[str, Any]):
        options = {"future": True}
        if cfg["engine"] == "sqlite":
            # NullPool: cada operação abre e fecha a conexão imediatamente.
            # Isso evita SQLITE_READONLY_DBMOVED quando save_snapshot() substitui
            # o arquivo enquanto conexões do pool ainda apontam para o inode antigo.
            options["poolclass"] = NullPool
            options["connect_args"] = {"check_same_thread": False, "timeout": 20}
        else:
            options["pool_pre_ping"] = True
        engine = create_engine(self._url(cfg), **options)
        if cfg["engine"] == "sqlite":
            @event.listens_for(engine, "connect")
            def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
        return engine

    def initialize(self) -> None:
        cfg = self.load_config(False)
        self._engine = self._new_engine(cfg)
        self.ensure_schema_current()

    def ensure_schema_current(self) -> None:
        """Garante que todas as tabelas e colunas conhecidas existam no banco ativo.

        Pode ser chamado mais de uma vez com segurança. É usado também como mecanismo
        de autorreparo quando uma instalação existente recebe um módulo novo.
        """
        engine = self._engine
        if engine is None:
            cfg = self.load_config(False)
            engine = self._new_engine(cfg)
            self._engine = engine
        Base.metadata.create_all(engine)
        self._ensure_schema_columns(engine)
        self._ensure_integrity_indexes(engine)

    def _ensure_schema_columns(self, engine) -> None:
        """Adiciona colunas novas em instalações já existentes sem apagar dados.

        create_all cria tabelas ausentes, mas não altera tabelas antigas. Esta rotina
        cobre a evolução incremental necessária nos três dialetos suportados.
        """
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        preparer = engine.dialect.identifier_preparer
        with engine.begin() as conn:
            for table_name, model in MODEL_MAP.items():
                if table_name not in existing_tables:
                    continue
                existing = {col["name"] for col in inspector.get_columns(table_name)}
                for column in model.__table__.columns:
                    if column.name in existing or column.primary_key:
                        continue
                    sql_type = column.type.compile(dialect=engine.dialect)
                    table_sql = preparer.quote(table_name)
                    column_sql = preparer.quote(column.name)
                    keyword = "ADD COLUMN" if engine.dialect.name in {"sqlite", "postgresql"} else "ADD"
                    conn.exec_driver_sql(f"ALTER TABLE {table_sql} {keyword} {column_sql} {sql_type}")

    def _ensure_integrity_indexes(self, engine) -> None:
        """Cria índices portáveis que também podem ser aplicados em bases existentes."""
        for table in Base.metadata.tables.values():
            for index in table.indexes:
                try:
                    index.create(bind=engine, checkfirst=True)
                except Exception:
                    # Índices existentes com nomes legados não devem impedir a inicialização.
                    continue

    def _normalize_optional_unique(self, value: Any) -> Any:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _require_reference(self, session: Session, model, value: Any, label: str) -> None:
        if value in (None, ""):
            return
        if session.get(model, int(value)) is None:
            raise ValueError(f"{label} informado não existe")

    def _validate_business_rules(self, session: Session, model, clean: dict[str, Any], current=None) -> None:
        merged = {}
        if current is not None:
            merged.update(self._to_dict(current))
        merged.update(clean)
        def nonnegative(*fields):
            for field in fields:
                if field in merged and merged[field] not in (None, "") and float(merged[field]) < 0:
                    raise ValueError(f"{field} não pode ser negativo")
        if model is Client:
            for field, label in (("name","Nome"),("phone","Telefone"),("postal_code","CEP")):
                if not str(merged.get(field) or "").strip():
                    raise ValueError(f"{label} é obrigatório")
            for field in ("email", "document"):
                clean[field] = self._normalize_optional_unique(merged.get(field))
                value = clean[field]
                if value:
                    stmt = select(Client).where(getattr(Client, field) == value)
                    if current is not None: stmt = stmt.where(Client.id != current.id)
                    if session.execute(stmt).scalar_one_or_none():
                        raise ValueError(f"Já existe cliente com este {field}")
        elif model is Product:
            nonnegative("weight_g","print_time_h","cost_price","cost_with_fail","sale_price","direct_price","stock_qty","min_stock")
            self._require_reference(session, Material, merged.get("material_id"), "Material")
            self._require_reference(session, Printer, merged.get("printer_id"), "Impressora")
        elif model is Material:
            nonnegative("spool_weight","cost","stock","min_alert","energy_factor")
        elif model is Order:
            if int(merged.get("quantity") or 0) <= 0: raise ValueError("Quantidade deve ser maior que zero")
            nonnegative("weight","print_time","unit_price","total_price","profit","shipping_cost","paid_amount")
            if float(merged.get("paid_amount") or 0) > float(merged.get("total_price") or 0):
                raise ValueError("Valor pago não pode superar o total do pedido")
            self._require_reference(session, Client, merged.get("client_id"), "Cliente")
            self._require_reference(session, Product, merged.get("product_id"), "Produto")
            self._require_reference(session, Material, merged.get("material_id"), "Material")
            self._require_reference(session, Printer, merged.get("printer_id"), "Impressora")
        elif model is Quote:
            if int(merged.get("quantity") or 0) <= 0: raise ValueError("Quantidade deve ser maior que zero")
            nonnegative("unit_price","total_price","shipping_cost","total_with_shipping")
            self._require_reference(session, Client, merged.get("client_id"), "Cliente")
            self._require_reference(session, Order, merged.get("order_id"), "Pedido")
        elif model is Expense:
            nonnegative("amount")
            self._require_reference(session, Expense, merged.get("recurrence_parent_id"), "Despesa recorrente")
        elif model is Printer:
            nonnegative("value","lifetime_hours","wattage","speed_gph","hours_used")
        elif model is FailedPrint:
            nonnegative("material_lost")
            self._require_reference(session, Order, merged.get("order_id"), "Pedido")
        elif model is User:
            self._require_reference(session, Role, merged.get("role_id"), "Perfil")
        elif model is ConsignmentLocation:
            nonnegative("commission_pct")
            if float(merged.get("commission_pct") or 0) > 100: raise ValueError("Comissão deve estar entre 0 e 100%")
            if not str(merged.get("name") or "").strip(): raise ValueError("Nome do local é obrigatório")
            if merged.get("client_id") in (None, ""):
                raise ValueError("O local de consignação deve estar vinculado a um cliente")
            self._require_reference(session, Client, merged.get("client_id"), "Cliente")
        elif model is Consignment:
            nonnegative("commission_pct")
            if float(merged.get("commission_pct") or 0) > 100: raise ValueError("Comissão deve estar entre 0 e 100%")
            if merged.get("client_id") in (None, ""):
                raise ValueError("A consignação deve estar vinculada ao cliente do local")
            self._require_reference(session, ConsignmentLocation, merged.get("location_id"), "Local")
            self._require_reference(session, Client, merged.get("client_id"), "Cliente")
            self._require_reference(session, Order, merged.get("order_id"), "Pedido")
        elif model is ConsignmentItem:
            if int(merged.get("quantity_sent") or 0) <= 0: raise ValueError("Quantidade consignada deve ser maior que zero")
            nonnegative("quantity_sold", "quantity_returned", "unit_price")
            if merged.get("product_id") in (None, ""):
                raise ValueError("Selecione um produto cadastrado para consignar")
            if int(merged.get("quantity_sold") or 0) + int(merged.get("quantity_returned") or 0) > int(merged.get("quantity_sent") or 0):
                raise ValueError("Vendas e devoluções não podem superar a quantidade consignada")
            self._require_reference(session, Consignment, merged.get("consignment_id"), "Consignação")
            self._require_reference(session, Product, merged.get("product_id"), "Produto")

    def get_bambu_configs(self, include_secret: bool = False) -> dict[str, dict[str, Any]]:
        """Retorna configurações Bambu e autorrepara duplicidades por serial/IP."""
        with self.lock, Session(self.engine) as session:
            rows = session.execute(select(Printer).order_by(Printer.id)).scalars().all()
            result: dict[str, dict[str, Any]] = {}
            seen: set[str] = set()
            changed = False
            for printer in rows:
                if not (printer.bambu_ip or printer.bambu_serial or printer.bambu_access_code):
                    continue
                serial_key = str(printer.bambu_serial or "").strip().upper()
                ip_key = str(printer.bambu_ip or "").strip().lower()
                identity = f"serial:{serial_key}" if serial_key else (f"ip:{ip_key}" if ip_key else "")
                if identity and identity in seen:
                    print(f"[Bambu] Configuração duplicada removida do banco: impressora {printer.id} ({identity})")
                    printer.bambu_ip = None
                    printer.bambu_serial = None
                    printer.bambu_access_code = None
                    changed = True
                    continue
                if identity:
                    seen.add(identity)
                configured = bool(printer.bambu_ip and printer.bambu_serial and printer.bambu_access_code)
                item = {
                    "printer_id": printer.id,
                    "name": printer.name,
                    "ip": printer.bambu_ip or "",
                    "serial": printer.bambu_serial or "",
                    "has_code": bool(printer.bambu_access_code),
                    "configured": configured,
                }
                if include_secret:
                    item["access_code"] = printer.bambu_access_code or ""
                result[str(printer.id)] = item
            if changed:
                session.commit()
            return result

    def save_bambu_config(self, printer_id: int, ip: str, serial: str, access_code: str | None = None) -> dict[str, Any]:
        """Persiste a configuração e garante unicidade por serial (IP como fallback)."""
        clean_ip = str(ip or "").strip()
        clean_serial = str(serial or "").strip()
        with self.lock, Session(self.engine) as session:
            printer = session.get(Printer, int(printer_id))
            if printer is None:
                raise LookupError("Impressora não encontrada")

            # Remove a mesma configuração de qualquer outro cadastro.
            candidates = session.execute(select(Printer).where(Printer.id != int(printer_id))).scalars().all()
            for other in candidates:
                same_serial = bool(clean_serial and str(other.bambu_serial or "").strip().upper() == clean_serial.upper())
                same_ip_without_serial = bool(not clean_serial and clean_ip and not other.bambu_serial and str(other.bambu_ip or "").strip().lower() == clean_ip.lower())
                if same_serial or same_ip_without_serial:
                    other.bambu_ip = None
                    other.bambu_serial = None
                    other.bambu_access_code = None
                    print(f"[Bambu] Configuração movida da impressora {other.id} para {printer_id}")

            printer.bambu_ip = clean_ip or None
            printer.bambu_serial = clean_serial or None
            if access_code is not None and str(access_code).strip():
                printer.bambu_access_code = str(access_code).strip()
            if not printer.bambu_access_code:
                raise ValueError("Access code é obrigatório na primeira configuração")
            session.commit()
            return {
                "ok": True,
                "printer_id": printer.id,
                "ip": printer.bambu_ip or "",
                "serial": printer.bambu_serial or "",
                "has_code": bool(printer.bambu_access_code),
                "configured": bool(printer.bambu_ip and printer.bambu_serial and printer.bambu_access_code),
            }

    def integrity_status(self) -> dict[str, Any]:
        inspector = inspect(self.engine)
        tables = set(inspector.get_table_names())
        expected = set(MODEL_MAP)
        indexes = {table: sorted(i.get("name") for i in inspector.get_indexes(table) if i.get("name")) for table in expected if table in tables}
        with Session(self.engine) as session:
            orphan_checks = {
                "orders_client": session.execute(select(func.count(Order.id)).where(Order.client_id.is_not(None), ~Order.client_id.in_(select(Client.id)))).scalar_one(),
                "orders_product": session.execute(select(func.count(Order.id)).where(Order.product_id.is_not(None), ~Order.product_id.in_(select(Product.id)))).scalar_one(),
                "quotes_client": session.execute(select(func.count(Quote.id)).where(Quote.client_id.is_not(None), ~Quote.client_id.in_(select(Client.id)))).scalar_one(),
            }
        return {"ok": not any(orphan_checks.values()) and expected.issubset(tables), "engine": self.load_config(False)["engine"], "missing_tables": sorted(expected-tables), "orphan_records": orphan_checks, "indexes": indexes}

    def create_order_transaction(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Cria pedido e baixa estoque em uma única transação."""
        order_data = dict(payload.get("order") or payload)
        consume_stock = bool(payload.get("consume_stock", True))
        clean = self._clean_payload(Order, order_data, partial=False)
        clean.pop("id", None)
        with self.lock, Session(self.engine) as session:
            self._validate_business_rules(session, Order, clean)
            order = Order(**clean)
            session.add(order)
            if consume_stock:
                qty = int(clean.get("quantity") or 1)
                if clean.get("product_id"):
                    product = session.get(Product, int(clean["product_id"]))
                    if product and product.production_mode != "demand":
                        if int(product.stock_qty or 0) < qty: raise ValueError("Estoque do produto insuficiente")
                        product.stock_qty = int(product.stock_qty or 0) - qty
                if clean.get("material_id"):
                    material = session.get(Material, int(clean["material_id"]))
                    grams = float(clean.get("weight") or 0) * qty
                    if material and grams > 0:
                        if float(material.stock or 0) < grams: raise ValueError("Estoque de material insuficiente")
                        material.stock = float(material.stock or 0) - grams
            session.commit(); session.refresh(order)
            return {"ok": True, "order": self._to_dict(order)}

    def record_payment_transaction(self, order_id: Any, amount: float) -> dict[str, Any]:
        amount = float(amount or 0)
        if amount <= 0: raise ValueError("O pagamento deve ser maior que zero")
        with self.lock, Session(self.engine) as session:
            order = session.get(Order, int(order_id))
            if order is None: raise LookupError("Pedido não encontrado")
            new_paid = float(order.paid_amount or 0) + amount
            if new_paid > float(order.total_price or 0): raise ValueError("Pagamento ultrapassa o saldo do pedido")
            order.paid_amount = new_paid
            if new_paid >= float(order.total_price or 0) and order.status in (None, "pending", "approved"):
                order.status = "paid"
            session.commit(); session.refresh(order)
            return {"ok": True, "order": self._to_dict(order), "balance": max(float(order.total_price or 0)-new_paid, 0)}

    @property
    def engine(self):
        if self._engine is None: self.initialize()
        return self._engine

    def test_connection(self, candidate: dict[str, Any] | None = None) -> dict[str, Any]:
        cfg = self.load_config(False)
        if candidate:
            for key, value in candidate.items():
                if key == "password" and value == "": continue
                cfg[key] = value
        cfg["engine"] = str(cfg.get("engine") or "sqlite").lower()
        eng = self._new_engine(cfg)
        try:
            with eng.connect() as conn: conn.exec_driver_sql("SELECT 1")
            return {"ok": True, "engine": cfg["engine"], "message": "Conexão relacional realizada com sucesso"}
        finally:
            eng.dispose()

    def migrate_and_activate(self, incoming: dict[str, Any]) -> dict[str, Any]:
        current = self.load_config(False); cfg = current.copy()
        for key in DEFAULT_CONFIG:
            if key in incoming:
                if key == "password" and incoming[key] == "": continue
                cfg[key] = incoming[key]
        cfg["engine"] = str(cfg.get("engine") or "sqlite").lower()
        if cfg["engine"] not in {"sqlite", "postgresql", "sqlserver"}: raise ValueError("Banco não suportado")
        target = self._new_engine(cfg)
        try:
            with target.connect() as conn: conn.exec_driver_sql("SELECT 1")
            Base.metadata.create_all(target)
            self._ensure_schema_columns(target)
            self._ensure_integrity_indexes(target)
            self._copy_from_sqlite(target)
        except Exception:
            target.dispose(); raise
        save_json(self.config_file, cfg)
        old = self._engine; self._engine = target
        if old is not None: old.dispose()
        self.last_sync_at = datetime.now(timezone.utc).isoformat(); self.last_error = ""
        return self.load_config(True)

    def _sqlite_rows(self, table: str) -> list[dict[str, Any]]:
        if table not in MODEL_MAP:
            raise ValueError(f"Tabela não permitida: {table!r}")
        if not self.local_db.exists(): return []
        with sqlite3.connect(self.local_db) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(r) for r in conn.execute(f"SELECT * FROM {table}").fetchall()]

    def _copy_from_sqlite(self, target_engine) -> None:
        with Session(target_engine) as session:
            for table, model in MODEL_MAP.items():
                rows = self._sqlite_rows(table)
                for row in rows:
                    payload = {c.name: row.get(c.name) for c in model.__table__.columns if c.name in row}
                    if model is Client:
                        payload["name"] = payload.get("name") or "Sem nome"
                        payload["phone"] = payload.get("phone") or ""
                        payload["postal_code"] = payload.get("postal_code") or ""
                    if model is Product: payload["active"] = bool(payload.get("active", 1))
                    if model is Order:
                        payload["quantity"] = int(payload.get("quantity") or 1)
                        payload["paid_amount"] = float(payload.get("paid_amount") or 0)
                    if model is Quote:
                        payload["quantity"] = int(payload.get("quantity") or 1)
                        payload["status"] = payload.get("status") or "aguardando"
                    if model is Expense:
                        payload["category"] = payload.get("category") or "Geral"
                        payload["description"] = payload.get("description") or "Sem descrição"
                        payload["date"] = payload.get("date") or datetime.now().date().isoformat()
                    if model in (Product, MaintenanceItem, Notification, User):
                        for flag in ("active", "is_read"):
                            if flag in payload: payload[flag] = bool(payload.get(flag))
                    session.merge(model(**payload))
            session.commit()

    def bootstrap(self) -> dict[str, Any]:
        with Session(self.engine) as session:
            data = {}
            for table, model in MODEL_MAP.items():
                rows = session.execute(select(model)).scalars().all()
                data[table] = [self._to_dict(row) for row in rows]
            return {"ok": True, "engine": self.load_config(False)["engine"], "data": data}

    def sync(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Sincroniza snapshots completos do espelho local com tabelas relacionais.

        Cada lista enviada representa o estado integral da tabela. Registros ausentes
        são removidos apenas para tabelas incluídas no payload, evitando resíduos em
        despesas (exclusão física) e mantendo soft delete onde o frontend o utiliza.
        """
        counts: dict[str, int] = {}
        with self.lock, Session(self.engine) as session:
            for table, model in MODEL_MAP.items():
                rows = payload.get(table)
                if not isinstance(rows, list):
                    continue
                pk_col = next(iter(model.__table__.primary_key.columns))
                pk_name = pk_col.name
                seen: set[Any] = set()
                for row in rows:
                    clean = {c.name: row.get(c.name) for c in model.__table__.columns if c.name in row}
                    if clean.get(pk_name) is not None:
                        if isinstance(pk_col.type, Integer): clean[pk_name] = int(clean[pk_name])
                        seen.add(clean[pk_name])
                    if model is Client:
                        clean["name"] = clean.get("name") or "Sem nome"
                        clean["phone"] = clean.get("phone") or ""
                        clean["postal_code"] = clean.get("postal_code") or ""
                    elif model is Product:
                        clean["active"] = bool(clean.get("active", 1))
                    elif model is Order:
                        clean["quantity"] = int(clean.get("quantity") or 1)
                        clean["paid_amount"] = float(clean.get("paid_amount") or 0)
                    elif model is Quote:
                        clean["quantity"] = int(clean.get("quantity") or 1)
                        clean["status"] = clean.get("status") or "aguardando"
                    elif model is Expense:
                        clean["category"] = clean.get("category") or "Geral"
                        clean["description"] = clean.get("description") or "Sem descrição"
                        clean["date"] = clean.get("date") or datetime.now().date().isoformat()
                    if model in (Product, MaintenanceItem, Notification, User):
                        for flag in ("active", "is_read"):
                            if flag in clean: clean[flag] = bool(clean.get(flag))
                    session.merge(model(**clean))
                # Snapshot completo: elimina do destino o que não existe mais na origem.
                stmt = delete(model)
                if seen:
                    stmt = stmt.where(getattr(model, pk_name).not_in(seen))
                session.execute(stmt)
                counts[table] = len(rows)
            session.commit()
        self.last_sync_at = datetime.now(timezone.utc).isoformat(); self.last_error = ""
        return {"ok": True, "engine": self.load_config(False)["engine"], "counts": counts, "synced_at": self.last_sync_at}

    def list_items(self, resource: str, limit=100, offset=0) -> dict[str, Any]:
        model = MODEL_MAP.get(resource)
        if not model: raise ValueError("Recurso inválido")
        limit = max(1, min(500, int(limit))); offset = max(0, int(offset))

        def _run_query():
            with Session(self.engine) as session:
                query = select(model)
                if hasattr(model, "deleted_at"):
                    query = query.where(model.deleted_at.is_(None))
                total = session.execute(select(func.count()).select_from(query.subquery())).scalar_one()
                pk_col = next(iter(model.__table__.primary_key.columns))
                items = session.execute(query.order_by(getattr(model, pk_col.name).desc()).offset(offset).limit(limit)).scalars().all()
                return {"ok": True, "resource": resource, "items": [self._to_dict(x) for x in items], "total": int(total or 0), "limit": limit, "offset": offset}

        try:
            return _run_query()
        except OperationalError as exc:
            message = str(exc).lower()
            if "no such table" not in message and "does not exist" not in message and "invalid object name" not in message:
                raise
            self.ensure_schema_current()
            return _run_query()


    def _model_for(self, resource: str):
        model = MODEL_MAP.get(str(resource or ""))
        if not model:
            raise ValueError("Recurso relacional inválido")
        return model

    def get_item(self, resource: str, record_id: Any) -> dict[str, Any]:
        model = self._model_for(resource)
        pk_col = next(iter(model.__table__.primary_key.columns))
        value = int(record_id) if isinstance(pk_col.type, Integer) else str(record_id)
        with Session(self.engine) as session:
            obj = session.get(model, value)
            if obj is None:
                raise LookupError("Registro não encontrado")
            return {"ok": True, "resource": resource, "item": self._to_dict(obj)}

    def _clean_payload(self, model, payload: dict[str, Any], partial: bool = False) -> dict[str, Any]:
        clean = {c.name: payload.get(c.name) for c in model.__table__.columns if c.name in payload}
        if model is Client:
            if not partial or "name" in clean: clean["name"] = clean.get("name") or "Sem nome"
            if not partial or "phone" in clean: clean["phone"] = clean.get("phone") or ""
            if not partial or "postal_code" in clean: clean["postal_code"] = clean.get("postal_code") or ""
        elif model is Product and "active" in clean:
            clean["active"] = bool(clean.get("active"))
        elif model is Order:
            if "quantity" in clean: clean["quantity"] = int(clean.get("quantity") or 1)
            if "paid_amount" in clean: clean["paid_amount"] = float(clean.get("paid_amount") or 0)
        elif model is Quote:
            if "quantity" in clean: clean["quantity"] = int(clean.get("quantity") or 1)
            if not partial or "status" in clean: clean["status"] = clean.get("status") or "aguardando"
        elif model is Expense:
            if not partial or "category" in clean: clean["category"] = clean.get("category") or "Geral"
            if not partial or "description" in clean: clean["description"] = clean.get("description") or "Sem descrição"
            if not partial or "date" in clean: clean["date"] = clean.get("date") or datetime.now().date().isoformat()
        if model in (MaintenanceItem, Notification, User, ConsignmentLocation):
            for flag in ("active", "is_read"):
                if flag in clean: clean[flag] = bool(clean.get(flag))
        return clean

    def create_item(self, resource: str, payload: dict[str, Any]) -> dict[str, Any]:
        model = self._model_for(resource)
        clean = self._clean_payload(model, payload, partial=False)
        pk_col = next(iter(model.__table__.primary_key.columns))
        if clean.get(pk_col.name) in (None, ""):
            clean.pop(pk_col.name, None)
        with self.lock, Session(self.engine) as session:
            self._validate_business_rules(session, model, clean)
            obj = model(**clean)
            session.add(obj); session.commit(); session.refresh(obj)
            return {"ok": True, "resource": resource, "item": self._to_dict(obj)}

    def update_item(self, resource: str, record_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
        model = self._model_for(resource)
        pk_col = next(iter(model.__table__.primary_key.columns))
        value = int(record_id) if isinstance(pk_col.type, Integer) else str(record_id)
        clean = self._clean_payload(model, payload, partial=True)
        clean.pop(pk_col.name, None)
        with self.lock, Session(self.engine) as session:
            obj = session.get(model, value)
            if obj is None:
                # upsert preservando IDs durante a transição
                data = dict(clean); data[pk_col.name] = value
                self._validate_business_rules(session, model, data)
                obj = model(**data); session.add(obj)
            else:
                self._validate_business_rules(session, model, clean, obj)
                for key, val in clean.items(): setattr(obj, key, val)
            session.commit(); session.refresh(obj)
            return {"ok": True, "resource": resource, "item": self._to_dict(obj)}

    def delete_item(self, resource: str, record_id: Any, hard: bool = False) -> dict[str, Any]:
        model = self._model_for(resource)
        pk_col = next(iter(model.__table__.primary_key.columns))
        value = int(record_id) if isinstance(pk_col.type, Integer) else str(record_id)
        with self.lock, Session(self.engine) as session:
            obj = session.get(model, value)
            if obj is None: return {"ok": True, "resource": resource, "deleted": False}
            if hasattr(obj, "deleted_at") and not hard:
                obj.deleted_at = datetime.now(timezone.utc).isoformat()
                if hasattr(obj, "active"): obj.active = False
            else:
                session.delete(obj)
            session.commit()
            return {"ok": True, "resource": resource, "deleted": True}

    def sync_resource(self, resource: str, items: list[dict[str, Any]], delete_missing: bool = True) -> dict[str, Any]:
        """Sincroniza apenas um recurso por CRUD relacional, substituindo o snapshot global."""
        model = self._model_for(resource)
        pk_col = next(iter(model.__table__.primary_key.columns)); pk_name = pk_col.name
        seen = set()
        with self.lock, Session(self.engine) as session:
            for payload in items:
                clean = self._clean_payload(model, payload, partial=False)
                value = clean.get(pk_name)
                if value not in (None, ""):
                    if isinstance(pk_col.type, Integer): value = int(value); clean[pk_name] = value
                    seen.add(value)
                if model is Printer:
                    existing = session.get(Printer, value) if value not in (None, "") else None
                    if not clean.get("bambu_access_code"):
                        clean.pop("bambu_access_code", None)
                    if existing is not None:
                        for key, val in clean.items():
                            if key != pk_name:
                                setattr(existing, key, val)
                    else:
                        session.add(Printer(**clean))
                else:
                    session.merge(model(**clean))
            if delete_missing:
                stmt = delete(model)
                if seen: stmt = stmt.where(getattr(model, pk_name).not_in(seen))
                session.execute(stmt)
            session.commit()
        self.last_sync_at = datetime.now(timezone.utc).isoformat()
        return {"ok": True, "resource": resource, "count": len(items), "synced_at": self.last_sync_at}

    def finance_summary(self, month: str) -> dict[str, Any]:
        month = str(month or datetime.now().strftime("%Y-%m"))[:7]
        month_like = f"{month}%"
        active_status = ("quote", "cancelled")
        with Session(self.engine) as session:
            order_filter = (Order.deleted_at.is_(None), Order.date.like(month_like), Order.status.not_in(active_status))
            revenue, profit, order_count = session.execute(
                select(
                    func.coalesce(func.sum(Order.total_price), 0),
                    func.coalesce(func.sum(Order.profit), 0),
                    func.count(Order.id),
                ).where(*order_filter)
            ).one()
            expenses = session.execute(
                select(func.coalesce(func.sum(Expense.amount), 0)).where(Expense.date.like(month_like))
            ).scalar_one()
            balance_expr = case(
                (Order.total_price - func.coalesce(Order.paid_amount, 0) > 0,
                 Order.total_price - func.coalesce(Order.paid_amount, 0)),
                else_=0,
            )
            receivable = session.execute(
                select(func.coalesce(func.sum(balance_expr), 0)).where(
                    Order.deleted_at.is_(None),
                    Order.status.not_in(("quote", "cancelled", "delivered")),
                )
            ).scalar_one()
            pending_rows = session.execute(
                select(Order, Client.name).outerjoin(Client, Client.id == Order.client_id).where(
                    Order.deleted_at.is_(None),
                    Order.status.not_in(("quote", "cancelled", "delivered")),
                    func.coalesce(Order.paid_amount, 0) < Order.total_price,
                ).order_by(balance_expr.desc()).limit(10)
            ).all()
            pending = [{
                "id": order.id, "client_name": client_name or "Sem cliente",
                "total_price": float(order.total_price or 0),
                "paid_amount": float(order.paid_amount or 0),
                "status": order.status,
                "balance": max(float(order.total_price or 0) - float(order.paid_amount or 0), 0),
            } for order, client_name in pending_rows]
            cons_filters = []
            if month:
                cons_filters.append(func.substr(ConsignmentSettlement.settlement_date, 1, 7) == month)
            cons_query = select(
                func.coalesce(func.sum(ConsignmentSettlement.gross_amount), 0),
                func.coalesce(func.sum(ConsignmentSettlement.location_amount), 0),
                func.coalesce(func.sum(ConsignmentSettlement.owner_amount), 0),
                func.coalesce(func.sum(ConsignmentSettlement.quantity_sold * func.coalesce(Product.cost_price, 0)), 0),
                func.coalesce(func.sum(ConsignmentSettlement.quantity_sold), 0),
            ).select_from(ConsignmentSettlement).join(
                ConsignmentItem, ConsignmentItem.id == ConsignmentSettlement.item_id
            ).outerjoin(Product, Product.id == ConsignmentItem.product_id)
            if cons_filters:
                cons_query = cons_query.where(*cons_filters)
            cons_gross, cons_commission, cons_owner, cons_cost, cons_qty = session.execute(cons_query).one()
        order_revenue = float(revenue or 0); order_profit = float(profit or 0); expenses = float(expenses or 0)
        cons_gross = float(cons_gross or 0); cons_commission = float(cons_commission or 0)
        cons_owner = float(cons_owner or 0); cons_cost = float(cons_cost or 0)
        cons_profit = cons_owner - cons_cost
        revenue = order_revenue + cons_owner
        profit = order_profit + cons_profit
        order_count = int(order_count or 0); cons_qty = int(cons_qty or 0)
        transaction_count = order_count + cons_qty
        return {
            "ok": True, "engine": self.load_config(False)["engine"], "month": month,
            "revenue": revenue, "order_revenue": order_revenue,
            "consignment_gross": cons_gross, "consignment_commission": cons_commission,
            "consignment_owner": cons_owner, "consignment_cost": cons_cost,
            "consignment_profit": cons_profit, "consignment_quantity": cons_qty,
            "profit": profit, "order_profit": order_profit, "expenses": expenses,
            "net": revenue - expenses, "receivable": float(receivable or 0),
            "gross_margin": (profit / revenue * 100) if revenue else 0,
            "net_margin": ((revenue - expenses) / revenue * 100) if revenue else 0,
            "average_ticket": (revenue / transaction_count) if transaction_count else 0,
            "order_count": order_count, "transaction_count": transaction_count, "pending": pending,
        }

    def reports_summary(self, months: int = 12, start_month: str = "", end_month: str = "") -> dict[str, Any]:
        months = max(1, min(36, int(months or 12)))
        start_month = str(start_month or "")[:7]
        end_month = str(end_month or "")[:7]
        with Session(self.engine) as session:
            base_filters = [Order.deleted_at.is_(None), Order.status.not_in(("quote", "cancelled"))]
            if start_month: base_filters.append(func.substr(Order.date, 1, 7) >= start_month)
            if end_month: base_filters.append(func.substr(Order.date, 1, 7) <= end_month)
            monthly_query = (select(func.substr(Order.date, 1, 7).label("month"),
                       func.coalesce(func.sum(Order.total_price), 0).label("revenue"),
                       func.coalesce(func.sum(Order.profit), 0).label("profit"),
                       func.count(Order.id).label("orders"))
                .where(*base_filters).group_by(func.substr(Order.date, 1, 7))
                .order_by(func.substr(Order.date, 1, 7).desc()))
            if not start_month and not end_month: monthly_query = monthly_query.limit(months)
            monthly_rows = session.execute(monthly_query).all()
            totals = session.execute(select(func.coalesce(func.sum(Order.total_price),0), func.coalesce(func.sum(Order.profit),0), func.count(Order.id), func.coalesce(func.avg(Order.total_price),0)).where(*base_filters)).one()
            by_type = session.execute(select(Order.work_type, func.count(Order.id), func.coalesce(func.sum(Order.total_price),0), func.coalesce(func.sum(Order.profit),0)).where(*base_filters).group_by(Order.work_type).order_by(func.sum(Order.total_price).desc())).all()
            top_clients = session.execute(select(Client.id, Client.name, func.coalesce(func.sum(Order.total_price), 0), func.count(Order.id)).join(Order, Order.client_id == Client.id).where(*base_filters, Client.deleted_at.is_(None)).group_by(Client.id, Client.name).order_by(func.sum(Order.total_price).desc()).limit(10)).all()
            top_materials = session.execute(select(Order.material_name, func.coalesce(func.sum(Order.weight * Order.quantity), 0), func.count(Order.id), func.coalesce(func.sum(Order.total_price),0)).where(*base_filters, Order.material_name.is_not(None)).group_by(Order.material_name).order_by(func.sum(Order.weight * Order.quantity).desc()).limit(10)).all()
            printer_rows = session.execute(select(Printer.id, Printer.name, Printer.hours_used, func.count(Order.id), func.coalesce(func.sum(Order.print_time * Order.quantity), 0)).outerjoin(Order, Order.printer_id == Printer.id).group_by(Printer.id, Printer.name, Printer.hours_used).order_by(func.sum(Order.print_time * Order.quantity).desc()).limit(20)).all()
            exp_filters=[]
            if start_month: exp_filters.append(func.substr(Expense.date,1,7)>=start_month)
            if end_month: exp_filters.append(func.substr(Expense.date,1,7)<=end_month)
            expense_rows=session.execute(select(func.substr(Expense.date,1,7),func.coalesce(func.sum(Expense.amount),0)).where(*exp_filters).group_by(func.substr(Expense.date,1,7))).all()
        revenue, profit, count, avg_ticket = totals
        return {
            "ok": True, "engine": self.load_config(False)["engine"],
            "period": {"start": start_month, "end": end_month},
            "totals": {"revenue":float(revenue or 0),"profit":float(profit or 0),"orders":int(count or 0),"average_ticket":float(avg_ticket or 0)},
            "monthly": [{"month": r[0], "revenue": float(r[1] or 0), "profit": float(r[2] or 0), "orders": int(r[3] or 0)} for r in reversed(monthly_rows)],
            "by_type": [{"type":r[0] or "unknown","orders":int(r[1] or 0),"revenue":float(r[2] or 0),"profit":float(r[3] or 0)} for r in by_type],
            "top_clients": [{"id": r[0], "name": r[1], "total": float(r[2] or 0), "orders": int(r[3] or 0)} for r in top_clients],
            "top_materials": [{"name": r[0] or "Não informado", "grams": float(r[1] or 0), "orders": int(r[2] or 0), "revenue":float(r[3] or 0)} for r in top_materials],
            "printers": [{"id": r[0], "name": r[1], "hours_used": float(r[2] or 0), "orders": int(r[3] or 0), "production_hours": float(r[4] or 0)} for r in printer_rows],
            "expenses_monthly": [{"month":r[0],"amount":float(r[1] or 0)} for r in expense_rows],
        }

    def consignment_summary(self, month: str = "") -> dict[str, Any]:
        today = datetime.now().date().isoformat()

        def _run_summary():
            with Session(self.engine) as session:
                active = session.execute(select(func.count(Consignment.id)).where(Consignment.status == "active")).scalar_one()
                overdue = session.execute(select(func.count(Consignment.id)).where(Consignment.status == "active", Consignment.due_date < today)).scalar_one()
                stock_value = session.execute(select(func.coalesce(func.sum((ConsignmentItem.quantity_sent-ConsignmentItem.quantity_sold-ConsignmentItem.quantity_returned)*ConsignmentItem.unit_price),0)).join(Consignment, Consignment.id==ConsignmentItem.consignment_id).where(Consignment.status=="active")).scalar_one()
                totals_query = select(func.coalesce(func.sum(ConsignmentSettlement.gross_amount),0), func.coalesce(func.sum(ConsignmentSettlement.location_amount),0), func.coalesce(func.sum(ConsignmentSettlement.owner_amount),0))
                if month:
                    totals_query = totals_query.where(func.substr(ConsignmentSettlement.settlement_date,1,7)==month)
                totals = session.execute(totals_query).one()
                recent = session.execute(select(ConsignmentSettlement).order_by(ConsignmentSettlement.id.desc()).limit(8)).scalars().all()
            return {"ok":True,"active":int(active or 0),"overdue":int(overdue or 0),"stock_value":float(stock_value or 0),"gross":float(totals[0] or 0),"location_amount":float(totals[1] or 0),"owner_amount":float(totals[2] or 0),"recent_settlements":[self._to_dict(x) for x in recent]}

        try:
            return _run_summary()
        except OperationalError as exc:
            message = str(exc).lower()
            if "no such table" not in message and "does not exist" not in message and "invalid object name" not in message:
                raise
            self.ensure_schema_current()
            return _run_summary()

    def create_consignment_transaction(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Cria consignação e item em uma única transação, reservando o estoque do produto."""
        location_id = int(payload.get("location_id") or 0)
        product_id = int(payload.get("product_id") or 0)
        quantity = int(payload.get("quantity_sent") or 0)
        if not location_id: raise ValueError("Selecione o local de consignação")
        if not product_id: raise ValueError("Selecione o produto a consignar")
        if quantity <= 0: raise ValueError("Quantidade consignada deve ser maior que zero")
        with self.lock, Session(self.engine) as session:
            location = session.get(ConsignmentLocation, location_id)
            if location is None or not location.active: raise ValueError("Local de consignação inválido ou inativo")
            if not location.client_id: raise ValueError("O local selecionado não está vinculado a um cliente")
            client = session.get(Client, int(location.client_id))
            if client is None or client.deleted_at: raise ValueError("O cliente vinculado ao local não está disponível")
            product = session.get(Product, product_id)
            if product is None or product.deleted_at or not product.active: raise ValueError("Produto inválido ou inativo")
            if int(product.stock_qty or 0) < quantity:
                raise ValueError(f"Estoque insuficiente. Disponível: {int(product.stock_qty or 0)}")
            order_id = payload.get("order_id")
            if order_id not in (None, ""):
                order = session.get(Order, int(order_id))
                if order is None or order.deleted_at: raise ValueError("Pedido informado não existe")
                if order.client_id and int(order.client_id) != int(location.client_id):
                    raise ValueError("O pedido pertence a outro cliente")
                if order.product_id and int(order.product_id) != product_id:
                    raise ValueError("O produto do pedido é diferente do produto consignado")
            commission = float(payload.get("commission_pct") if payload.get("commission_pct") not in (None, "") else location.commission_pct or 0)
            if commission < 0 or commission > 100: raise ValueError("Comissão deve estar entre 0 e 100%")
            unit_price = float(payload.get("unit_price") if payload.get("unit_price") not in (None, "") else product.sale_price or 0)
            if unit_price < 0: raise ValueError("Preço unitário inválido")
            now = datetime.now().isoformat(timespec="seconds")
            cons = Consignment(
                location_id=location.id, client_id=location.client_id, order_id=int(order_id) if order_id not in (None, "") else None,
                start_date=str(payload.get("start_date") or datetime.now().date().isoformat()),
                due_date=str(payload.get("due_date") or datetime.now().date().isoformat()),
                commission_pct=commission, status="active", notes=str(payload.get("notes") or "").strip() or None, created_at=now
            )
            session.add(cons); session.flush()
            item = ConsignmentItem(
                consignment_id=cons.id, product_id=product.id, description=product.name, quantity_sent=quantity,
                quantity_sold=0, quantity_returned=0, unit_price=unit_price, created_at=now
            )
            product.stock_qty = int(product.stock_qty or 0) - quantity
            product.updated_at = now
            session.add(item); session.commit(); session.refresh(cons); session.refresh(item)
            return {"ok": True, "consignment": self._to_dict(cons), "item": self._to_dict(item), "product_stock": product.stock_qty}

    def return_consignment_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Registra devolução e devolve as unidades ao estoque disponível do produto."""
        item_id = int(payload.get("item_id") or 0)
        quantity = int(payload.get("quantity_returned") or 0)
        if quantity <= 0: raise ValueError("Quantidade devolvida deve ser maior que zero")
        with self.lock, Session(self.engine) as session:
            item = session.get(ConsignmentItem, item_id)
            if item is None: raise LookupError("Item consignado não encontrado")
            cons = session.get(Consignment, item.consignment_id)
            if cons is None or cons.status != "active": raise ValueError("A consignação não está ativa")
            available = int(item.quantity_sent or 0) - int(item.quantity_sold or 0) - int(item.quantity_returned or 0)
            if quantity > available: raise ValueError(f"Quantidade superior ao saldo no local ({available})")
            product = session.get(Product, item.product_id) if item.product_id else None
            if product is None: raise ValueError("Produto vinculado ao item não foi encontrado")
            item.quantity_returned = int(item.quantity_returned or 0) + quantity
            product.stock_qty = int(product.stock_qty or 0) + quantity
            product.updated_at = datetime.now().isoformat(timespec="seconds")
            session.commit(); session.refresh(item)
            return {"ok": True, "item": self._to_dict(item), "product_stock": product.stock_qty}

    def settle_consignment(self, payload: dict[str, Any]) -> dict[str, Any]:
        item_id=int(payload.get("item_id") or 0); qty=int(payload.get("quantity_sold") or 0)
        if qty <= 0: raise ValueError("Quantidade vendida deve ser maior que zero")
        with self.lock, Session(self.engine) as session:
            item=session.get(ConsignmentItem,item_id)
            if not item: raise LookupError("Item consignado não encontrado")
            cons=session.get(Consignment,item.consignment_id)
            available=int(item.quantity_sent or 0)-int(item.quantity_sold or 0)-int(item.quantity_returned or 0)
            if qty>available: raise ValueError("Quantidade vendida supera o saldo consignado")
            gross=qty*float(item.unit_price or 0); pct=float(cons.commission_pct or 0)
            local=gross*pct/100; owner=gross-local
            item.quantity_sold=int(item.quantity_sold or 0)+qty
            settlement=ConsignmentSettlement(consignment_id=cons.id,item_id=item.id,quantity_sold=qty,gross_amount=gross,location_amount=local,owner_amount=owner,settlement_date=str(payload.get("settlement_date") or datetime.now().date().isoformat()),notes=payload.get("notes"))
            session.add(settlement)
            remaining=int(item.quantity_sent or 0)-int(item.quantity_sold or 0)-int(item.quantity_returned or 0)
            all_items=session.execute(select(ConsignmentItem).where(ConsignmentItem.consignment_id==cons.id)).scalars().all()
            if remaining==0 and all((int(x.quantity_sent or 0)-int(x.quantity_sold or 0)-int(x.quantity_returned or 0))==0 for x in all_items):
                cons.status="closed"; cons.closed_at=datetime.now(timezone.utc).isoformat()
            session.commit(); session.refresh(settlement)
            return {"ok":True,"settlement":self._to_dict(settlement),"remaining":remaining}

    def _to_dict(self, obj) -> dict[str, Any]:
        data = {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
        if isinstance(obj, Printer):
            data["bambu_has_code"] = bool(data.get("bambu_access_code"))
            data["bambu_access_code"] = None
            data["bambu_configured"] = bool(data.get("bambu_ip") and data.get("bambu_serial") and data.get("bambu_has_code"))
        return data

    def status(self) -> dict[str, Any]:
        cfg = self.load_config(True)
        try:
            with self.engine.connect() as conn: conn.exec_driver_sql("SELECT 1")
            ok = True; error = ""
        except Exception as exc:
            ok = False; error = str(exc); self.last_error = error
        return {"ok": ok, "engine": cfg["engine"], "config": cfg, "relational": True, "tables": list(MODEL_MAP), "last_sync_at": self.last_sync_at, "last_error": error}
