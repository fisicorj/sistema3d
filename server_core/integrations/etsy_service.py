from __future__ import annotations
import json, os, re, threading, time, urllib.error, urllib.request
from datetime import datetime
from pathlib import Path
from urllib.parse import quote_plus
from server_core.config_store import load_json, save_json

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "app_data"
ETSY_CONFIG_FILE = DATA_DIR / "etsy_config.json"

_trending_cache = {}
_trending_lock = threading.Lock()
TRENDING_TTL = 3600

def _clean_text(value: str) -> str:
    """Remove escapes/HTML e normaliza espaços para textos extraídos de páginas públicas."""
    if value is None:
        return ""
    value = html_lib.unescape(str(value))
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\\u002F", "/", value)
    value = re.sub(r"\\/", "/", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value

def _parse_etsy_products(html: str, query: str = "") -> list:
    """Extrai anúncios básicos do HTML público do Etsy.

    A página pública muda com frequência e pode vir limitada por região/anti-bot.
    Por isso o parser é defensivo: se não encontrar cards completos, retorna lista
    vazia sem estourar exceção. O endpoint que chama este parser continua respondendo
    JSON para a interface não quebrar.
    """
    items = []
    seen = set()

    # 1) Tenta extrair blocos de listing a partir de URLs canônicas.
    listing_re = re.compile(
        r'https://www\.etsy\.com/(?:[a-z]{2}/)?listing/(\d+)/([^"\\?<\s]+)',
        re.IGNORECASE,
    )
    matches = list(listing_re.finditer(html))
    for idx, m in enumerate(matches):
        listing_id = m.group(1)
        if listing_id in seen:
            continue
        seen.add(listing_id)
        start = max(0, m.start() - 2500)
        end = min(len(html), m.end() + 5000)
        block = html[start:end]

        slug = _clean_text(m.group(2).replace('-', ' '))
        title = slug

        # Títulos aparecem de formas diferentes no HTML/JSON embutido.
        title_patterns = [
            r'"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"',
            r'"listing_title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"',
            r'alt="([^"]{10,180})"',
            r'aria-label="([^"]{10,180})"',
        ]
        for pat in title_patterns:
            mt = re.search(pat, block, re.IGNORECASE | re.DOTALL)
            if mt:
                cand = _clean_text(mt.group(1))
                if cand and not cand.lower().startswith(('etsy', 'image')):
                    title = cand
                    break

        # Imagem principal.
        img = ""
        mi = re.search(r'https://i\.etsystatic\.com/[^"\\<\s]+?\.(?:jpg|jpeg|png|webp)', block, re.IGNORECASE)
        if mi:
            img = mi.group(0).replace('\\/', '/')

        # Preço. Etsy pode retornar valores em USD, BRL ou em JSON com amount/divisor.
        price = 0.0
        currency = ""
        price_text = ""
        mp = re.search(r'(?:R\$|US\$|\$|€|£)\s*([0-9][0-9\.,]*)', block)
        if mp:
            price_text = mp.group(0)
            currency = 'BRL' if 'R$' in price_text else ('USD' if '$' in price_text or 'US$' in price_text else '')
            num = mp.group(1).replace('.', '').replace(',', '.') if ',' in mp.group(1) else mp.group(1).replace(',', '')
            try:
                price = float(num)
            except ValueError:
                price = 0.0
        else:
            ma = re.search(r'"amount"\s*:\s*(\d+).*?"divisor"\s*:\s*(\d+).*?"currency_code"\s*:\s*"([A-Z]{3})"', block, re.DOTALL)
            if ma:
                try:
                    price = int(ma.group(1)) / max(1, int(ma.group(2)))
                    currency = ma.group(3)
                except Exception:
                    price = 0.0

        # Avaliações/score público, quando aparece.
        rating = 0.0
        review_count = 0
        mr = re.search(r'"rating"\s*:\s*([0-9]+(?:\.[0-9]+)?)', block)
        if mr:
            try: rating = float(mr.group(1))
            except ValueError: rating = 0.0
        mc = re.search(r'"review_count"\s*:\s*(\d+)', block)
        if mc:
            try: review_count = int(mc.group(1))
            except ValueError: review_count = 0

        items.append({
            "id": listing_id,
            "title": title[:180],
            "price": price,
            "currency": currency,
            "price_label": price_text,
            "original": None,
            "discount": 0,
            "sold": review_count,
            "sold_label": (str(review_count) + " avaliações") if review_count else "",
            "rating": rating,
            "thumbnail": img,
            "url": "https://www.etsy.com/listing/{}/{}".format(listing_id, m.group(2)),
            "free_shipping": bool(re.search(r'free shipping|frete grátis', block, re.IGNORECASE)),
            "material": "",
            "trending": review_count >= 50,
        })
        if len(items) >= 24:
            break

    return items


class EtsyMixin:
    def _load_etsy_config(self) -> dict:
        cfg = {"api_key": ""}
        env_key = os.environ.get("ETSY_API_KEY", "").strip()
        if env_key:
            cfg["api_key"] = env_key
            cfg["source"] = "env"
            return cfg
        if ETSY_CONFIG_FILE.exists():
            try:
                saved = load_json(ETSY_CONFIG_FILE)
                cfg.update(saved if isinstance(saved, dict) else {})
                cfg["source"] = "file"
            except Exception:
                cfg["source"] = "error"
        return cfg

    def _send_etsy_config(self) -> None:
        cfg = self._load_etsy_config()
        self._send_json({
            "ok": True,
            "has_api_key": bool(cfg.get("api_key")),
            "source": cfg.get("source", "file"),
        })

    def _save_etsy_config(self) -> None:
        try:
            data = self._read_json_body()
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, 400)
            return

        DATA_DIR.mkdir(exist_ok=True)
        if data.get("disconnect"):
            if ETSY_CONFIG_FILE.exists():
                ETSY_CONFIG_FILE.unlink()
            self._send_json({"ok": True, "message": "Chave Etsy removida."})
            return

        api_key = str(data.get("api_key", "")).strip()
        if not api_key or api_key == "********":
            self._send_json({"ok": False, "error": "Informe a API Key do Etsy."}, 400)
            return
        ETSY_CONFIG_FILE.write_text(json.dumps({"api_key": api_key}, indent=2, ensure_ascii=False), encoding="utf-8")
        self._send_json({"ok": True, "message": "API Key Etsy salva."})

    def _send_etsy_search(self, query: str, sort: str = "relevance") -> None:
        allowed_sorts = {"relevance", "price_asc", "price_desc", "review_count"}
        if sort not in allowed_sorts:
            sort = "relevance"

        cfg = self._load_etsy_config()
        api_key = (cfg.get("api_key") or "").strip()
        cache_key = f"etsy_api:{query}:{sort}:{bool(api_key)}"
        with _trending_lock:
            cached = _trending_cache.get(cache_key)
            if cached and time.time() - cached["ts"] < TRENDING_TTL:
                self._send_json(cached["data"], 200)
                return

        if not api_key:
            self._send_json({
                "ok": True,
                "manual_mode": True,
                "items": [],
                "total": 0,
                "query": query,
                "source": "Etsy links externos",
                "warning": "O Etsy bloqueia consultas públicas por HTML. Para resultados automáticos, cadastre uma API Key em Configurações > Etsy. Sem a chave, use os links externos da tela para validar manualmente.",
            }, 200)
            return

        try:
            # Endpoint oficial de busca de anúncios ativos no marketplace Etsy.
            url = (
                "https://openapi.etsy.com/v3/application/listings/active"
                "?keywords={}&limit=24&includes=Images"
            ).format(quote_plus(query))
            req = urllib.request.Request(url, headers={
                "x-api-key": api_key,
                "Accept": "application/json",
                "User-Agent": "Sistema3D Local/1.0",
            })
            with urllib.request.urlopen(req, timeout=20) as r:
                payload = json.loads(r.read().decode("utf-8") or "{}")

            raw_items = payload.get("results") or []
            items = []
            for it in raw_items:
                price_obj = it.get("price") or {}
                amount = price_obj.get("amount")
                divisor = price_obj.get("divisor") or 100
                try:
                    price = float(amount) / float(divisor) if amount is not None else 0.0
                except Exception:
                    price = 0.0
                imgs = it.get("images") or it.get("Images") or []
                image = ""
                if imgs and isinstance(imgs, list):
                    image = imgs[0].get("url_570xN") or imgs[0].get("url_fullxfull") or imgs[0].get("url_75x75") or ""
                listing_id = it.get("listing_id")
                slug = re.sub(r"[^a-z0-9]+", "-", (it.get("title") or "").lower()).strip("-")[:80]
                url_item = it.get("url") or (f"https://www.etsy.com/listing/{listing_id}/{slug}" if listing_id else "https://www.etsy.com/search?q=" + quote_plus(query))
                items.append({
                    "id": listing_id,
                    "title": it.get("title") or "Anúncio Etsy",
                    "price": price,
                    "currency": price_obj.get("currency_code") or "USD",
                    "sold": int(it.get("num_favorers") or 0),
                    "reviews": int(it.get("num_favorers") or 0),
                    "free_shipping": False,
                    "thumbnail": image,
                    "permalink": url_item,
                    "seller": "Etsy",
                })

            if sort == "price_asc":
                items.sort(key=lambda x: (float(x.get("price") or 0) <= 0, float(x.get("price") or 0)))
            elif sort == "price_desc":
                items.sort(key=lambda x: float(x.get("price") or 0), reverse=True)
            elif sort == "review_count":
                items.sort(key=lambda x: int(x.get("sold") or 0), reverse=True)

            data = {
                "ok": True,
                "items": items,
                "total": payload.get("count") or len(items),
                "query": query,
                "cached_at": int(time.time()),
                "source": "Etsy Open API",
                "warning": "A API do Etsy não expõe vendas por anúncio na busca. O campo de sinal público usa favoritos/engajamento quando disponível.",
            }
            with _trending_lock:
                _trending_cache[cache_key] = {"ts": time.time(), "data": data}
            self._send_json(data, 200)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")[:300]
            self._send_json({
                "ok": True,
                "manual_mode": True,
                "items": [],
                "total": 0,
                "query": query,
                "source": "Etsy links externos",
                "warning": "A API oficial do Etsy recusou a consulta (HTTP {}). Confira se a API Key está correta. Enquanto isso, use os links externos. Detalhe: {}".format(exc.code, body),
            }, 200)
        except Exception as exc:
            self._send_json({
                "ok": True,
                "manual_mode": True,
                "items": [],
                "total": 0,
                "query": query,
                "source": "Etsy links externos",
                "warning": "Não consegui consultar a API do Etsy agora. Use os links externos e tente novamente depois. Detalhe: {}".format(str(exc)[:220]),
            }, 200)

