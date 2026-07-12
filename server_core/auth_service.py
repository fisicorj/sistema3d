from __future__ import annotations
import hashlib, hmac, json, os, secrets, sqlite3, threading, time
from pathlib import Path
from http.cookies import SimpleCookie
from .config_store import load_json, save_json

_DUMMY_HASH = "pbkdf2_sha256$260000$0000000000000000$" + "0" * 64  # usado para equalizar tempo quando usuário não existe

class AuthService:
    _RATE_LIMIT_MAX   = 5          # tentativas antes do bloqueio
    _RATE_LIMIT_WINDOW = 60        # segundos de bloqueio após exceder

    def __init__(self, db_file: Path, config_file: Path):
        self.db_file = Path(db_file)
        self.config_file = Path(config_file)
        self.session_db_file = self.config_file.with_name("auth_sessions.sqlite")
        self._failed: dict[str, list[float]] = {}   # ip → lista de timestamps de falha
        self._lock = threading.RLock()
        self.session_ttl = 12 * 3600
        self._ensure_auth_schema()

    def _ensure_auth_schema(self):
        """Cria o armazenamento persistente de sessões sem alterar a configuração de login."""
        with self._session_connect() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at REAL NOT NULL,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            )""")
            c.execute("CREATE INDEX IF NOT EXISTS ix_auth_sessions_expires ON auth_sessions(expires_at)")
            c.execute("DELETE FROM auth_sessions WHERE expires_at < ?", (time.time(),))
            c.commit()

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def config(self):
        cfg = load_json(self.config_file, {}) or {}
        return {"enabled": bool(cfg.get("enabled", False)), "session_hours": int(cfg.get("session_hours", 12) or 12)}

    def save_config(self, enabled: bool, session_hours: int = 12):
        cfg = {"enabled": bool(enabled), "session_hours": max(1, min(168, int(session_hours or 12)))}
        save_json(self.config_file, cfg)
        self.session_ttl = cfg["session_hours"] * 3600
        return cfg

    @staticmethod
    def hash_password(password: str) -> str:
        if len(password) < 8:
            raise ValueError("A senha deve ter pelo menos 8 caracteres")
        salt = os.urandom(16)
        iterations = 260000
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"

    @staticmethod
    def verify_password(password: str, stored: str) -> bool:
        try:
            alg, it, salt_hex, digest_hex = stored.split("$", 3)
            if alg != "pbkdf2_sha256": return False
            calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(it))
            return hmac.compare_digest(calc.hex(), digest_hex)
        except Exception:
            return False

    def _connect(self):
        conn = sqlite3.connect(self.db_file, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _session_connect(self):
        self.session_db_file.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.session_db_file, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def status(self, cookie_header: str = ""):
        cfg = self.config()
        user = self.current_user(cookie_header)
        configured = False
        if self.db_file.exists():
            try:
                with self._connect() as c:
                    configured = bool(c.execute("SELECT 1 FROM users WHERE active=1 AND password_hash IS NOT NULL AND password_hash<>'' LIMIT 1").fetchone())
            except sqlite3.Error:
                pass
        return {**cfg, "configured": configured, "authenticated": bool(user), "user": user}

    def set_password(self, user_id: int, password: str):
        pwd = self.hash_password(password)
        with self._connect() as c:
            row = c.execute("SELECT id,name,email FROM users WHERE id=? AND active=1", (user_id,)).fetchone()
            if not row: raise ValueError("Usuário ativo não encontrado")
            c.execute("UPDATE users SET password_hash=? WHERE id=?", (pwd, user_id))
            c.commit()
        return dict(row)

    def _check_rate_limit(self, identifier: str) -> None:
        """Levanta ValueError se o identificador excedeu as tentativas permitidas."""
        now = time.time()
        with self._lock:
            attempts = [t for t in self._failed.get(identifier, []) if now - t < self._RATE_LIMIT_WINDOW]
            if len(attempts) >= self._RATE_LIMIT_MAX:
                wait = int(self._RATE_LIMIT_WINDOW - (now - attempts[0]))
                raise ValueError(f"Muitas tentativas. Aguarde {wait}s antes de tentar novamente.")
            self._failed[identifier] = attempts

    def _record_failure(self, identifier: str) -> None:
        with self._lock:
            self._failed.setdefault(identifier, []).append(time.time())

    def _clear_failures(self, identifier: str) -> None:
        with self._lock:
            self._failed.pop(identifier, None)

    def login(self, email: str, password: str, remote_addr: str = "local"):
        identifier = remote_addr or "local"
        self._check_rate_limit(identifier)
        with self._connect() as c:
            row = c.execute("""SELECT u.id,u.name,u.email,u.password_hash,u.active,r.name role_name,r.permissions
                FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE lower(u.email)=lower(?) LIMIT 1""", (email.strip(),)).fetchone()
            # Sempre executa verify_password para evitar enumeração de usuários por timing.
            stored = (row["password_hash"] if row and row["password_hash"] else _DUMMY_HASH)
            ok = self.verify_password(password, stored)
            if not row or not row["active"] or not ok:
                self._record_failure(identifier)
                raise ValueError("E-mail ou senha inválidos")
            self._clear_failures(identifier)
            c.execute("UPDATE users SET last_login=? WHERE id=?", (time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), row["id"]))
            c.commit()
        token = secrets.token_urlsafe(32)
        user = self._user_dict(row)
        now = time.time()
        stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        with self._session_connect() as c:
            c.execute("DELETE FROM auth_sessions WHERE expires_at < ?", (now,))
            c.execute(
                "INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)",
                (self._token_hash(token), user["id"], now + self.session_ttl, stamp, stamp),
            )
            c.commit()
        return token, user

    def logout(self, cookie_header: str):
        token = self._cookie_token(cookie_header)
        if token:
            self._ensure_auth_schema()
            with self._session_connect() as c:
                c.execute("DELETE FROM auth_sessions WHERE token_hash=?", (self._token_hash(token),))
                c.commit()

    def current_user(self, cookie_header: str):
        token = self._cookie_token(cookie_header)
        if not token:
            return None
        self._ensure_auth_schema()
        now = time.time()
        token_hash = self._token_hash(token)
        with self._session_connect() as sessions:
            session = sessions.execute(
                "SELECT user_id,expires_at FROM auth_sessions WHERE token_hash=? LIMIT 1",
                (token_hash,),
            ).fetchone()
            if not session or float(session["expires_at"]) < now:
                sessions.execute("DELETE FROM auth_sessions WHERE token_hash=?", (token_hash,))
                sessions.commit()
                return None

        try:
            with self._connect() as users_db:
                row = users_db.execute(
                    """SELECT u.id,u.name,u.email,u.active,r.name role_name,r.permissions
                    FROM users u LEFT JOIN roles r ON r.id=u.role_id
                    WHERE u.id=? LIMIT 1""",
                    (session["user_id"],),
                ).fetchone()
        except sqlite3.Error:
            return None

        if not row or not row["active"]:
            with self._session_connect() as sessions:
                sessions.execute("DELETE FROM auth_sessions WHERE token_hash=?", (token_hash,))
                sessions.commit()
            return None

        with self._session_connect() as sessions:
            sessions.execute(
                "UPDATE auth_sessions SET expires_at=?,last_seen_at=? WHERE token_hash=?",
                (now + self.session_ttl, time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), token_hash),
            )
            sessions.commit()
        return self._user_dict(row)

    def allowed(self, user: dict | None, permission: str):
        if not user: return False
        perms = user.get("permissions") or {}
        return bool(perms.get("all") or perms.get(permission))

    @staticmethod
    def _cookie_token(header: str):
        try:
            c = SimpleCookie(); c.load(header or "")
            return c.get("s3d_session").value if c.get("s3d_session") else None
        except Exception: return None

    @staticmethod
    def _user_dict(row):
        try: perms = json.loads(row["permissions"] or "{}")
        except Exception: perms = {}
        return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role_name"] or "Sem perfil", "permissions": perms}
