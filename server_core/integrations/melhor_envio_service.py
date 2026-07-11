from __future__ import annotations
import json, re, urllib.error, urllib.request
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "app_data"
ME_CONFIG_FILE = DATA_DIR / "melhor_envio_config.json"

class MelhorEnvioMixin:
    def _send_melhor_envio_config(self) -> None:
        """Retorna a configuração do Melhor Envio sem expor o token."""
        default = {
            "ok": True,
            "enabled": False,
            "environment": "production",
            "origin_cep": "",
            "services": "",
            "user_agent": "",
            "has_token": False,
        }
        try:
            if ME_CONFIG_FILE.exists():
                cfg = json.loads(ME_CONFIG_FILE.read_text(encoding="utf-8") or "{}")
                default.update({
                    "enabled": bool(cfg.get("enabled", False)),
                    "environment": cfg.get("environment") or "production",
                    "origin_cep": cfg.get("origin_cep") or "",
                    "services": cfg.get("services") or "",
                    "user_agent": cfg.get("user_agent") or "",
                    "has_token": bool(cfg.get("access_token")),
                })
            self._send_json(default)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 200)

    def _save_melhor_envio_config(self) -> None:
        """Salva a configuração do Melhor Envio preservando o token existente se o campo vier vazio."""
        try:
            payload = self._read_json_body()
            old = {}
            if ME_CONFIG_FILE.exists():
                try:
                    old = json.loads(ME_CONFIG_FILE.read_text(encoding="utf-8") or "{}")
                except Exception:
                    old = {}

            token = (payload.get("access_token") or "").strip()
            if not token:
                token = old.get("access_token", "")

            cfg = {
                "enabled": bool(payload.get("enabled", False)),
                "environment": payload.get("environment") if payload.get("environment") in ("sandbox", "production") else "production",
                "origin_cep": re.sub(r"\D+", "", payload.get("origin_cep", ""))[:8],
                "services": str(payload.get("services", ""))[:120],
                "user_agent": str(payload.get("user_agent", ""))[:180],
                "access_token": token,
                "updated_at": datetime.now().isoformat(timespec="seconds"),
            }
            DATA_DIR.mkdir(exist_ok=True)
            ME_CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
            self._send_json({"ok": True, "has_token": bool(token)})
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 200)

    def _calculate_melhor_envio(self) -> None:
        """Consulta frete no Melhor Envio. Se não estiver configurado, responde JSON tratado."""
        try:
            payload = self._read_json_body()
            if not ME_CONFIG_FILE.exists():
                self._send_json({"ok": False, "error": "Melhor Envio não configurado."}, 200)
                return
            cfg = json.loads(ME_CONFIG_FILE.read_text(encoding="utf-8") or "{}")
            if not cfg.get("enabled"):
                self._send_json({"ok": False, "error": "Integração Melhor Envio desativada."}, 200)
                return
            token = cfg.get("access_token") or ""
            if not token:
                self._send_json({"ok": False, "error": "Token do Melhor Envio não configurado."}, 200)
                return

            from_cep = re.sub(r"\D+", "", cfg.get("origin_cep", ""))[:8]
            to_cep = re.sub(r"\D+", "", payload.get("to_cep", ""))[:8]
            if len(from_cep) != 8 or len(to_cep) != 8:
                self._send_json({"ok": False, "error": "CEP de origem ou destino inválido."}, 200)
                return

            def num(name, default):
                try:
                    return max(0.01, float(payload.get(name, default) or default))
                except Exception:
                    return default

            body = {
                "from": {"postal_code": from_cep},
                "to": {"postal_code": to_cep},
                "package": {
                    "height": num("height_cm", 5),
                    "width": num("width_cm", 10),
                    "length": num("length_cm", 15),
                    "weight": num("weight_kg", 0.1),
                },
                "options": {
                    "insurance_value": num("insurance_value", 1),
                    "receipt": False,
                    "own_hand": False,
                },
            }
            services = (cfg.get("services") or "").strip()
            if services:
                body["services"] = services

            base = "https://sandbox.melhorenvio.com.br" if cfg.get("environment") == "sandbox" else "https://www.melhorenvio.com.br"
            req = urllib.request.Request(
                base + "/api/v2/me/shipment/calculate",
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token,
                    "User-Agent": cfg.get("user_agent") or "Sistema3D Local",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    data = json.loads(r.read().decode("utf-8") or "[]")
                self._send_json({"ok": True, "quotes": data})
            except urllib.error.HTTPError as e:
                details = e.read().decode("utf-8", errors="replace")[:800]
                self._send_json({"ok": False, "error": f"Melhor Envio HTTP {e.code}", "details": details}, 200)
            except Exception as exc:
                self._send_json({"ok": False, "error": "Falha ao consultar Melhor Envio", "details": str(exc)}, 200)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 200)

