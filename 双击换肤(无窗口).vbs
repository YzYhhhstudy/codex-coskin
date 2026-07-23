' CoSkin 无窗口启动器（Windows）—— 双击 = 打开带皮肤的 Codex（更新 + 恢复上次主题），不弹黑窗口。
' 这是 macOS 上 CoSkin.app 的 Windows 等价物：可以「固定到任务栏」，点一下就开。
' 没装 Node 也没关系：scripts\launch.ps1 会免管理员地把绿色版 Node 装进 %LOCALAPPDATA%\CoSkin
'（首次约 50MB，只此一次，不会弹 UAC）。需要重启 Codex 时会弹系统对话框问你（-Gui）。
' 想看进度 / 排错就改双击 双击换肤.bat（会显示控制台）。
' 注：Windows 端尚未在真机充分验证，遇到问题欢迎到仓库提 issue。
Option Explicit
Dim fso, sh, dir, ps
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

ps = "powershell -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\scripts\launch.ps1"" -Gui"
' 0 = 隐藏窗口，True = 等它跑完；准备环境/确认/报错都由 launch.ps1 的系统弹窗负责
sh.Run ps, 0, True
