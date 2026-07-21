' CoSkin 无窗口启动器（Windows）—— 双击 = 打开带皮肤的 Codex（更新 + 恢复上次主题），不弹黑窗口。
' 这是 macOS 上 CoSkin.app 的 Windows 等价物：可以「固定到任务栏」，点一下就开带皮肤的 Codex。
' 需要重启 Codex 时会弹系统对话框问你（--gui）；装/更新 Codex 技能由 node 侧自动完成。
' 想看进度 / 排错就改双击 双击换肤.bat（会显示控制台）。
' 注：Windows 端尚未在真机充分验证，遇到问题欢迎到仓库提 issue。
Option Explicit
Dim fso, sh, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' 先确认 node 在 PATH 上（node 没装的话下面就静默失败了，得先当面告诉用户）
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "没找到 Node.js（需要 22 或更新版本）。装好后再双击我。" & vbCrLf & "下载：https://nodejs.org", vbExclamation, "CoSkin"
  WScript.Quit 1
End If

' 0 = 隐藏窗口，True = 等它跑完；确认/报错/完成提示都由 --gui 的系统弹窗负责
sh.Run "cmd /c node """ & dir & "\src\coskin.mjs"" resume --update --gui", 0, True
