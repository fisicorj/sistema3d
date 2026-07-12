from __future__ import annotations
import json, re, threading, time, urllib.error, urllib.request
from pathlib import Path
from urllib.parse import parse_qs, quote_plus
from server_core.config_store import load_json

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "app_data"
ML_CONFIG_FILE = DATA_DIR / "ml_config.json"
_ml_token = ""
_ml_token_expiry = 0.0
_ml_token_lock = threading.Lock()

_trending_cache = {}
_trending_lock = threading.Lock()
TRENDING_TTL = 3600

def _ml_post_token(body_str: str) -> dict:
    """Faz POST em /oauth/token e retorna o JSON de resposta."""
    req = urllib.request.Request(
        "https://api.mercadolibre.com/oauth/token",
        data=body_str.encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            payload = json.loads(r.read().decode("utf-8"))
            if not isinstance(payload, dict) or not payload.get("access_token"):
                detail = payload.get("message") or payload.get("error_description") or payload.get("error") or "Resposta OAuth sem access_token" if isinstance(payload, dict) else "Resposta OAuth inválida"
                raise ValueError("OAuth ML: {}".format(detail))
            return payload
    except urllib.error.HTTPError as e:
        raise ValueError("OAuth ML HTTP {}: {}".format(e.code, e.read().decode("utf-8", errors="replace")[:300]))

def _get_ml_token() -> str:
    """Retorna access_token válido. Prioridade: user token > refresh > erro."""
    global _ml_token, _ml_token_expiry

    with _ml_token_lock:
        if _ml_token and time.time() < _ml_token_expiry - 120:
            return _ml_token

    if not ML_CONFIG_FILE.exists():
        raise ValueError("needs_auth")
    cfg = load_json(ML_CONFIG_FILE)
    app_id = cfg.get("app_id", "").strip()
    secret = cfg.get("secret", "").strip()
    if not app_id or not secret:
        raise ValueError("needs_auth")

    # 1. Token de usuário salvo ainda válido
    stored  = cfg.get("access_token", "")
    expiry  = float(cfg.get("token_expiry", 0))
    if stored and time.time() < expiry - 120:
        with _ml_token_lock:
            _ml_token, _ml_token_expiry = stored, expiry
        return stored

    # 2. Refresh token disponível
    refresh = cfg.get("refresh_token", "")
    if refresh:
        try:
            resp = _ml_post_token(
                "grant_type=refresh_token&client_id={}&client_secret={}&refresh_token={}".format(
                    quote_plus(app_id), quote_plus(secret), quote_plus(refresh)
                )
            )
            new_token  = resp["access_token"]
            new_expiry = time.time() + resp.get("expires_in", 21600)
            cfg["access_token"]  = new_token
            cfg["refresh_token"] = resp.get("refresh_token", refresh)
            cfg["token_expiry"]  = new_expiry
            DATA_DIR.mkdir(exist_ok=True)
            ML_CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            with _ml_token_lock:
                _ml_token, _ml_token_expiry = new_token, new_expiry
            return new_token
        except Exception:
            pass  # cai no erro abaixo

    raise ValueError("needs_auth")

def _parse_ml_products(html: str) -> list:
    """Extrai produtos do HTML da página de busca do Mercado Livre."""
    import re
    items    = []
    seen_ids = set()

    # Busca em todos os blocos <script> por objetos JSON com "id":"MLB..."
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE)

    for script in scripts:
        if 'MLB' not in script:
            continue

        for m in re.finditer(r'"id"\s*:\s*"(MLB\d+)"', script):
            ml_id = m.group(1)
            if ml_id in seen_ids:
                continue

            # Acha a abertura do objeto JSON que contém este campo
            brace_start = -1
            for i in range(m.start() - 1, max(m.start() - 600, -1), -1):
                if script[i] == '{':
                    brace_start = i
                    break
            if brace_start == -1:
                continue

            # Percorre para achar o fechamento correspondente
            depth, brace_end = 0, -1
            for i in range(brace_start, min(brace_start + 10000, len(script))):
                c = script[i]
                if c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        brace_end = i + 1
                        break
            if brace_end == -1:
                continue

            try:
                obj = json.loads(script[brace_start:brace_end])
            except (json.JSONDecodeError, ValueError):
                continue

            if not obj.get('title') or not str(obj.get('id', '')).startswith('MLB'):
                continue

            obj_id = obj['id']
            if obj_id in seen_ids:
                continue
            seen_ids.add(obj_id)

            price    = float(obj.get('price') or 0)
            orig     = obj.get('original_price')
            orig     = float(orig) if orig and float(orig) > price else None
            discount = round((1 - price / orig) * 100) if orig else 0
            sold     = int(obj.get('sold_quantity') or 0)
            thumb    = (obj.get('thumbnail') or '').replace('http://', 'https://')
            thumb    = thumb.replace('-I.jpg', '-O.jpg').replace('-I.webp', '-O.webp')
            sold_label = ('+{}k'.format(sold // 1000) if sold >= 1000 else str(sold)) if sold else ''
            shipping   = obj.get('shipping') or {}

            material = ''
            for attr in (obj.get('attributes') or []):
                if attr.get('id') in ('MATERIAL', 'LINE', 'MAIN_MATERIAL'):
                    material = attr.get('value_name') or ''
                    break

            items.append({
                'id':           obj_id,
                'title':        obj['title'],
                'price':        price,
                'original':     orig,
                'discount':     discount,
                'sold':         sold,
                'sold_label':   sold_label,
                'thumbnail':    thumb,
                'url':          obj.get('permalink', ''),
                'free_shipping': bool(shipping.get('free_shipping')),
                'material':     material,
                'trending':     sold >= 100,
            })
            if len(items) >= 24:
                break

        if items:
            break

    # Fallback: extrai links, imagens e alt-texts direto do HTML
    if not items:
        imgs = re.findall(r'https://http2\.mlstatic\.com/D_[^"\'<>\s]+\.(?:jpg|webp|png)', html)
        imgs = list(dict.fromkeys(imgs))  # deduplica mantendo ordem

        urls, seen_u = [], set()
        for u in re.findall(r'href="(https://(?:produto|www)\.mercadolivre\.com\.br/[^"?#]{20,})"', html):
            if 'MLB' in u and u not in seen_u:
                seen_u.add(u); urls.append(u)

        alts = [a for a in re.findall(r'alt="([^"]{15,120})"', html)
                if not any(kw in a.lower() for kw in ['mercado livre', 'logo', 'banner'])]

        for i, url in enumerate(urls[:24]):
            items.append({
                'id': '', 'title': alts[i] if i < len(alts) else '',
                'price': 0, 'original': None, 'discount': 0,
                'sold': 0, 'sold_label': '',
                'thumbnail': imgs[i] if i < len(imgs) else '',
                'url': url, 'free_shipping': False, 'material': '', 'trending': False,
            })

    return items


class MercadoLivreMixin:
    def _send_ml_config(self) -> None:
        if not ML_CONFIG_FILE.exists():
            self._send_json({"ok": True, "app_id": "", "has_secret": False, "connected": False})
            return
        cfg = load_json(ML_CONFIG_FILE)
        stored  = cfg.get("access_token", "")
        expiry  = float(cfg.get("token_expiry", 0))
        connected = bool(stored) and time.time() < expiry - 60
        self._send_json({
            "ok":          True,
            "app_id":      cfg.get("app_id", ""),
            "has_secret":  bool(cfg.get("secret")),
            "base_url":    cfg.get("base_url", ""),
            "connected":   connected,
            "has_refresh": bool(cfg.get("refresh_token")),
            "user_id":     cfg.get("user_id", ""),
        })

    def _save_ml_config(self) -> None:
        global _ml_token, _ml_token_expiry
        try:
            data = self._read_json_body()
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 400)
            return

        # Desconectar
        if data.get("disconnect"):
            if ML_CONFIG_FILE.exists():
                cfg = load_json(ML_CONFIG_FILE)
                cfg.pop("access_token",  None)
                cfg.pop("refresh_token", None)
                cfg.pop("token_expiry",  None)
                cfg.pop("user_id",       None)
                ML_CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            with _ml_token_lock:
                _ml_token, _ml_token_expiry = "", 0.0
            self._send_json({"ok": True})
            return

        app_id   = str(data.get("app_id",   "")).strip()
        secret   = str(data.get("secret",   "")).strip()
        base_url = str(data.get("base_url", "")).strip()

        cfg: dict = {}
        if ML_CONFIG_FILE.exists():
            try:
                cfg = load_json(ML_CONFIG_FILE)
            except Exception:
                pass

        old_app_id = str(cfg.get("app_id", ""))
        old_secret = str(cfg.get("secret", ""))
        old_base_url = str(cfg.get("base_url", ""))
        credentials_changed = (
            (bool(app_id) and app_id != old_app_id) or
            (secret not in ("", "********") and secret != old_secret) or
            (bool(base_url) and base_url != old_base_url)
        )

        if app_id:
            cfg["app_id"] = app_id
        if secret not in ("", "********"):
            cfg["secret"] = secret
        if base_url:
            cfg["base_url"] = base_url

        # Só invalida tokens quando App ID, secret ou URL de callback realmente mudarem.
        if credentials_changed:
            cfg.pop("access_token",  None)
            cfg.pop("refresh_token", None)
            cfg.pop("token_expiry",  None)
            cfg.pop("user_id",       None)
            with _ml_token_lock:
                _ml_token, _ml_token_expiry = "", 0.0

        DATA_DIR.mkdir(exist_ok=True)
        ML_CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
        self._send_json({"ok": True, "message": "Salvo. Use 'Conectar com ML' para autorizar."})

    def _send_ml_oauth_start(self) -> None:
        try:
            cfg = load_json(ML_CONFIG_FILE) if ML_CONFIG_FILE.exists() else {}
            app_id = cfg.get("app_id", "").strip()
            if not app_id:
                self._send_json({"ok": False, "error": "Configure o App ID em Configurações primeiro."}, 400)
                return
            base_url = (cfg.get("base_url", "") or "http://localhost:8000").rstrip("/")
            redirect_uri = base_url + "/api/ml-oauth-callback"
            auth_url = (
                "https://auth.mercadolivre.com.br/authorization"
                "?response_type=code&client_id={}&redirect_uri={}"
            ).format(quote_plus(app_id), quote_plus(redirect_uri))
            self._send_json({"ok": True, "url": auth_url, "redirect_uri": redirect_uri})
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 500)

    def _handle_ml_oauth_callback(self, query_string: str) -> None:
        global _ml_token, _ml_token_expiry
        params = parse_qs(query_string)
        code   = (params.get("code",  [""])[0])
        error  = (params.get("error", [""])[0])

        def _page(title: str, body_html: str, status: int = 200) -> None:
            html = (
                "<!DOCTYPE html><html><head><meta charset='utf-8'><title>{t}</title>"
                "<style>body{{font-family:sans-serif;text-align:center;padding:60px;"
                "background:#0f172a;color:#e2e8f0}}</style></head>"
                "<body><h2>{t}</h2>{b}</body></html>"
            ).format(t=title, b=body_html)
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))

        if error:
            _page("❌ Autorização cancelada", "<p>{}</p>".format(error), 400)
            return
        if not code:
            _page("❌ Código ausente", "<p>Parâmetro 'code' não recebido.</p>", 400)
            return

        try:
            cfg      = load_json(ML_CONFIG_FILE) if ML_CONFIG_FILE.exists() else {}
            app_id   = cfg.get("app_id", "").strip()
            secret   = cfg.get("secret", "").strip()
            base_url = (cfg.get("base_url", "") or "http://localhost:8000").rstrip("/")
            redirect_uri = base_url + "/api/ml-oauth-callback"

            resp = _ml_post_token(
                "grant_type=authorization_code&client_id={}&client_secret={}"
                "&code={}&redirect_uri={}".format(
                    quote_plus(app_id), quote_plus(secret),
                    quote_plus(code), quote_plus(redirect_uri)
                )
            )
            cfg["access_token"]  = resp["access_token"]
            cfg["refresh_token"] = resp.get("refresh_token", "")
            cfg["token_expiry"]  = time.time() + resp.get("expires_in", 21600)
            cfg["user_id"]       = str(resp.get("user_id", ""))
            DATA_DIR.mkdir(exist_ok=True)
            ML_CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            with _ml_token_lock:
                _ml_token        = cfg["access_token"]
                _ml_token_expiry = cfg["token_expiry"]
            with _trending_lock:
                _trending_cache.clear()

            _page(
                "✅ Conectado!",
                "<p>Token obtido com sucesso. Pode fechar esta janela.</p>"
                "<script>setTimeout(function(){{window.close();}},2500);</script>",
            )
        except Exception as exc:
            _page("❌ Erro", "<p>{}</p>".format(str(exc)), 500)

    def _send_market_search(self, query: str, sort: str = "sold_quantity") -> None:
        allowed_sorts = {"sold_quantity", "relevance", "price_asc", "price_desc"}
        if sort not in allowed_sorts:
            sort = "sold_quantity"

        cache_key = f"ml:{query}:{sort}"
        with _trending_lock:
            cached = _trending_cache.get(cache_key)
            if cached and time.time() - cached["ts"] < TRENDING_TTL:
                self._send_json(cached["data"])
                return

        # A busca pública do site MLB normalmente funciona sem OAuth.
        # Se o usuário conectou a conta, enviamos o token; se não conectou,
        # mantemos a tela de Insights utilizável do mesmo jeito.
        token = ""
        auth_error = ""
        try:
            token = _get_ml_token()
        except ValueError as ve:
            auth_error = str(ve)

        try:
            url = (
                "https://api.mercadolibre.com/sites/MLB/search"
                "?q={}&sort={}&limit=24".format(quote_plus(query), sort)
            )
            req = urllib.request.Request(url)
            if token:
                req.add_header("Authorization",  "Bearer " + token)
            req.add_header("User-Agent",     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0")
            req.add_header("Accept",         "application/json")
            req.add_header("Accept-Language","pt-BR,pt;q=0.9")
            with urllib.request.urlopen(req, timeout=15) as r:
                raw = json.loads(r.read().decode("utf-8"))

            total = raw.get("paging", {}).get("total", 0)
            items = []
            for p in raw.get("results", []):
                price    = p.get("price") or 0
                orig     = p.get("original_price") or None
                discount = round((1 - price / orig) * 100) if orig and orig > price else 0
                sold     = p.get("sold_quantity") or 0
                thumb    = (p.get("thumbnail") or "").replace("http://", "https://")
                thumb    = thumb.replace("-I.jpg", "-O.jpg").replace("-I.webp", "-O.webp")
                sold_label = ("+{}k".format(int(sold / 1000)) if sold >= 1000 else str(sold)) if sold else ""
                material = ""
                for attr in (p.get("attributes") or []):
                    if attr.get("id") in ("MATERIAL", "LINE", "MAIN_MATERIAL"):
                        material = attr.get("value_name") or ""
                        break
                items.append({
                    "id":           p.get("id"),
                    "title":        p.get("title"),
                    "price":        price,
                    "original":     orig,
                    "discount":     discount,
                    "sold":         sold,
                    "sold_label":   sold_label,
                    "thumbnail":    thumb,
                    "url":          p.get("permalink"),
                    "free_shipping": (p.get("shipping") or {}).get("free_shipping", False),
                    "material":     material,
                    "trending":     sold >= 100,
                })

            data = {"ok": True, "items": items, "total": total, "query": query, "cached_at": int(time.time()), "authenticated": bool(token)}
            with _trending_lock:
                _trending_cache[cache_key] = {"ts": time.time(), "data": data}
            self._send_json(data)

        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")

            # Em algumas redes/contas a API pública do Mercado Livre devolve 403
            # quando não há OAuth. Nesse cenário tentamos a página pública de
            # busca e extraímos os cards. A tela continua útil, sem erro 502 no
            # console, embora vendas/preços possam vir incompletos.
            if e.code in (401, 403) and not token:
                try:
                    sort_map = {
                        "sold_quantity": "sold_quantity_desc",
                        "relevance": "relevance",
                        "price_asc": "price_asc",
                        "price_desc": "price_desc",
                    }
                    html_url = "https://lista.mercadolivre.com.br/{}#D[A:{}]".format(
                        url_quote(query.replace(" ", "-")), url_quote(query)
                    )
                    req = urllib.request.Request(html_url)
                    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0")
                    req.add_header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    req.add_header("Accept-Language", "pt-BR,pt;q=0.9")
                    with urllib.request.urlopen(req, timeout=15) as r:
                        html = r.read().decode("utf-8", errors="replace")
                    items = _parse_ml_products(html)
                    data = {
                        "ok": True,
                        "items": items,
                        "total": len(items),
                        "query": query,
                        "cached_at": int(time.time()),
                        "authenticated": False,
                        "fallback": "html",
                        "warning": "API pública do Mercado Livre bloqueou a consulta sem OAuth. Exibindo dados extraídos da página pública; conecte o Mercado Livre nas Configurações para resultados completos.",
                    }
                    with _trending_lock:
                        _trending_cache[cache_key] = {"ts": time.time(), "data": data}
                    self._send_json(data)
                    return
                except Exception as fallback_exc:
                    extra = " (consulta pública sem OAuth" + (": " + auth_error if auth_error and "needs_auth" not in auth_error else "") + ")"
                    self._send_json({
                        "ok": False,
                        "error": "Mercado Livre bloqueou a consulta sem OAuth ({}). Conecte sua conta em Configurações > Mercado Livre. Fallback HTML também falhou: {}".format(e.code, str(fallback_exc)[:180]),
                        "items": [],
                    }, 200)
                    return

            extra = "" if token else " (consulta pública sem OAuth" + (": " + auth_error if auth_error and "needs_auth" not in auth_error else "") + ")"
            self._send_json({"ok": False, "error": "ML API {}{}: {}".format(e.code, extra, body[:300]), "items": []}, 200)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc), "items": []}, 200)

