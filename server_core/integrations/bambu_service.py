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
BAMBU_CFG_FILE = DATA_DIR / "bambu_config.json"

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
            print("[Bambu] Conectado: {} serial={}".format(self._ip, self._serial))
        else:
            with self._lock:
                self._connected = False
                self._error     = f"MQTT rc={rc}"

    def _on_disconnect(self, client, userdata, rc):
        with self._lock:
            self._connected = False
        if rc != 0:
            print("[Bambu] Desconectado (rc={}), tentando em {}s...".format(rc, self.RECONNECT_DELAY))

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


class BambuMixin:
    def _save_bambu_config(self) -> None:
        try:
            payload = self._read_json_body()
            ip = str(payload.get("ip", "")).strip()[:80]
            serial = str(payload.get("serial", "")).strip()[:120]
            access_code = str(payload.get("access_code", "")).strip()[:120]
            if not ip or not serial or not access_code:
                self._send_json({"ok": False, "error": "Informe IP, serial e access code."}, 200)
                return
            if _bambu:
                _bambu.save_config(ip, serial, access_code)
            else:
                DATA_DIR.mkdir(exist_ok=True)
                BAMBU_CFG_FILE.write_text(
                    json.dumps({"ip": ip, "serial": serial, "access_code": access_code}, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            self._send_json({"ok": True})
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 200)

