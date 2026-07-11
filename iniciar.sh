#!/bin/bash
cd "$(dirname "$0")"
echo "🟢 3D Print Pro — Gestão 3D"
echo "Servidor iniciando em http://127.0.0.1:8080"
echo "Banco SQLite em: $(pwd)/app_data/sistema3d.sqlite"
echo "Pressione Ctrl+C para parar."
xdg-open http://127.0.0.1:8080 2>/dev/null &
python3 server.py --host 0.0.0.0 --port 8080
