@echo off
cd /d "%~dp0"
echo 3D Print Pro - Gestao 3D
echo Servidor iniciando em http://127.0.0.1:8080
echo Banco SQLite em: %cd%\app_data\sistema3d.sqlite
start http://127.0.0.1:8080
python server.py --host 127.0.0.1 --port 8080
pause
