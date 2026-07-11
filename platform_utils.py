"""Utilitários de compatibilidade de arquivos para Linux e Windows."""
from __future__ import annotations

import os
import platform
import shutil
import time
from pathlib import Path

SYSTEM = platform.system().lower()
IS_WINDOWS = SYSTEM == "windows"
IS_LINUX = SYSTEM == "linux"


def fsync_directory(path: Path) -> None:
    """Sincroniza metadados do diretório quando a plataforma permite (Linux/Unix)."""
    if IS_WINDOWS:
        return
    try:
        fd = os.open(str(path), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except (OSError, AttributeError):
        pass


def safe_replace(source: Path, target: Path, *, retries: int = 20, delay: float = 0.10) -> None:
    """Substitui um arquivo com semântica segura em Linux e tolerância a locks no Windows."""
    last_error: OSError | None = None
    attempts = retries if IS_WINDOWS else max(2, min(retries, 4))

    for attempt in range(attempts):
        try:
            os.replace(source, target)
            fsync_directory(target.parent)
            return
        except PermissionError as exc:
            last_error = exc
            if not IS_WINDOWS:
                raise
            time.sleep(delay * (attempt + 1))
        except OSError as exc:
            last_error = exc
            if not IS_WINDOWS:
                raise
            time.sleep(delay * (attempt + 1))

    # No Windows, alguns antivírus/indexadores bloqueiam rename, mas permitem escrita.
    if IS_WINDOWS:
        for attempt in range(attempts):
            try:
                with source.open("rb") as src, target.open("wb") as dst:
                    shutil.copyfileobj(src, dst, length=1024 * 1024)
                    dst.flush()
                    os.fsync(dst.fileno())
                source.unlink(missing_ok=True)
                return
            except PermissionError as exc:
                last_error = exc
                time.sleep(delay * (attempt + 1))

    if last_error:
        raise last_error
    raise OSError(f"Não foi possível substituir {target}")
