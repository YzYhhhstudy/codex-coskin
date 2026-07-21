@echo off
chcp 65001 >nul
rem CoSkin 唯一入口：双击我 = 启动 Codex（带皮肤）+ 更新到最新 + 恢复上次用的主题。
rem 换主题 / 自定义配色 / 导入导出，全在 Codex 右下角的 🎨 面板里做。第一次双击还会装好 Codex 技能。
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
rem 启动 Codex（关着会自动以调试模式打开）+ 拉最新代码 + 重上你上次用过的主题
node src\coskin.mjs resume --update
echo.
echo 🎨 换主题 / 自定义配色 / 导入导出，点 Codex 右下角的 🎨 按钮就行。
echo 按任意键关闭窗口...
pause >nul
