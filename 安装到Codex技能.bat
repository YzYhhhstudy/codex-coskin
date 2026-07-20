@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "DST=%USERPROFILE%\.agents\skills\coskin"
if not exist "%DST%" mkdir "%DST%"
powershell -NoProfile -Command "(Get-Content -Raw '%~dp0skill\coskin\SKILL.md') -replace '__COSKIN_ROOT__', ('%~dp0'.TrimEnd('\')) | Set-Content -Encoding UTF8 '%DST%\SKILL.md'"
echo ✅ 已安装 Codex 技能：%DST%
echo    仓库路径已写入：%~dp0
echo    现在可以直接对 Codex 说：用 coskin 给我换个主题 / 导入这个 .coskin 文件
echo.
echo 按任意键关闭窗口...
pause >nul
