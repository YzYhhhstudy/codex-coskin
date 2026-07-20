@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (
  echo 没找到 Node.js 22+，请先安装：https://nodejs.org
  pause
  exit /b 1
)
rem 顺手安装/更新 Codex 技能（幂等）
set "DST=%USERPROFILE%\.agents\skills\coskin"
if not exist "%DST%" mkdir "%DST%"
powershell -NoProfile -Command "(Get-Content -Raw '%~dp0skill\coskin\SKILL.md') -replace '__COSKIN_ROOT__', ('%~dp0'.TrimEnd('\')) | Set-Content -Encoding UTF8 '%DST%\SKILL.md'" 2>nul && echo ✅ Codex 技能已就绪
echo.
node src\coskin.mjs menu
echo.
echo 已退出 CoSkin。按任意键关闭窗口...
pause >nul
