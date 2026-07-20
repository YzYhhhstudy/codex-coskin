@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (
  echo 没找到 Node.js 22+，请先安装：https://nodejs.org
  pause
  exit /b 1
)
rem 安装 Codex 技能（先查是否已装且路径正确，是则跳过）
set "DST=%USERPROFILE%\.agents\skills\coskin"
powershell -NoProfile -Command "$f=Join-Path $env:DST 'SKILL.md'; $root=('%~dp0'.TrimEnd('\')); if ((Test-Path $f) -and (Select-String -Path $f -SimpleMatch $root -Quiet)) { Write-Host '✅ Codex 技能已安装' } else { New-Item -ItemType Directory -Force -Path $env:DST | Out-Null; (Get-Content -Raw '%~dp0skill\coskin\SKILL.md') -replace '__COSKIN_ROOT__', $root | Set-Content -Encoding UTF8 $f; Write-Host '✅ 已安装 Codex 技能' }"
echo.
node src\coskin.mjs menu
echo.
echo 已退出 CoSkin。按任意键关闭窗口...
pause >nul
