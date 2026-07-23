# CoSkin 运行环境自举 + 启动（Windows）
#
# 目标：全新电脑上只装了 Codex、连 Node 都没有，双击也能直接跑起来。
# 优先级：① %LOCALAPPDATA%\CoSkin\node\node.exe → ② 系统 node（≥22）→ ③ 免密下载官方绿色版。
#
# 关键：③ 只往 %LOCALAPPDATA% 写，绝不碰 Program Files / 注册表，
#      所以**不需要管理员、不会弹 UAC**。卸载 = 删掉 %LOCALAPPDATA%\CoSkin。
#      下载包会用 nodejs.org 官方 SHASUMS256 校验，不匹配就丢弃。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launch.ps1 [-Gui]
#   -Gui：无窗口启动器（.vbs）用，确认/报错走系统弹窗。
#
# 注意：Windows 端尚未在真机充分验证，遇到问题欢迎到仓库提 issue。

param([switch]$Gui)

$ErrorActionPreference = 'Stop'
$MinMajor = 22
$Root = Split-Path -Parent $PSScriptRoot
$CoskinHome = if ($env:COSKIN_HOME) { $env:COSKIN_HOME } else { Join-Path $env:LOCALAPPDATA 'CoSkin' }
$NodeDir = Join-Path $CoskinHome 'node'
$NodeExe = Join-Path $NodeDir 'node.exe'

function Show-Msg([string]$text) {
  if ($Gui) {
    # TopMost 宿主窗体当 owner，否则无窗口启动时弹框会被别的窗口盖住
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}
    [System.Windows.Forms.MessageBox]::Show($owner, $text, 'CoSkin') | Out-Null
  } else {
    Write-Host $text
  }
}

function Test-NodeOk([string]$exe) {
  if ([string]::IsNullOrWhiteSpace($exe) -or -not (Test-Path $exe)) { return $false }
  try { $v = & $exe -v 2>$null } catch { return $false }
  if ($v -match '^v(\d+)\.') { return ([int]$Matches[1] -ge $MinMajor) }
  return $false
}

try {
  $node = $null
  # ① 之前装过的自带副本
  if (Test-NodeOk $NodeExe) { $node = $NodeExe }
  # ② 系统 node
  if (-not $node) {
    $sys = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (Test-NodeOk $sys) { $node = $sys }
  }
  # ③ 免密下载官方绿色版
  if (-not $node) {
    Write-Host "首次运行：没找到 Node $MinMajor+，正在准备运行环境（约 50MB，只此一次）。"
    Write-Host "装到 $NodeDir —— 只写你的用户目录，不需要管理员。"

    $arch = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'arm64' }
    elseif (-not [Environment]::Is64BitOperatingSystem) { $arch = 'x86' }

    $base = "https://nodejs.org/dist/latest-v$MinMajor.x"
    $tmp = Join-Path $env:TEMP ("coskin-node-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
      $sums = Join-Path $tmp 'SHASUMS256.txt'
      Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt" -OutFile $sums
      $line = Get-Content $sums | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip$" } | Select-Object -First 1
      if (-not $line) { throw "没找到匹配的安装包（win-$arch）" }
      $parts = $line -split '\s+'
      $want = $parts[0]
      $pkg = $parts[-1]

      Write-Host "下载 $pkg …"
      $zip = Join-Path $tmp $pkg
      Invoke-WebRequest -UseBasicParsing "$base/$pkg" -OutFile $zip

      $got = (Get-FileHash $zip -Algorithm SHA256).Hash
      if ($got -ne $want.ToUpper()) { throw "校验和不匹配，已丢弃该文件（下载损坏或被篡改）" }

      Expand-Archive -Path $zip -DestinationPath $tmp -Force
      # CoSkin 零依赖，只留 node.exe 一个二进制（npm 等一概不要）
      $srcExe = Get-ChildItem -Path $tmp -Filter node.exe -Recurse | Select-Object -First 1
      if (-not $srcExe) { throw "包里没找到 node.exe" }
      New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
      Copy-Item $srcExe.FullName $NodeExe -Force
    } finally {
      Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-NodeOk $NodeExe)) { throw "装好的 Node 不可用" }
    $node = $NodeExe
    Write-Host "✅ 运行环境就绪（$(& $node -v)）"
  }

  $cliArgs = @((Join-Path $Root 'src\coskin.mjs'), 'resume', '--update')
  if ($Gui) { $cliArgs += '--gui' }
  & $node @cliArgs
  exit $LASTEXITCODE
} catch {
  Show-Msg ("CoSkin 准备运行环境失败：" + $_.Exception.Message + "`r`n请检查网络后重试。")
  exit 1
}
