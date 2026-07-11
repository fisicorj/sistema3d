from __future__ import annotations
import json, shutil, threading, time
from datetime import datetime
from pathlib import Path

class BackupService:
    def __init__(self, db_file: Path, backup_dir: Path, config_file: Path, lock):
        self.db_file=db_file; self.backup_dir=backup_dir; self.config_file=config_file; self.lock=lock
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self._stop=threading.Event(); self._thread=None
    def load_config(self):
        default={"enabled":True,"frequency":"daily","keep":30,"last_backup":None}
        try:
            if self.config_file.exists(): default.update(json.loads(self.config_file.read_text(encoding="utf-8")))
        except Exception: pass
        return default
    def save_config(self,cfg):
        clean={"enabled":bool(cfg.get("enabled",True)),"frequency":cfg.get("frequency","daily") if cfg.get("frequency") in {"daily","weekly","on_save"} else "daily","keep":max(3,min(200,int(cfg.get("keep",30)))) ,"last_backup":self.load_config().get("last_backup")}
        self.config_file.write_text(json.dumps(clean,ensure_ascii=False,indent=2),encoding="utf-8")
        return clean
    def create_backup(self, reason="manual"):
        if not self.db_file.exists(): raise FileNotFoundError("Banco SQLite ainda não existe")
        stamp=datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        target=self.backup_dir/f"sistema3d_{stamp}_{reason}.sqlite"
        with self.lock: shutil.copy2(self.db_file,target)
        cfg=self.load_config(); cfg["last_backup"]=datetime.now().isoformat(timespec="seconds"); self.config_file.write_text(json.dumps(cfg,ensure_ascii=False,indent=2),encoding="utf-8")
        self.prune(cfg.get("keep",30)); return target
    def prune(self,keep=30):
        for p in sorted(self.backup_dir.glob("*.sqlite"),key=lambda x:x.stat().st_mtime,reverse=True)[int(keep):]:
            try:p.unlink()
            except OSError:pass
    def list_backups(self):
        return [{"name":p.name,"size":p.stat().st_size,"created_at":datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds")} for p in sorted(self.backup_dir.glob("*.sqlite"),key=lambda x:x.stat().st_mtime,reverse=True)]
    def start(self):
        if self._thread and self._thread.is_alive(): return
        self._thread=threading.Thread(target=self._loop,daemon=True,name="Sistema3DBackup"); self._thread.start()
    def _loop(self):
        while not self._stop.wait(60):
            cfg=self.load_config()
            if not cfg.get("enabled") or cfg.get("frequency") not in {"daily","weekly"}: continue
            last=cfg.get("last_backup"); elapsed=10**9
            if last:
                try: elapsed=time.time()-datetime.fromisoformat(last).timestamp()
                except Exception: pass
            due=86400 if cfg["frequency"]=="daily" else 604800
            if elapsed>=due:
                try:self.create_backup("auto")
                except Exception:pass
