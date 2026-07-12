from __future__ import annotations
import json, ssl, threading, time
from pathlib import Path

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    mqtt = None
    MQTT_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "app_data"
BAMBU_PRINTERS_FILE = DATA_DIR / "bambu_printers.json"


def _bambu_identity(ip: str, serial: str) -> str:
    """Identidade estável: serial primeiro; IP apenas como fallback."""
    normalized_serial = str(serial or "").strip().upper()
    if normalized_serial:
        return f"serial:{normalized_serial}"
    normalized_ip = str(ip or "").strip().lower()
    return f"ip:{normalized_ip}" if normalized_ip else ""


class _BambuConnection:
    """
    Mantém uma conexão MQTT TLS com uma impressora Bambu Lab na rede local.
    Broker em <ip>:8883, user: bblp, password: <access_code>.
    Tópico: device/<serial>/report
    """

    MQTT_PORT       = 8883
    MQTT_USER       = "bblp"
    RECONNECT_DELAY = 15

    def __init__(self, printer_id: int, ip: str, serial: str, access_code: str):
        self.printer_id   = printer_id
        self._lock        = threading.Lock()
        self._status: dict = {}
        self._connected   = False
        self._error       = ""
        self._client      = None
        self._thread      = None
        self._stop_evt    = threading.Event()
        self._last_pushall = 0.0

        self._ip          = ip
        self._serial      = serial
        self._access_code = access_code

        if ip and serial and access_code:
            self._start()

    def _start(self):
        if not MQTT_AVAILABLE:
            self._error = "paho-mqtt não instalado — execute: pip install paho-mqtt"
            return
        self._stop_evt.clear()
        self._thread = threading.Thread(
            target=self._run_loop, daemon=True,
            name=f"BambuMQTT-{self.printer_id}"
        )
        self._thread.start()

    def stop(self):
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
        try:
            client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION1,
                client_id=f"sistema3d-{self.printer_id}",
                protocol=mqtt.MQTTv311,
            )
        except AttributeError:
            client = mqtt.Client(
                client_id=f"sistema3d-{self.printer_id}",
                protocol=mqtt.MQTTv311,
            )

        client.username_pw_set(self.MQTT_USER, self._access_code)

        tls_ctx = ssl.create_default_context()
        tls_ctx.check_hostname = False
        tls_ctx.verify_mode = ssl.CERT_NONE
        client.tls_set_context(tls_ctx)

        client.on_connect    = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message    = self._on_message

        with self._lock:
            self._error = ""

        client.connect(self._ip, self.MQTT_PORT, keepalive=60)
        self._client = client
        client.loop_forever()

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            client.subscribe(f"device/{self._serial}/report", qos=0)
            # Solicita estado completo imediatamente — sem isso a impressora só envia mudanças incrementais
            client.publish(
                f"device/{self._serial}/request",
                json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}}),
                qos=0,
            )
            with self._lock:
                self._connected = True
                self._error = ""
            print(f"[Bambu] Impressora {self.printer_id} conectada: {self._ip} serial={self._serial}")
        else:
            with self._lock:
                self._connected = False
                self._error = f"MQTT rc={rc}"

    def _on_disconnect(self, client, userdata, rc):
        with self._lock:
            self._connected = False
        if rc != 0:
            print(f"[Bambu] Impressora {self.printer_id} desconectada (rc={rc}), tentando em {self.RECONNECT_DELAY}s...")

    def _on_message(self, client, userdata, msg):
        try:
            payload    = json.loads(msg.payload.decode("utf-8"))
            print_data = payload.get("print", {})
            if not print_data:
                return
            # Merge: atualiza apenas os campos presentes na mensagem,
            # preservando o restante do estado já recebido
            _map = [
                ("gcode_state",      "gcode_state"),
                ("mc_percent",       "mc_percent"),
                ("mc_remaining_min", "mc_remaining_time"),
                ("layer_num",        "layer_num"),
                ("total_layer_num",  "total_layer_num"),
                ("nozzle_temp",      "nozzle_temper"),
                ("bed_temp",         "bed_temper"),
                ("fan_gear",         "fan_gear"),
                ("spd_lvl",          "spd_lvl"),
                ("subtask_name",     "subtask_name"),
                ("gcode_file",       "gcode_file"),
                ("stage",            "stg_cur"),
            ]
            with self._lock:
                self._status["connected"] = True
                self._status["ts"]        = time.time()
                for our_key, bambu_key in _map:
                    val = print_data.get(bambu_key)
                    if val is not None:
                        self._status[our_key] = val
        except Exception:
            pass

    def request_full_status(self) -> None:
        client = self._client
        if not client or not self._connected:
            return
        now = time.time()
        if now - self._last_pushall < 12:
            return
        self._last_pushall = now
        try:
            client.publish(
                f"device/{self._serial}/request",
                json.dumps({"pushing": {"sequence_id": str(int(now)), "command": "pushall"}}),
                qos=0,
            )
        except Exception:
            pass

    def get_status(self) -> dict:
        self.request_full_status()
        with self._lock:
            base = {
                "configured": True,
                "connected":  self._connected,
                "ip":         self._ip,
                "serial":     self._serial,
                "error":      self._error,
                "printer_id": self.printer_id,
            }
            base.update(self._status)
            state = str(base.get("gcode_state") or "").strip().upper()
            aliases = {"PRINTING":"RUNNING", "PRINT":"RUNNING", "PAUSED":"PAUSE", "PREPARING":"PREPARE", "COMPLETED":"FINISH", "FINISHED":"FINISH"}
            state = aliases.get(state, state)
            pct = float(base.get("mc_percent") or 0)
            remaining = float(base.get("mc_remaining_min") or 0)
            base["busy"] = bool(base.get("connected") and (state in {"RUNNING","PAUSE","PREPARE"} or (remaining > 0 and 0 <= pct < 100)))
            base["last_report_age"] = max(0, time.time() - float(base.get("ts") or 0)) if base.get("ts") else None
            return base


class BambuMultiMonitor:
    """
    Gerencia múltiplas conexões MQTT Bambu Lab, uma por impressora.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._connections: dict[int, _BambuConnection] = {}
        self._load_saved_config()

    def _load_saved_config(self):
        """Carrega o JSON legado, removendo duplicidades por serial/IP."""
        if not BAMBU_PRINTERS_FILE.exists():
            return
        try:
            raw = json.loads(BAMBU_PRINTERS_FILE.read_text(encoding="utf-8"))
            clean: dict[str, dict] = {}
            seen: set[str] = set()
            # Menor ID vence para preservar o cadastro original.
            ordered = sorted((raw or {}).items(), key=lambda item: int(item[0]) if str(item[0]).isdigit() else 10**12)
            for pid_str, cfg in ordered:
                try:
                    pid = int(pid_str)
                except (TypeError, ValueError):
                    continue
                ip = str(cfg.get("ip", "")).strip()
                sn = str(cfg.get("serial", "")).strip()
                code = str(cfg.get("access_code", "")).strip()
                identity = _bambu_identity(ip, sn)
                if not identity or identity in seen:
                    if identity:
                        print(f"[Bambu] Configuração duplicada ignorada no JSON: impressora {pid} ({identity})")
                    continue
                seen.add(identity)
                if ip and sn and code:
                    clean[str(pid)] = {"ip": ip, "serial": sn, "access_code": code}
                    self._connections[pid] = _BambuConnection(pid, ip, sn, code)
            # Reescreve o arquivo uma única vez já normalizado.
            if clean != raw:
                DATA_DIR.mkdir(exist_ok=True)
                BAMBU_PRINTERS_FILE.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"[Bambu] JSON normalizado: {len(clean)} configuração(ões) única(s)")
        except Exception as exc:
            print(f"[Bambu] Erro ao carregar configurações: {exc}")

    def _save_config(self):
        DATA_DIR.mkdir(exist_ok=True)
        data: dict[str, dict] = {}
        seen: set[str] = set()
        with self._lock:
            items = sorted(self._connections.items(), key=lambda item: item[0])
            for pid, conn in items:
                identity = _bambu_identity(conn._ip, conn._serial)
                if not identity or identity in seen:
                    continue
                seen.add(identity)
                data[str(pid)] = {
                    "ip": conn._ip,
                    "serial": conn._serial,
                    "access_code": conn._access_code,
                }
        BAMBU_PRINTERS_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def update_printer(self, printer_id: int, ip: str, serial: str, access_code: str):
        """Adiciona/atualiza uma impressora e remove conexões duplicadas."""
        identity = _bambu_identity(ip, serial)
        to_stop: list[_BambuConnection] = []
        with self._lock:
            # O serial é único. Ao mover a configuração para outro cadastro,
            # a conexão anterior é removida automaticamente.
            for other_id, other in list(self._connections.items()):
                if other_id == printer_id:
                    continue
                if identity and _bambu_identity(other._ip, other._serial) == identity:
                    to_stop.append(other)
                    del self._connections[other_id]
                    print(f"[Bambu] Duplicidade removida: impressora {other_id} substituída pela {printer_id} ({identity})")

            existing = self._connections.get(printer_id)
            if existing:
                needs_restart = (
                    ip != existing._ip
                    or serial != existing._serial
                    or access_code != existing._access_code
                )
                if needs_restart:
                    to_stop.append(existing)
                    del self._connections[printer_id]
                else:
                    # Ainda salva para limpar eventual duplicidade do JSON.
                    pass
            if ip and serial and access_code and printer_id not in self._connections:
                self._connections[printer_id] = _BambuConnection(printer_id, ip, serial, access_code)

        for conn in to_stop:
            conn.stop()
        self._save_config()

    def remove_printer(self, printer_id: int):
        """Para e remove a conexão MQTT de uma impressora."""
        with self._lock:
            conn = self._connections.pop(printer_id, None)
        if conn:
            conn.stop()
        self._save_config()

    def ensure_from_configs(self, configs: dict) -> None:
        seen: set[str] = set()
        ordered = sorted((configs or {}).items(), key=lambda item: int(item[0]) if str(item[0]).isdigit() else 10**12)
        for pid_str, cfg in ordered:
            try:
                pid = int(cfg.get("printer_id", pid_str))
            except Exception:
                continue
            ip = str(cfg.get("ip") or "").strip()
            serial = str(cfg.get("serial") or "").strip()
            code = str(cfg.get("access_code") or "").strip()
            identity = _bambu_identity(ip, serial)
            if not identity or identity in seen:
                continue
            seen.add(identity)
            if ip and serial and code:
                self.update_printer(pid, ip, serial, code)

    def get_configs(self, include_secret: bool = False) -> dict:
        result = {}
        with self._lock:
            conns = dict(self._connections)
        for pid, conn in conns.items():
            result[str(pid)] = {
                "printer_id": pid, "ip": conn._ip, "serial": conn._serial,
                "has_code": bool(conn._access_code),
                "configured": bool(conn._ip and conn._serial and conn._access_code),
            }
            if include_secret:
                result[str(pid)]["access_code"] = conn._access_code
        return result

    def get_all_statuses(self) -> dict:
        """Retorna dict de {printer_id: status} para todas as impressoras configuradas."""
        result = {}
        with self._lock:
            conns = dict(self._connections)
        for pid, conn in conns.items():
            result[str(pid)] = conn.get_status()
        return result

    def get_status(self, printer_id: int) -> dict:
        """Retorna status de uma impressora específica."""
        with self._lock:
            conn = self._connections.get(printer_id)
        if not conn:
            return {"configured": False, "connected": False, "printer_id": printer_id,
                    "error": "Impressora não configurada no monitor Bambu"}
        return conn.get_status()


_bambu = None  # set by server.py after BambuMultiMonitor() is created
_database_backend = None  # set by server.py; fonte primária da configuração Bambu


class BambuMixin:
    def _save_bambu_config(self) -> None:
        try:
            payload     = self._read_json_body()
            printer_id  = int(payload.get("printer_id", 0))
            ip          = str(payload.get("ip", "")).strip()[:80]
            serial      = str(payload.get("serial", "")).strip()[:120]
            access_code = str(payload.get("access_code", "")).strip()[:120] if "access_code" in payload else None

            if not ip or not serial:
                self._send_json({"ok": False, "error": "Informe IP e serial."}, 200)
                return
            if not printer_id:
                self._send_json({"ok": False, "error": "printer_id é obrigatório."}, 200)
                return

            # Persiste primeiro no banco relacional ativo. Se o access code não veio,
            # o serviço mantém o segredo já existente na tabela printers.
            saved = None
            if _database_backend:
                saved = _database_backend.save_bambu_config(printer_id, ip, serial, access_code)
                secret_cfg = _database_backend.get_bambu_configs(include_secret=True).get(str(printer_id), {})
                access_code = secret_cfg.get("access_code") or access_code
            elif _bambu and access_code is None and printer_id in _bambu._connections:
                access_code = _bambu._connections[printer_id]._access_code

            if not access_code:
                self._send_json({"ok": False, "error": "Access code é obrigatório na primeira configuração."}, 200)
                return
            if _bambu:
                _bambu.update_printer(printer_id, ip, serial, access_code)
            self._send_json(saved or {"ok": True, "printer_id": printer_id, "ip": ip, "serial": serial, "has_code": True, "configured": True})
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 200)
