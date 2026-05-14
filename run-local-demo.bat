@echo off
setlocal

set ROOT=%~dp0
set API_DIR=%ROOT%artifacts\api-server
set WEB_DIR=%ROOT%artifacts\nurse-scheduler

start "Ward Shift Planner API" cmd /k "cd /d %API_DIR% && node build.mjs && node dist\index.mjs"
start "Ward Shift Planner Web" cmd /k "cd /d %WEB_DIR% && node_modules\.bin\vite.cmd --config vite.config.ts --host 0.0.0.0"

echo API:  http://127.0.0.1:8080/api/healthz
echo WEB:  http://127.0.0.1:24675
