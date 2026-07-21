# CoSkin 平台与跨工具实施方案

现状：仅 macOS + Codex Desktop（`/Applications/ChatGPT.app`，`com.openai.codex`）。
**核心可复用**——注入引擎（CDP 客户端 `cdp.mjs`）、token 编译器（`tokens.mjs`）、
取色（`palette.mjs`）、主题装饰（`css.mjs` 的面板/横幅/桌宠/卡片）全是跨平台的浏览器代码。
**唯一平台/工具相关**的是两层：① 怎么把目标应用拉起来带本机调试端口；② 该应用界面的
DOM/token 选择器。因此扩展的本质是「新增一个 launcher + 一份选择器」，不是重写。

---

## 一、Windows 版 Codex 实现方案（独立版已实现，待真机验证）

> **进度（2026-07-21，v0.29.0）**：平台分派 + 独立安装版 launcher 已落地——
> `src/launcher.mjs`（按 `process.platform` 分派）、`src/launcher-win.mjs`
> （AppX/注册表找应用、`CloseMainWindow()` 优雅关闭、`Start-Process` 带调试参数启动）。
> 双击入口两个：`双击换肤.bat`（显示控制台）+ `双击换肤(无窗口).vbs`（隐藏窗口、可钉任务栏，
> 跑 `resume --update --gui`）。`--gui` 的确认/报错走 PowerShell MessageBox；装技能已收进 node 侧
> `ensureSkillInstalled()`（跨平台幂等）。同意门与"仅会话"铁律照搬。
> **以下全部尚未在真实 Windows 上验证**；Store/MSIX 版检测到会给明确指引而非静默失败。

### 真机验收清单（待办 · 需要一台真实 Windows）

按重要性排序，逐项在真机上过：
- [ ] **独立版找应用 + 带调试端口启动**：`launcher-win.mjs` 能定位 `.exe`、`Start-Process` 带
      `--remote-debugging-port=9341` 起来后端口真的在监听（`curl http://127.0.0.1:9341/json/version`）。
- [ ] **优雅关闭同意门**：Codex 运行中 → `--gui` 弹 PowerShell MessageBox 问"重启吗"，点"否"不动它；
      点"是"才 `CloseMainWindow()`（**不是** `Stop-Process -Force`）等它退、再带参重启。
- [ ] **`双击换肤(无窗口).vbs`**：双击**不弹黑窗口**、能启动带皮肤的 Codex；`where node` 找不到时能弹 MsgBox。
- [ ] **中文编码**：`.vbs` 的 MsgBox 与 `--gui` PowerShell 弹窗里的中文**不乱码**（.vbs 存盘编码是最大嫌疑；
      乱码就改用 UTF-16 LE + BOM，或退化成英文文案）。
- [ ] **装技能路径**：`ensureSkillInstalled()` 写到 `%USERPROFILE%\.agents\skills\coskin\SKILL.md`，
      反斜杠路径 + UTF-8 内容都对，`__COSKIN_ROOT__` 全替换。
- [ ] **注入生效**：面板/壁纸/水玻璃/桌宠在 Windows 版 Codex 上渲染正常（DOM 选择器与 mac 一致性）。
- [ ] **Store/MSIX 兜底**：装的是 Store 版时给出明确"改用独立版/带参快捷方式"的指引，不静默失败。


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
- **Claude Desktop = Electron 但已加固**（`com.anthropic.claudefordesktop`，含 `app.asar` +
  Electron Framework）→ **CDP 注入走不通**。实测：`open --args --remote-debugging-port` 与直调二进制
  都**打不开调试端口**、启动日志里**没有** "DevTools listening on ws://…"（Electron 开启远程调试时才会打印）。
  说明 Anthropic 用 Electron fuse 关掉了 inspector。**所以现有机制对 Claude Desktop 无效**——除非改
  `app.asar`（违背"不改二进制、可逆"承诺）或等官方主题 API。**这条路暂时封死。**
- **Cursor / Antigravity / Kiro / Windsurf = VS Code 分支**（都是 Electron）→ 大概率可注入；且它们
  自带 VS Code 主题系统，颜色层可借力，壁纸/背景/桌宠层仍靠注入。**这才是务实的跨工具方向**（未逐一实测端口）。

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
- **Phase 1（已完成）**：Codex Desktop / macOS（+ Windows 代码就绪待真机）。
- **Phase 2：VS Code 系（Cursor / Windsurf / Kiro / Antigravity）**——现在**最务实**的跨工具方向
  （Claude Desktop 已探明封死，见上）。这些是 Electron，大概率可 CDP 注入；颜色层可借 VS Code 主题机制、
  背景/水玻璃/桌宠靠注入。卖点收窄但独一无二：native 主题管不到的 AI 对话面板 + 氛围皮。
  第一步：逐一只读侦察各自的调试端口是否打得开（同 Claude 那套决定性测试）→ 能开的写 target 描述符。
- **Phase 3：Claude Desktop（阻塞中）**——技术上被加固挡住，等官方主题 API 或不改二进制的新注入向量再说。

### 为什么跨工具比 Windows 更值得先做
Windows 让 CoSkin 变成"第 N+1 个 Codex 换肤器"；跨工具让它变成**"唯一的跨 agent
主题工作室"**——`.coskin` 分享格式 + token 编译器天生工具无关，护城河在这里。
（注：Windows 已基本就绪、只差真机验收，所以短期两条都能推进。）
