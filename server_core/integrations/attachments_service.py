from __future__ import annotations
import base64, json, mimetypes, re, uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs

class AttachmentsMixin:
    ATTACHMENTS_ROOT: Path

    def _attachment_root(self) -> Path:
        root = Path(getattr(self, 'ATTACHMENTS_ROOT', Path.cwd() / 'app_data' / 'attachments'))
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _safe_attachment_name(self, name: str) -> str:
        name = Path(name or 'arquivo').name
        name = re.sub(r'[^A-Za-z0-9._-]+', '_', name).strip('._') or 'arquivo'
        return name[:160]

    def _upload_attachment(self) -> None:
        try:
            body = self._read_json_body(max_bytes=25 * 1024 * 1024)
            entity_type = re.sub(r'[^a-z_]+', '', str(body.get('entity_type','')).lower())
            entity_id = str(body.get('entity_id','')).strip()
            filename = self._safe_attachment_name(str(body.get('filename','arquivo')))
            data_url = str(body.get('data',''))
            allowed = {'orders','products','quotes','radar'}
            if entity_type not in allowed or not entity_id:
                self._send_json({'ok':False,'error':'Entidade de anexo inválida.'},400); return
            if ',' in data_url: data_url = data_url.split(',',1)[1]
            raw = base64.b64decode(data_url, validate=True)
            if not raw or len(raw) > 20 * 1024 * 1024:
                self._send_json({'ok':False,'error':'Arquivo vazio ou maior que 20 MB.'},400); return
            folder = self._attachment_root() / entity_type / re.sub(r'[^A-Za-z0-9_-]+','_',entity_id)
            folder.mkdir(parents=True, exist_ok=True)
            stored = f"{uuid.uuid4().hex}_{filename}"
            path = folder / stored
            path.write_bytes(raw)
            self._send_json({'ok':True,'stored_name':stored,'filename':filename,'size_bytes':len(raw),'mime_type':body.get('mime_type') or mimetypes.guess_type(filename)[0] or 'application/octet-stream'})
        except Exception as exc:
            self._send_json({'ok':False,'error':f'Falha ao salvar anexo: {exc}'},400)

    def _download_attachment(self) -> None:
        qs = parse_qs(urlparse(self.path).query)
        rel = str(qs.get('path',[''])[0])
        root = self._attachment_root().resolve()
        target = (root / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.send_error(403); return
        if not target.is_file(): self.send_error(404); return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        self.send_header('Content-Disposition', f'attachment; filename="{target.name.split("_",1)[-1]}"')
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

    def _delete_attachment_file(self) -> None:
        try:
            body = self._read_json_body(); rel = str(body.get('path',''))
            root = self._attachment_root().resolve(); target=(root/rel).resolve(); target.relative_to(root)
            if target.is_file(): target.unlink()
            self._send_json({'ok':True})
        except Exception as exc: self._send_json({'ok':False,'error':str(exc)},400)
