# CoSkin 平台与跨工具实施方案

现状：仅 macOS + Codex Desktop（`/Applications/ChatGPT.app`，`com.openai.codex`）。
**核心可复用**——注入引擎（CDP 客户端 `cdp.mjs`）、token 编译器（`tokens.mjs`）、
取色（`palette.mjs`）、主题装饰（`css.mjs` 的面板/横幅/桌宠/卡片）全是跨平台的浏览器代码。
**唯一平台/工具相关**的是两层：① 怎么把目标应用拉起来带本机调试端口；② 该应用界面的
DOM/token 选择器。因此扩展的本质是「新增一个 launcher + 一份选择器」，不是重写。

---

## 一、Windows 版 Codex 实现方案（独立版已实现，待真机验证）

> **进度（2026-07-19）**：平台分派 + 独立安装版 launcher 已落地——
> `src/launcher.mjs`（按 `process.platform` 分派）、`src/launcher-win.mjs`
> （AppX/注册表找应用、`CloseMainWindow()` 优雅关闭、`Start-Process` 带调试参数启动）、
> `双击换肤.bat` 双击入口。同意门与"仅会话"铁律照搬。**尚未在真实 Windows 上验证**；
> Store/MSIX 版检测到会给明确指引而非静默失败。下方是完整设计说明。


### 目标与差异
Windows 上 Codex Desktop 是 ChatGPT 桌面应用，两种形态：
- **独立安装版**：`%LOCALAPPDATA%\Programs\` 下有 `.exe`，最好处理。
- **Microsoft Store / MSIX 版**：装在 `WindowsApps`，要用 AUMID 激活。

### 要新写的 `src/launcher-win.mjs`（对齐 macOS launcher 的接口）
1. **找应用**：查注册表 App Paths / `Get-AppxPackage *OpenAI* ` 拿 MSIX 的 AUMID；
   独立版直接探 `%LOCALAPPDATA%` 与 `%PROGRAMFILES%`。
2. **优雅退出**：不能 `Stop-Process -Force`（等于 kill）。用 PowerShell 向主窗口发
   `WM_CLOSE`（`(New-Object -ComObject WScript.Shell)` 或 user32 `PostMessage`），
   等进程退出；超时才提示用户手动关。**同意门逻辑照搬**，一行不改。
3. **带调试端口重启**：
   - 独立版：`Start-Process "<exe>" -ArgumentList "--remote-debugging-address=127.0.0.1","--remote-debugging-port=9341"`。
   - Store/MSIX 版：`explorer.exe shell:AppsFolder\<AUMID>` **无法可靠透传 CLI 参数** ——
     这是最大风险点（HeiGe 仓库自己标注 Store 路径"真机待验证"）。备选：改用 MSIX 的
     `ActivateApplication` COM 接口，或退化为"引导用户用带参快捷方式启动"。
4. **进程识别**：`Get-CimInstance Win32_Process` 按可执行路径前缀过滤，等价 macOS 的 `ps ax`。

### 平台分派
`launcher.mjs` 顶部按 `process.platform` 分派到 `-mac` / `-win` 实现；
`.command` 脚本对应新增 `.bat`/`.ps1` 双击入口（UTF-8 BOM + CRLF，中文路径要过测试）。

### 验收
`test/mock-verify.mjs` 与 `theme-lint.mjs` 本就跨平台（无头 Chrome/Edge 即可）。
Windows 专属只需补：AUMID 解析、WM_CLOSE 优雅退出、带参启动三项的真机验证。
**建议先只做独立安装版（低风险），Store/MSIX 标注"实验性"。**

---

## 二、跨工具（不止 Codex）实施方案

### 关键探明（2026-07，本机只读侦察）
- **Claude Desktop = Electron**（`com.anthropic.claudefordesktop`，含 `app.asar` +
  Electron Framework）→ **同一套 CDP 注入技术上可行**。它没有官方换肤接口，但这正是
  CoSkin 的切入点。
- **Cursor / Antigravity / Kiro = VS Code 分支**（都是 Electron）→ 同样可注入；且它们
  自带 VS Code 主题系统，颜色层可借力，壁纸/背景层仍需注入。

### 抽象重构：引入「目标描述符」
把当前写死 Codex 的地方收敛成一个 target 定义：
```
{
  id: "codex",
  launch: { mac: {...}, win: {...} },     // 每平台怎么带调试端口起
  cdpPort: 9341,
  mainUrlMatch: "app://-/index.html",     // 主窗口识别
  tokenInventory: "codex-token-inventory.json",
  selectors: { sidebar, main, composer, homeSuggestions, ... },
  decorSurfaces: { banner, cards, pet },  // 该工具有没有首页卡等装饰位
}
```
token 编译器 / 取色 / 注入外壳 / 面板 UI 全部读这个描述符，不再认识"Codex"。

### 分阶段
- **Phase 1（已完成）**：Codex Desktop / macOS。
- **Phase 2：Claude Desktop**（战略价值最高）——"一套主题同时罩住 Codex + Claude"，
  这是别人短期抄不走的定位。工作量：只读扒 Claude 的 token/DOM（同"中心点堆栈"手法）→
  写它的 target 描述符 → 颜色层几乎白得；装饰层按它的界面重新设计（Claude 是对话流，
  没有 Codex 的首页四卡，`cards` 装饰不适用，但 token+壁纸+桌宠都能用）。约 2~3 天。
- **Phase 3：VS Code 系（Cursor/Kiro/Antigravity）**——颜色借 VS Code 主题机制、
  背景/装饰靠注入；一份 target 描述符覆盖一类分支。

### 为什么这条比 Windows 更值得先做
Windows 让 CoSkin 变成"第 N+1 个 Codex 换肤器"；跨工具让它变成**"唯一的跨 agent
主题工作室"**——`.coskin` 分享格式 + token 编译器天生工具无关，护城河在这里。
