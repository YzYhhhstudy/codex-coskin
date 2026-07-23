@echo off
chcp 65001 >nul
rem CoSkin 入口（显示进度版）：双击我 = 启动 Codex（带皮肤）+ 更新到最新 + 恢复上次用的主题。
rem 没装 Node 也没关系：scripts\launch.ps1 会免管理员地把绿色版 Node 装进 %LOCALAPPDATA%\CoSkin。
rem 换主题 / 自定义配色 / 导入导出，全在 Codex 右下角的 🎨 面板里做。第一次运行还会装好 Codex 技能。
rem 想要"无黑窗口"的体验，改双击 双击换肤(无窗口).vbs。
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
echo.
echo 🎨 换主题 / 自定义配色 / 导入导出，点 Codex 右下角的 🎨 按钮就行。
echo 按任意键关闭窗口...
pause >nul
