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
import json
import os
import shutil
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False

BASE_DIR       = Path(__file__).resolve().parent
DATA_DIR       = BASE_DIR / "app_data"
DB_FILE        = DATA_DIR / "sistema3d.sqlite"
BACKUP_DIR     = DATA_DIR / "backups"
ME_CONFIG_FILE = DATA_DIR / "melhor_envio_config.json"
BAMBU_CFG_FILE = DATA_DIR / "bambu_config.json"
MAX_DB_SIZE    = 50 * 1024 * 1024   # 50 MB


# ═══════════════════════════════════════════════════════════════════
#  BambuMonitor — cliente MQTT em background para Bambu Lab
# ═══════════════════════════════════════════════════════════════════

class BambuMonitor:
    """
    Mantém uma conexão MQTT TLS com a impressora Bambu Lab na rede local.
    Broker em <ip>:8883, user: bblp, password: <access_code>.
    Tópico: device/<serial>/report
    """

    MQTT_PORT      = 8883
    MQTT_USER      = "bblp"
    RECONNECT_DELAY = 15   # segundos entre tentativas

    def __init__(self):
        self._lock      = threading.Lock()
        self._status    : dict = {}
        self._connected : bool = False
        self._error     : str  = ""
        self._client           = None
        self._thread           = None
        self._stop_evt  = threading.Event()

        self._ip          = ""
        self._serial      = ""
        self._access_code = ""

        self._load_config()
        if self._ip and self._serial and self._access_code:
            self._start()

    # ── Config ───────────────────────────────────────────────────
    def _load_config(self):
        if BAMBU_CFG_FILE.exists():
            try:
                cfg = json.loads(BAMBU_CFG_FILE.read_text(encoding="utf-8"))
                self._ip          = cfg.get("ip", "")
                self._serial      = cfg.get("serial", "")
                self._access_code = cfg.get("access_code", "")
            except Exception:
                pass

    def save_config(self, ip: str, serial: str, access_code: str):
        DATA_DIR.mkdir(exist_ok=True)
        BAMBU_CFG_FILE.write_text(
            json.dumps({"ip": ip, "serial": serial, "access_code": access_code},
                       ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        needs_restart = (
            ip != self._ip
            or serial != self._serial
            or access_code != self._access_code
        )
        self._ip, self._serial, self._access_code = ip, serial, access_code
        if needs_restart and ip and serial and access_code:
            self._stop()
            self._start()

    # ── MQTT lifecycle ────────────────────────────────────────────
    def _start(self):
        if not MQTT_AVAILABLE:
            self._error = "paho-mqtt não instalado — execute: pip install paho-mqtt"
            return
        self._stop_evt.clear()
        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name="BambuMQTT"
        )
        self._thread.start()

    def _stop(self):
        self._stop_evt.set()
        if self._client:
            try:
                self._client.disconnect()
            except Exception:
                pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)

    def _run_loop(self):
        while not self._stop_evt.is_set():
            try:
                self._connect_once()
            except Exception as exc:
                with self._lock:
                    self._connected = False
                    self._error = str(exc)
            if not self._stop_evt.is_set():
                time.sleep(self.RECONNECT_DELAY)

    def _connect_once(self):
        # paho-mqtt 2.x requer CallbackAPIVersion; 1.x não tem o atributo
        try:
            client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION1,
                client_id="sistema3d",
                protocol=mqtt.MQTTv311,
            )
        except AttributeError:
            client = mqtt.Client(client_id="sistema3d", protocol=mqtt.MQTTv311)

        client.username_pw_set(self.MQTT_USER, self._access_code)

        # TLS sem verificação de CA (certificado auto-assinado da Bambu)
        tls_ctx = ssl.create_default_context()
        tls_ctx.check_hostname = False
        tls_ctx.verify_mode    = ssl.CERT_NONE
        client.tls_set_context(tls_ctx)

        client.on_connect    = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message    = self._on_message

        with self._lock:
            self._error = ""

        client.connect(self._ip, self.MQTT_PORT, keepalive=60)
        self._client = client
        client.loop_forever()   # bloqueia até disconnect()

    # ── Callbacks MQTT ────────────────────────────────────────────
    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            topic = f"device/{self._serial}/report"
            client.subscribe(topic, qos=0)
            with self._lock:
                self._connected = True
                self._error     = ""
            print(f"✅ BambuMonitor conectado — {self._ip} serial={self._serial}")
        else:
            with self._lock:
                self._connected = False
                self._error     = f"MQTT rc={rc}"

    def _on_disconnect(self, client, userdata, rc):
        with self._lock:
            self._connected = False
        if rc != 0:
            print(f"⚠️  BambuMonitor desconectado (rc={rc}), tentando em {self.RECONNECT_DELAY}s…")

    def _on_message(self, client, userdata, msg):
        try:
            payload    = json.loads(msg.payload.decode("utf-8"))
            print_data = payload.get("print", {})
            if not print_data:
                return
            with self._lock:
                self._status = {
                    "connected":        True,
                    "ts":               time.time(),
                    "gcode_state":      print_data.get("gcode_state", ""),
                    "mc_percent":       print_data.get("mc_percent", 0),
                    "mc_remaining_min": print_data.get("mc_remaining_time", 0),
                    "layer_num":        print_data.get("layer_num", 0),
                    "total_layer_num":  print_data.get("total_layer_num", 0),
                    "nozzle_temp":      print_data.get("nozzle_temper", 0),
                    "bed_temp":         print_data.get("bed_temper", 0),
                    "fan_gear":         print_data.get("fan_gear", 0),
                    "spd_lvl":          print_data.get("spd_lvl", 1),
                }
        except Exception:
            pass

    # ── Estado público ────────────────────────────────────────────
    def get_status(self) -> dict:
        with self._lock:
            if not self._ip:
                return {"configured": False, "connected": False,
                        "error": "Impressora não configurada"}
            if not MQTT_AVAILABLE:
                return {"configured": True, "connected": False,
                        "error": "paho-mqtt não instalado — pip install paho-mqtt"}
            base = {
                "configured": True,
                "connected":  self._connected,
                "ip":         self._ip,
                "serial":     self._serial,
                "error":      self._error,
            }
            base.update(self._status)
            return base


# Instância global iniciada ao importar o módulo
_bambu = BambuMonitor()


# ═══════════════════════════════════════════════════════════════════
#  HTTP Handler
# ═══════════════════════════════════════════════════════════════════

class Sistema3DHandler(SimpleHTTPRequestHandler):
    server_version = "Sistema3DLocal/1.1"

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/api/db":
            self._send_db()
            return

        if path == "/api/db/status":
            self._send_json_status()
            return

        if path == "/api/melhor-envio/config":
            self._send_melhor_envio_config()
            return

        if path == "/api/bambu-status":
            self._send_json(_bambu.get_status())
            return

        if path == "/":
            self.path = "/index.html"

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/api/db":
            self._receive_db()
            return
        if path == "/api/melhor-envio/config":
            self._save_melhor_envio_config()
            return
        if path == "/api/melhor-envio/calculate":
            self._calculate_melhor_envio()
            return
        if path == "/api/bambu-config":
            self._save_bambu_config()
            return

        self.send_error(404, "Endpoint não encontrado")

    # ── Bambu ─────────────────────────────────────────────────────
    def _save_bambu_config(self) -> None:
        try:
            data = self._read_json_body()
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 400)
            return
        ip          = str(data.get("ip", "")).strip()
        serial      = str(data.get("serial", "")).strip()
        access_code = str(data.get("access_code", "")).strip()
        _bambu.save_config(ip, serial, access_code)
        self._send_json({"ok": True, **_bambu.get_status()})

    # ── DB ────────────────────────────────────────────────────────
    def _receive_db(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            self.send_error(400, "Corpo vazio")
            return

        body = self.rfile.read(length)
        if not body.startswith(b"SQLite format 3"):
            self.send_error(400, "Arquivo recebido não parece ser um SQLite válido")
            return

        if length > MAX_DB_SIZE:
            self.send_error(413, "Banco muito grande para o modo local")
            return

        DATA_DIR.mkdir(exist_ok=True)
        BACKUP_DIR.mkdir(exist_ok=True)
        tmp_file = DB_FILE.with_suffix(".sqlite.tmp")
        tmp_file.write_bytes(body)

        if not self._is_valid_sqlite(tmp_file):
            tmp_file.unlink(missing_ok=True)
            self.send_error(400, "SQLite inválido ou corrompido")
            return

        backup_file = None
        if DB_FILE.exists():
            backup_file = self._create_backup()

        os.replace(tmp_file, DB_FILE)
        self._prune_backups(max_files=30)

        self._send_json({"ok": True, "backup": backup_file.name if backup_file else None})

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

    # ── Melhor Envio ──────────────────────────────────────────────
    def _load_melhor_envio_config(self) -> dict:
        defaults = {
            "enabled": False,
            "environment": "production",
            "access_token": "",
            "origin_cep": "",
            "user_agent": "Sistema3D Local (fisicorj@gmail.com)",
            "services": "",
        }
        if ME_CONFIG_FILE.exists():
            try:
                data = json.loads(ME_CONFIG_FILE.read_text(encoding="utf-8"))
                defaults.update({k: data.get(k, v) for k, v in defaults.items()})
            except Exception:
                pass
        return defaults

    def _public_melhor_envio_config(self) -> dict:
        cfg = self._load_melhor_envio_config()
        return {
            "ok": True,
            "enabled": bool(cfg.get("enabled")),
            "environment": cfg.get("environment") or "production",
            "origin_cep": cfg.get("origin_cep") or "",
            "user_agent": cfg.get("user_agent") or "",
            "services": cfg.get("services") or "",
            "has_token": bool(cfg.get("access_token")),
        }

    def _send_melhor_envio_config(self) -> None:
        self._send_json(self._public_melhor_envio_config())

    def _save_melhor_envio_config(self) -> None:
        try:
            data = self._read_json_body()
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 400)
            return

        old   = self._load_melhor_envio_config()
        token = str(data.get("access_token", "")).strip()
        if token in ("", "********"):
            token = old.get("access_token", "")

        cfg = {
            "enabled": bool(data.get("enabled")),
            "environment": "sandbox" if data.get("environment") == "sandbox" else "production",
            "access_token": token,
            "origin_cep": "".join(ch for ch in str(data.get("origin_cep", "")) if ch.isdigit())[:8],
            "user_agent": str(
                data.get("user_agent") or old.get("user_agent")
                or "Sistema3D Local (fisicorj@gmail.com)"
            ).strip(),
            "services": str(data.get("services") or "").strip(),
        }
        DATA_DIR.mkdir(exist_ok=True)
        ME_CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        self._send_json(self._public_melhor_envio_config())

    def _calculate_melhor_envio(self) -> None:
        cfg = self._load_melhor_envio_config()
        if not cfg.get("enabled"):
            self._send_json({"ok": False, "error": "Integração Melhor Envio desativada."}, 400)
            return
        if not cfg.get("access_token"):
            self._send_json({"ok": False, "error": "Access token do Melhor Envio não configurado."}, 400)
            return
        if len(cfg.get("origin_cep", "")) != 8:
            self._send_json({"ok": False, "error": "CEP de origem inválido nas configurações."}, 400)
            return

        try:
            data        = self._read_json_body()
            dest_cep    = "".join(ch for ch in str(data.get("to_cep", "")) if ch.isdigit())[:8]
            if len(dest_cep) != 8:
                raise ValueError("CEP de destino inválido")
            weight_kg       = max(0.01, float(data.get("weight_kg") or 0.01))
            width           = max(1.0,  float(data.get("width_cm") or 10))
            height          = max(1.0,  float(data.get("height_cm") or 5))
            length          = max(1.0,  float(data.get("length_cm") or 15))
            insurance_value = max(1.0,  float(data.get("insurance_value") or 1))
        except Exception as exc:
            self._send_json({"ok": False, "error": f"Dados inválidos: {exc}"}, 400)
            return

        payload = {
            "from": {"postal_code": cfg["origin_cep"]},
            "to":   {"postal_code": dest_cep},
            "products": [{
                "id": "sis3d",
                "width": width, "height": height, "length": length,
                "weight": weight_kg,
                "insurance_value": insurance_value,
                "quantity": 1,
            }],
            "options": {"receipt": False, "own_hand": False, "collect": False},
        }
        services = str(cfg.get("services") or "").strip()
        if services:
            payload["services"] = services

        base = (
            "https://sandbox.melhorenvio.com.br"
            if cfg.get("environment") == "sandbox"
            else "https://melhorenvio.com.br"
        )
        url = f"{base}/api/v2/me/shipment/calculate"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {cfg['access_token']}",
                "Accept":        "application/json",
                "Content-Type":  "application/json",
                "User-Agent":    cfg.get("user_agent") or "Sistema3D Local (fisicorj@gmail.com)",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw    = resp.read().decode("utf-8")
                result = json.loads(raw or "[]")
            self._send_json({"ok": True, "source": "melhor_envio", "quotes": result})
        except urllib.error.HTTPError as exc:
            msg = exc.read().decode("utf-8", errors="replace")
            self._send_json({"ok": False, "error": f"Melhor Envio HTTP {exc.code}", "details": msg}, 502)
        except Exception as exc:
            self._send_json({"ok": False, "error": f"Falha ao consultar Melhor Envio: {exc}"}, 502)

    # ── DB helpers ────────────────────────────────────────────────
    def _send_db(self) -> None:
        if not DB_FILE.exists():
            self.send_response(204)
            self.end_headers()
            return

        data = DB_FILE.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.sqlite3")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", 'inline; filename="sistema3d.sqlite"')
        self.end_headers()
        self.wfile.write(data)

    def _send_json_status(self) -> None:
        exists       = DB_FILE.exists()
        size         = DB_FILE.stat().st_size if exists else 0
        backup_count = len(list(BACKUP_DIR.glob("*.sqlite"))) if BACKUP_DIR.exists() else 0
        payload = json.dumps({
            "ok":           True,
            "db_exists":    exists,
            "db_file":      DB_FILE.as_posix(),
            "size_bytes":   size,
            "backup_dir":   BACKUP_DIR.as_posix(),
            "backup_count": backup_count,
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

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
    parser = argparse.ArgumentParser(description="Servidor local do Sistema 3D")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    os.chdir(BASE_DIR)
    DATA_DIR.mkdir(exist_ok=True)
    BACKUP_DIR.mkdir(exist_ok=True)

    httpd = ThreadingHTTPServer((args.host, args.port), Sistema3DHandler)
    url   = f"http://{args.host}:{args.port}"
    print("🟢 3D Print Pro — servidor local")
    print(f"🌐 Acesse: {url}")
    print(f"💾 Banco SQLite: {DB_FILE}")
    print(f"🛟 Backups automáticos: {BACKUP_DIR} (últimos 30)")
    if MQTT_AVAILABLE and _bambu._ip:
        print(f"🖨️  Bambu Lab MQTT: {_bambu._ip}:{BambuMonitor.MQTT_PORT} (serial {_bambu._serial})")
    elif not MQTT_AVAILABLE:
        print("⚠️  paho-mqtt não instalado — monitoramento Bambu desativado")
    if args.host not in ("127.0.0.1", "localhost"):
        print("⚠️  Atenção: host diferente de 127.0.0.1 expõe o sistema na rede local.")
    print("Pressione Ctrl+C para parar.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
