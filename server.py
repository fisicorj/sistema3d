#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor local do 3D Print Pro.

Serve os arquivos estáticos do sistema e grava o banco SQLite gerado pelo
sql.js em app_data/sistema3d.sqlite. Não exige Flask nem pacotes externos.
Inclui integração MQTT com impressoras Bambu Lab via paho-mqtt.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import shutil
import sqlite3
import ssl
import threading
import time
import tempfile
import urllib.error
import urllib.request
import html as html_lib
import re
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote_plus, quote as url_quote

from platform_utils import IS_WINDOWS, IS_LINUX, SYSTEM as PLATFORM_SYSTEM, safe_replace
from server_core.config_store import load_json, save_json
from server_core.database_service import validate_sqlite, database_metadata
from server_core.database_backend_service import DatabaseBackendService
from server_core.backup_service import BackupService
from server_core.auth_service import AuthService
from server_core.api_service import ApiService
from server_core.validators import require_http_url, clamp_text
from server_core.integrations import (MercadoLivreMixin, EtsyMixin, MelhorEnvioMixin, BambuMixin, BambuMultiMonitor, MQTT_AVAILABLE, AttachmentsMixin)
import server_core.integrations.bambu_service as _bambu_module

BASE_DIR       = Path(__file__).resolve().parent
DATA_DIR       = BASE_DIR / "app_data"
DB_FILE        = DATA_DIR / "sistema3d.sqlite"
BACKUP_DIR     = DATA_DIR / "backups"
MAX_DB_SIZE    = 50 * 1024 * 1024   # 50 MB
DB_WRITE_LOCK   = threading.RLock()
DB_REPLACE_RETRIES = 20
DB_REPLACE_DELAY = 0.10


# ═══════════════════════════════════════════════════════════════════
#  BambuMonitor — cliente MQTT em background para Bambu Lab
# ═══════════════════════════════════════════════════════════════════



_bambu = None
_backup_service = None
_auth_service = None
_api_service = None
_database_backend = None

# ═══════════════════════════════════════════════════════════════════
#  Printables GraphQL helper + cache
# ═══════════════════════════════════════════════════════════════════

_trending_cache: dict = {}
_trending_lock  = threading.Lock()
TRENDING_TTL    = 3600  # 1 hora













def _graphql_printables(query: str, timeout: int = 15) -> dict:
    raw = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.printables.com/graphql/",
        data=raw,
        headers={
            "Content-Type": "application/json",
            "Accept":       "application/json",
            "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Origin":       "https://www.printables.com",
            "Referer":      "https://www.printables.com/",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise ValueError(f"Printables API {e.code}: {body[:500]}")


# ═══════════════════════════════════════════════════════════════════
#  HTTP Handler
# ═══════════════════════════════════════════════════════════════════

class Sistema3DHandler(MercadoLivreMixin, EtsyMixin, MelhorEnvioMixin, BambuMixin, AttachmentsMixin, SimpleHTTPRequestHandler):
    ATTACHMENTS_ROOT = DATA_DIR / "attachments"
    server_version = "Sistema3DLocal/1.1"

    def _host_allowed(self) -> bool:
        raw = (self.headers.get("Host") or "").strip()
        if not raw:
            return False
        if raw.startswith("[") and "]" in raw:
            host = raw[1:raw.find("]")]
        else:
            host = raw.rsplit(":", 1)[0] if ":" in raw else raw
        host = host.strip().lower().rstrip(".")
        allowed = {"localhost", "127.0.0.1", "::1"}
        allowed.update(
            item.strip().lower().rstrip(".")
            for item in os.environ.get("S3D_ALLOWED_HOSTS", "").split(",")
            if item.strip()
        )
        if host in allowed:
            return True
        try:
            addr = ipaddress.ip_address(host)
            return addr.is_private or addr.is_loopback or addr.is_link_local
        except ValueError:
            return False

    def _reject_bad_host(self) -> bool:
        if self._host_allowed():
            return False
        payload = b'{"ok":false,"error":"Host nao autorizado"}'
        self.send_response(421)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
        return True

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        host_header = (self.headers.get("Host") or "").lower()
        forwarded_https = self.headers.get("X-Forwarded-Proto", "").lower() == "https"
        if host_header.startswith("localhost") or host_header.startswith("127.0.0.1") or host_header.startswith("[::1]") or forwarded_https:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; "
            "font-src 'self' data:; "
            "img-src 'self' data: blob: https:; "
            "connect-src 'self' https://viacep.com.br; "
            "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
            "frame-ancestors 'none'; form-action 'self'"
        )
        super().end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        if self._reject_bad_host():
            return
        super().do_HEAD()

    def do_GET(self) -> None:  # noqa: N802
        if self._reject_bad_host():
            return
        path = urlparse(self.path).path

        if path == "/api/auth/status":
            self._send_json(_auth_service.status(self.headers.get("Cookie", "")))
            return
        if path == "/api/auth/logout":
            _auth_service.logout(self.headers.get("Cookie", ""))
            payload=b'{"ok":true}'
            self.send_response(200); self.send_header("Content-Type","application/json")
            self.send_header("Set-Cookie","s3d_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
            self.send_header("Content-Length",str(len(payload))); self.end_headers(); self.wfile.write(payload)
            return
        if path.startswith("/api/v1/"):
            if _auth_service.config().get("enabled") and not self._require_auth("api"):
                return
            qs = parse_qs(urlparse(self.path).query)
            try:
                if path == "/api/v1/summary": self._send_json(_api_service.summary()); return
                resource = path.rsplit("/", 1)[-1]
                self._send_json(_api_service.list_resource(resource, qs.get("limit", [50])[0], qs.get("offset", [0])[0])); return
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400); return
        if _auth_service.config().get("enabled") and path.startswith("/api/") and path not in {"/api/auth/login","/api/auth/status"}:
            if not self._require_auth(self._permission_for_path(path)):
                return

        # Evita 404 desnecessário no console do navegador.
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        if path == "/api/platform":
            self._send_json({"platform": PLATFORM_SYSTEM, "is_windows": IS_WINDOWS, "is_linux": IS_LINUX})
            return
        if path == "/api/backup/config":
            self._send_json(_backup_service.load_config() if _backup_service else {"enabled":False})
            return
        if path == "/api/backup/list":
            self._send_json({"ok":True,"backups":_backup_service.list_backups() if _backup_service else []})
            return
        if path == "/api/relational/bootstrap":
            try:
                self._send_json(_database_backend.bootstrap())
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 503)
            return
        if path == "/api/relational/finance":
            try:
                qs = parse_qs(urlparse(self.path).query)
                self._send_json(_database_backend.finance_summary(qs.get("month", [""])[0]))
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/reports":
            try:
                qs = parse_qs(urlparse(self.path).query)
                self._send_json(_database_backend.reports_summary(qs.get("months", [12])[0], qs.get("start", [""])[0], qs.get("end", [""])[0]))
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/integrity":
            try:
                self._send_json(_database_backend.integrity_status())
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/consignments-summary":
            try:
                qs = parse_qs(urlparse(self.path).query)
                self._send_json(_database_backend.consignment_summary(qs.get("month", [""])[0]))
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path.startswith("/api/relational/"):
            parts = [p for p in path.split("/") if p]
            try:
                qs = parse_qs(urlparse(self.path).query)
                resource = parts[2]
                if len(parts) >= 4:
                    self._send_json(_database_backend.get_item(resource, parts[3]))
                else:
                    self._send_json(_database_backend.list_items(resource, qs.get("limit", [100])[0], qs.get("offset", [0])[0]))
            except LookupError as exc:
                self._send_json({"ok": False, "error": str(exc)}, 404)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/db":
            self._send_db()
            return
        if path == "/api/attachments/download":
            self._download_attachment()
            return

        if path == "/api/db/status":
            self._send_json_status()
            return
        if path == "/api/database/config":
            self._send_json(_database_backend.status())
            return

        if path == "/api/melhor-envio/config":
            self._send_melhor_envio_config()
            return

        if path == "/api/bambu-status":
            persisted = _database_backend.get_bambu_configs(include_secret=True) if _database_backend else {}
            if _bambu:
                _bambu.ensure_from_configs(persisted)
                statuses = _bambu.get_all_statuses()
            else:
                statuses = {}
            # Inclui todas as impressoras configuradas, mesmo durante conexão/offline.
            for pid, cfg in persisted.items():
                public_cfg = {k: v for k, v in cfg.items() if k != "access_code"}
                statuses.setdefault(pid, {"connected": False, **public_cfg})
                statuses[pid].update({k: v for k, v in public_cfg.items() if k not in statuses[pid]})
            self._send_json(statuses)
            return

        if path == "/api/bambu-config":
            configs = _database_backend.get_bambu_configs(include_secret=False) if _database_backend else (_bambu.get_configs() if _bambu else {})
            # Junta o estado de conexão atual para a tela de configurações.
            statuses = _bambu.get_all_statuses() if _bambu else {}
            for pid, cfg in configs.items():
                st = statuses.get(pid, {})
                cfg["connected"] = bool(st.get("connected"))
                cfg["busy"] = bool(st.get("busy"))
                cfg["gcode_state"] = st.get("gcode_state")
                cfg["error"] = st.get("error", "")
            self._send_json(configs)
            return

        if path == "/api/trending":
            qs = parse_qs(urlparse(self.path).query)
            ordering = qs.get("ordering", ["-likes_count"])[0]
            self._send_trending(ordering)
            return

        if path == "/api/market-search":
            qs   = parse_qs(urlparse(self.path).query)
            q    = (qs.get("q",    ["suporte 3d"])[0])[:120]
            sort = qs.get("sort", ["sold_quantity"])[0]
            self._send_market_search(q, sort)
            return

        if path == "/api/etsy-search":
            qs   = parse_qs(urlparse(self.path).query)
            q    = (qs.get("q", ["3d printed desk organizer"])[0])[:120]
            sort = qs.get("sort", ["relevance"])[0]
            self._send_etsy_search(q, sort)
            return

        if path == "/api/etsy-config":
            self._send_etsy_config()
            return

        if path == "/api/ml-config":
            self._send_ml_config()
            return

        if path == "/api/ml-oauth-start":
            self._send_ml_oauth_start()
            return

        if path == "/api/ml-oauth-callback":
            self._handle_ml_oauth_callback(urlparse(self.path).query)
            return

        if path == "/":
            self.path = "/index.html"

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self._reject_bad_host():
            return
        path = urlparse(self.path).path

        if path == "/api/auth/login":
            try:
                body = self._read_json_body()
                token, user = _auth_service.login(body.get("email", ""), body.get("password", ""), self.client_address[0] if self.client_address else "local")
                payload = json.dumps({"ok": True, "user": user}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Set-Cookie", f"s3d_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={_auth_service.session_ttl}")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers(); self.wfile.write(payload)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 401)
            return

        if path == "/api/auth/setup":
            try:
                status = _auth_service.status(self.headers.get("Cookie", ""))
                if status.get("enabled") and status.get("configured"):
                    current = status.get("user")
                    if not current or not (current.get("permissions") or {}).get("all"):
                        self._send_json({"ok": False, "error": "Apenas administradores podem alterar a autenticação"}, 403); return
                body = self._read_json_body()
                user = None
                pwd = body.get("password", "")
                if pwd:
                    user = _auth_service.set_password(int(body.get("user_id")), pwd)
                cfg = _auth_service.save_config(bool(body.get("enabled", True)), int(body.get("session_hours", 12)))
                self._send_json({"ok": True, "user": user, "config": cfg})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return

        if _auth_service.config().get("enabled") and path.startswith("/api/"):
            if not self._require_auth(self._permission_for_path(path)):
                return

        if path == "/favicon.ico":
            self.send_response(204); self.end_headers(); return
        if path == "/api/backup/config":
            try:
                cfg = _backup_service.save_config(self._read_json_body()); self._send_json({"ok": True, "config": cfg})
            except Exception as exc: self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/backup/run":
            try:
                target = _backup_service.create_backup("manual"); self._send_json({"ok": True, "file": target.name})
            except Exception as exc: self._send_json({"ok": False, "error": str(exc)}, 500)
            return
        if path == "/api/database/test":
            try:
                self._send_json(_database_backend.test_connection(self._read_json_body()))
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/database/config":
            try:
                cfg = _database_backend.migrate_and_activate(self._read_json_body())
                self._send_json({"ok": True, "config": cfg, "status": _database_backend.status()})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/sync":
            try:
                self._send_json(_database_backend.sync(self._read_json_body(max_bytes=10 * 1024 * 1024)))
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/transactions/order":
            try:
                self._send_json(_database_backend.create_order_transaction(self._read_json_body(max_bytes=2 * 1024 * 1024)), 201)
            except LookupError as exc:
                self._send_json({"ok": False, "error": str(exc)}, 404)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/transactions/payment":
            try:
                body = self._read_json_body(max_bytes=256 * 1024)
                self._send_json(_database_backend.record_payment_transaction(body.get("order_id"), body.get("amount")))
            except LookupError as exc:
                self._send_json({"ok": False, "error": str(exc)}, 404)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/transactions/consignment-create":
            try:
                self._send_json(_database_backend.create_consignment_transaction(self._read_json_body(max_bytes=256 * 1024)), 201)
            except LookupError as exc:
                self._send_json({"ok": False, "error": str(exc)}, 404)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/transactions/consignment-return":
            try:
                self._send_json(_database_backend.return_consignment_item(self._read_json_body(max_bytes=256 * 1024)))
            except LookupError as exc:
                self._send_json({"ok": False, "error": str(exc)}, 404)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/relational/transactions/consignment-settlement":
            try:
                self._send_json(_database_backend.settle_consignment(self._read_json_body(max_bytes=256 * 1024)))
            except LookupError as exc:
                self._send_json({"ok": False, "error": str(exc)}, 404)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path.startswith("/api/relational/"):
            parts = [p for p in path.split("/") if p]
            try:
                resource = parts[2]
                body = self._read_json_body(max_bytes=10 * 1024 * 1024)
                if len(parts) >= 4 and parts[3] == "sync-resource":
                    self._send_json(_database_backend.sync_resource(resource, body.get("items", []), bool(body.get("delete_missing", True))))
                else:
                    self._send_json(_database_backend.create_item(resource, body), 201)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        if path == "/api/db": self._receive_db(); return
        if path == "/api/attachments/upload": self._upload_attachment(); return
        if path == "/api/attachments/delete": self._delete_attachment_file(); return
        if path == "/api/melhor-envio/config": self._save_melhor_envio_config(); return
        if path == "/api/melhor-envio/calculate": self._calculate_melhor_envio(); return
        if path == "/api/bambu-config": self._save_bambu_config(); return
        if path == "/api/ml-config": self._save_ml_config(); return
        if path == "/api/etsy-config": self._save_etsy_config(); return
        self.send_error(404, "Endpoint não encontrado")

    def do_PUT(self) -> None:  # noqa: N802
        if self._reject_bad_host():
            return
        path = urlparse(self.path).path
        if _auth_service.config().get("enabled") and not self._require_auth(self._permission_for_path(path)):
            return
        if path.startswith("/api/relational/"):
            parts = [p for p in path.split("/") if p]
            if len(parts) < 4:
                self._send_json({"ok": False, "error": "ID obrigatório"}, 400); return
            try:
                self._send_json(_database_backend.update_item(parts[2], parts[3], self._read_json_body(max_bytes=2 * 1024 * 1024)))
            except LookupError as exc:
                self._send_json({"ok": False, "error": str(exc)}, 404)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        self.send_error(404, "Endpoint não encontrado")

    def do_DELETE(self) -> None:  # noqa: N802
        if self._reject_bad_host():
            return
        parsed = urlparse(self.path); path = parsed.path
        if _auth_service.config().get("enabled") and not self._require_auth(self._permission_for_path(path)):
            return
        if path.startswith("/api/relational/"):
            parts = [p for p in path.split("/") if p]
            if len(parts) < 4:
                self._send_json({"ok": False, "error": "ID obrigatório"}, 400); return
            try:
                hard = parse_qs(parsed.query).get("hard", ["0"])[0] in {"1","true","yes"}
                self._send_json(_database_backend.delete_item(parts[2], parts[3], hard))
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        self.send_error(404, "Endpoint não encontrado")

    def _permission_for_path(self, path: str) -> str:
        if any(x in path for x in ("backup","db","config","auth/setup")): return "admin"
        if "attachments" in path: return "orders"
        if any(x in path for x in ("market","etsy","trending")): return "radar"
        return "api"

    def _require_auth(self, permission: str = "api") -> bool:
        user = _auth_service.current_user(self.headers.get("Cookie", ""))
        if not user:
            self._send_json({"ok":False,"error":"Autenticação necessária","code":"unauthorized"},401); return False
        if permission == "admin" and not (user.get("permissions") or {}).get("all"):
            self._send_json({"ok":False,"error":"Permissão insuficiente","code":"forbidden"},403); return False
        if permission not in ("api","admin") and not _auth_service.allowed(user, permission):
            self._send_json({"ok":False,"error":"Permissão insuficiente","code":"forbidden"},403); return False
        return True

    # ── Trending (Printables) ─────────────────────────────────────
    def _send_trending(self, ordering: str = "-likes_count") -> None:
        allowed = {"-likes_count", "-download_count", "-first_publish"}
        if ordering not in allowed:
            ordering = "-likes_count"

        with _trending_lock:
            cached = _trending_cache.get(ordering)
            if cached and time.time() - cached["ts"] < TRENDING_TTL:
                self._send_json(cached["data"])
                return

        # Tenta variantes do campo de imagem (schema do Printables varia)
        queries = [
            ('image',      '{ image { url } }'),
            ('firstImage', '{ firstImage { url } }'),
            ('images',     '{ images(limit:1) { url } }'),
            ('noimage',    ''),
        ]

        items = []
        img_key = None
        last_error = None

        for key, img_fragment in queries:
            query = """
            {
              prints(limit: 24, ordering: "%s") {
                items {
                  id name slug
                  category { name }
                  likesCount downloadCount
                  user { publicUsername }
                  %s
                }
              }
            }
            """ % (ordering, img_fragment)

            try:
                result = _graphql_printables(query)
                gql_errors = result.get("errors")
                if gql_errors:
                    last_error = gql_errors[0].get("message", "GraphQL error")
                    continue
                items = result.get("data", {}).get("prints", {}).get("items", [])
                img_key = key
                break
            except Exception as exc:
                last_error = str(exc)
                continue

        try:
            if not items:
                raise ValueError(last_error or "Nenhum resultado retornado pelo Printables")

            for item in items:
                url = ""
                if img_key == "image":
                    url = (item.get("image") or {}).get("url", "")
                elif img_key == "firstImage":
                    url = (item.get("firstImage") or {}).get("url", "")
                elif img_key == "images":
                    imgs = item.get("images") or []
                    url = imgs[0].get("url", "") if imgs else ""
                item["imageUrl"] = url
                item["url"] = f"https://www.printables.com/model/{item['id']}-{item.get('slug', '')}"

            data = {"ok": True, "prints": items, "cached_at": int(time.time()), "img_key": img_key}
            with _trending_lock:
                _trending_cache[ordering] = {"ts": time.time(), "data": data}
            self._send_json(data)

        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc), "prints": []}, 502)

    # ── ML config ────────────────────────────────────────────────


    # ── ML OAuth ─────────────────────────────────────────────────


    # ── Mercado Livre search ──────────────────────────────────────


    # ── Etsy config e busca oficial ───────────────────────────────





    # ── Melhor Envio config/cotação ───────────────────────────────



    # ── Bambu config ──────────────────────────────────────────────

    # ── DB ────────────────────────────────────────────────────────
    def _receive_db(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            self.send_error(400, "Corpo vazio")
            return
        if length > MAX_DB_SIZE:
            self.send_error(413, "Banco muito grande")
            return
        try:
            body = self.rfile.read(length)
        except Exception:
            return  # cliente desconectou durante o upload — nada a responder
        if not body.startswith(b"SQLite format 3"):
            self.send_error(400, "Arquivo recebido não parece ser um SQLite válido")
            return
        try:
            backup_file = None
            if DB_FILE.exists():
                cfg = _backup_service.load_config() if _backup_service else {}
                backup_file = (_backup_service.create_backup("save") if _backup_service and cfg.get("enabled") and cfg.get("frequency") == "on_save" else self._create_backup())
            result = _database_backend.save_snapshot(body)
            self._prune_backups(max_files=30)
            result["backup"] = backup_file.name if backup_file else None
            self._send_json(result)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc), "code": "database_save_failed", "platform": PLATFORM_SYSTEM}, 503)

    def _read_json_body(self, max_bytes: int = 64 * 1024) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        if length > max_bytes:
            raise ValueError("Payload muito grande")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") or "{}")

    def _send_json(self, data: dict | list, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    # ── DB helpers ────────────────────────────────────────────────
    def _send_db(self) -> None:
        try:
            data, mtime, source = _database_backend.load_snapshot()
            if not data:
                self.send_response(204); self.end_headers(); return
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.sqlite3")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", 'inline; filename="sistema3d.sqlite"')
            self.send_header("X-Sistema3D-MTime", str(mtime))
            self.send_header("X-Sistema3D-Backend", source)
            self.end_headers(); self.wfile.write(data)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 503)

    def _send_json_status(self) -> None:
        payload = _database_backend.status()
        payload.setdefault("quick_check", "ok" if DB_FILE.exists() and self._is_valid_sqlite(DB_FILE) else "espelho indisponível")
        payload.setdefault("local_valid", bool(DB_FILE.exists() and self._is_valid_sqlite(DB_FILE)))
        payload.update({
            "db_exists": DB_FILE.exists(),
            "db_file": DB_FILE.as_posix(),
            "size_bytes": DB_FILE.stat().st_size if DB_FILE.exists() else 0,
            "backup_dir": BACKUP_DIR.as_posix(),
            "backup_count": len(list(BACKUP_DIR.glob("*.sqlite"))) if BACKUP_DIR.exists() else 0,
        })
        self._send_json(payload)

    def _is_valid_sqlite(self, path: Path) -> bool:
        try:
            with sqlite3.connect(path) as conn:
                row = conn.execute("PRAGMA quick_check").fetchone()
            return bool(row and row[0] == "ok")
        except sqlite3.Error:
            return False

    def _create_backup(self) -> Path:
        stamp       = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = BACKUP_DIR / f"sistema3d_{stamp}.sqlite"
        shutil.copy2(DB_FILE, backup_file)
        return backup_file

    def _prune_backups(self, max_files: int = 30) -> None:
        backups = sorted(
            BACKUP_DIR.glob("*.sqlite"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for old in backups[max_files:]:
            old.unlink(missing_ok=True)


# ═══════════════════════════════════════════════════════════════════
#  Entrypoint
# ═══════════════════════════════════════════════════════════════════

def main() -> None:
    global _bambu, _backup_service, _auth_service, _api_service, _database_backend

    parser = argparse.ArgumentParser(description="Servidor local do Sistema 3D")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    os.chdir(BASE_DIR)
    DATA_DIR.mkdir(exist_ok=True)
    BACKUP_DIR.mkdir(exist_ok=True)

    _database_backend = DatabaseBackendService(DB_FILE, DATA_DIR / "database_config.json", DB_WRITE_LOCK)
    _database_backend.initialize()
    _backup_service = BackupService(DB_FILE, BACKUP_DIR, DATA_DIR / "backup_config.json", DB_WRITE_LOCK)
    _backup_service.start()
    _auth_service = AuthService(DB_FILE, DATA_DIR / "auth_config.json")
    _api_service = ApiService(DB_FILE, _database_backend)

    try:
        _bambu = BambuMultiMonitor()
        # Carrega a configuração Bambu do banco relacional ativo (SQLite, PostgreSQL ou SQL Server).
        if _bambu and _database_backend:
            try:
                _configs = _database_backend.get_bambu_configs(include_secret=True)
                # Migra automaticamente configurações legadas do JSON para a tabela printers.
                _legacy = _bambu.get_configs(include_secret=True)
                for _pid, _cfg in _legacy.items():
                    if _pid in _configs:
                        continue
                    try:
                        _database_backend.save_bambu_config(
                            int(_pid), _cfg.get("ip", ""), _cfg.get("serial", ""), _cfg.get("access_code", "")
                        )
                    except Exception as _migrate_exc:
                        print("[Bambu] Aviso ao migrar JSON da impressora {}: {}".format(_pid, _migrate_exc))
                _configs = _database_backend.get_bambu_configs(include_secret=True)
                _bambu.ensure_from_configs(_configs)
                if _configs:
                    print("[Bambu] {} impressora(s) carregada(s) do banco relacional".format(len(_configs)))
            except Exception as _exc:
                print("[Bambu] Aviso: nao foi possivel carregar do banco relacional: {}".format(_exc))
    except Exception as exc:
        print("[Bambu] Monitor nao iniciado: {}".format(exc))
        _bambu = None
    _bambu_module._bambu = _bambu  # expõe o monitor para o BambuMixin
    _bambu_module._database_backend = _database_backend

    httpd = ThreadingHTTPServer((args.host, args.port), Sistema3DHandler)
    url = "http://{}:{}".format(args.host, args.port)
    sep = "-" * 50
    print(sep)
    print("3D Print Pro - servidor local")
    print("Acesse: " + url)
    print("Banco: " + str(DB_FILE))
    print("Backups: " + str(BACKUP_DIR) + " (max. 30)")
    if not MQTT_AVAILABLE:
        print("AVISO: paho-mqtt nao instalado - Bambu Lab desativado")
        print("  Para ativar: pip install paho-mqtt")
    elif _bambu:
        n = len(_bambu._connections)
        if n:
            print("Bambu Lab MQTT: {} impressora(s) configurada(s)".format(n))
        else:
            print("Bambu Lab: configure por impressora em Impressoras")
    if args.host not in ("127.0.0.1", "localhost"):
        print("AVISO: host diferente de 127.0.0.1 expoe o sistema na rede.")
    print(sep)
    print("Pressione Ctrl+C para parar.")
    print("")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
