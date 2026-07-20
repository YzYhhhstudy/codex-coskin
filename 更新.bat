@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (
  echo 没找到 Node.js 22+，请先安装：https://nodejs.org
  pause
  exit /b 1
)
node src\coskin.mjs update
echo.
echo 按任意键关闭窗口...
pause >nul
