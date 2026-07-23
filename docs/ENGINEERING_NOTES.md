# CoSkin 工程笔记（总结与经验）

> 2026-07-18 → 07-19，v0.1 → v0.23 两天迭代的经验沉淀。给未来的自己和贡献者。
> 同目录：[codex-token-inventory.json](codex-token-inventory.json)（真机 token 清单）、
> [theme-prompts.md](theme-prompts.md)（提示词库）、[PLATFORM-PLAN.md](PLATFORM-PLAN.md)（跨平台/跨工具方案）。

## 架构一句话

不是「往界面糊壁纸」，而是**把几个种子色编译成对 Codex 官方三族变量
（`--color-token-*` / `--color-*` / `--vscode-*`，约 110 个）的覆写**，让所有控件自动跟随；
结构层只做壁纸、水玻璃面、装饰（品牌行/标题板/桌宠/卡片行书字）和可读性兜底。
核心函数全部**自包含**，Node 端直接调用、页面端 `toString()` 内嵌——一份实现两端跑，杜绝逻辑漂移。

三层职责：① Node 端（`coskin.mjs`/`launcher-*`）负责启停 Codex、生成注入脚本、CLI/更新；
② 注入脚本（`css.mjs` 的 `buildInjectionScript`）在 Codex 页面里跑，装面板/装饰/token 覆写；
③ 分级流水线（外观判定→背景可见度→色板→token 编译→控件→细节）在 `tokens.mjs`/`css.mjs`。

## 工程铁律（血泪换来的）

- **改完 `coskin.mjs` 必须真跑一次**（`node src/coskin.mjs list` / `status`），不能只 `node --check`。
  `--check` 只查语法，抓不出 **TDZ**（如 `const STATE_FILE = join(ROOT,…)` 放在 `ROOT` 定义之前，
  模块一加载就 ReferenceError，两个双击入口全崩）。mock 测试不 import `coskin.mjs`，也盖不住。
- **改真机 CSS 选择器，要在真机上 `querySelectorAll` 验证命中数**，别只信 mock。
  例：对话框上方「帽子」用 `div:has(.composer-surface-chrome) > […]` 直接子选择器，
  真机 `matchesCapSel:false`（帽子与 composer 间隔一层包装）；改用特征类组合
  `[class*="bg-token-side-bar-background"][class*="-mx-px"][class*="flex-nowrap"]`，真机命中 1 个。
- **绝不静默重启用户在用的应用**：检测到 Codex 运行中必须经 `confirmRestart` 当面同意；
  非交互环境（无 TTY）一律拒绝、不打断。这是安全底线，也是产品同意门的由来。
  无终端的启动器（`.app` / `.vbs`）用 `--gui`：确认走系统弹窗（mac osascript / win PowerShell MsgBox），
  报错也弹窗、完成发通知——否则窗口一关用户什么都看不到。
- **别把仓库放在 `~/Desktop` / `~/Documents` / iCloud 云盘——GUI `.app` 会被 macOS TCC 拒绝**：
  未签名的 `CoSkin.app` 作为 GUI 应用读桌面下的文件会直接 `Operation not permitted`（TCC 隐私保护），
  而**从终端跑一模一样的命令却全绿**（终端早已获授桌面访问权）→ 只在双击时复现，极易误判成"网络问题"。
  **排查 GUI 启动器时，终端里的成功不算证据。** 解法：仓库放 `~/Developer` 这类不受 TCC 管的普通目录。
  iCloud 目录还有第二重坑：文件被抽成占位符时无窗口 `.app` 读不到会**静默失败**，所以启动器要先校验关键文件存在。
- **无窗口启动器必须把子进程 stderr 带出来**：`.app` 没有终端，早期只弹一句笼统的"请检查网络"，
  把真实原因（正是上面那条 `Operation not permitted`）整个吞掉，作者和用户都只能猜。现在原文显示 `ensure-node.sh` 的 stderr。
- **`sed "s|..." src > dst` 会先把 dst 截空再跑 sed**：一旦 src 不存在 / sed 失败，dst 就被清成 0 字节（`|| true` 还会吞掉错误）。
  真机踩过：一次 DIR 传错让已装好的 `SKILL.md` 被截空。装/改关键文件一律**先写 `.tmp` 再 `mv` 原子替换**，失败就 `rm .tmp`、绝不碰原件。
- **模拟页验证 ≠ 真机**：mock 锁回归（60+ 断言、还原逐项回基线），但真机 DOM 总有惊喜。
  每次真机反馈 → 先只读侦察 → 再把新结构+新断言补进 mock。

## 跨平台：哪些改动天然通用，哪些必须两边各写一份

**分界线就一条：代码跑在哪个进程里。**

- **注入层（`src/css.mjs`）= 平台无关。** 它跑在 Codex 自己的 Chromium 渲染器里，Windows 上是同一个引擎、同一套 DOM。
  所以标题板几何 / 标题提层 / 质感四档 / Codex-ChatGPT 模式判别 / 卡片样式作用域 / `findTitle` —— **写一次两个平台都生效，不需要任何适配**。
- **宿主层（`src/coskin.mjs` + 启动器）= 平台相关。** 找应用、带调试端口重启、`--gui` 弹窗、Node 自举，这些必须各写一份。

**但注入层也有三类"伪平台无关"的坑（v0.34.1 全部修掉）：**
1. **字体**：行书字 `.cs-glyph` 原栈 `"Xingkai SC","Kaiti SC","STKaiti"` **三个全是 macOS 字体**，
   Windows 上会一路掉到 `serif`（宋体）——完全不是行书。补 Windows 自带的 `KaiTi/楷体/SimKai` 才有等效观感。
   同理 `ui-rounded` 也是 macOS 专属，靠 `system-ui` 兜底（Windows 落到 Segoe UI，可接受）。
2. **窗口控件位置**：品牌行左缘原本写死 `226` 去避让 macOS 红绿灯。**Windows 的窗口按钮在右侧**，写死就白白缩进一大截。
   改成**实测顶栏 DOM 控件的最右边缘**再让开——macOS 上 Codex 已为红绿灯预留了空间（DOM 按钮本身就从 ~88 起），
   所以量 DOM 在两个平台都得到正确答案。**凡是"避让系统 UI"的偏移，一律实测而不是写死。**
3. **弹窗置顶**：mac 的 `LSUIElement` 应用弹的对话框不会到最前（要借 System Events）；
   **Windows 的 PowerShell MessageBox 同样会被别的窗口盖住**——要用一个 `TopMost` 宿主窗体当 owner。
   两边是同一个病，别只修一边。

**Windows 仍待真机验证**：`launch.ps1` 的 Node 自举、`.vbs` 无窗口启动、中文编码、注入后的实际渲染。清单见 PLATFORM-PLAN。
**OneDrive = Windows 版的 iCloud 坑**：同样会把文件抽成按需下载的占位符，无窗口启动器读不到就静默失败——启动器的文件存在性校验两个平台都需要。

## 回归测试：两套，各管一段

- **`npm test`（= `node test/run-core.mjs`）自包含核心回归，53 条断言，零参数零依赖。**
  它自己起静态服务 + 无头 Chrome 加载 `test/mock/core.html`，跑完自动清理。
  覆盖**平台无关的核心机制**：token 接管 / 面板挂载 / 配色编辑器 / 桌宠(开关·拖拽·缩放夹子) /
  面板缩放 / 板子质感四档 / 可见度档位 / 还原逐项回基线 / 闭包清理 / 代际门。
- **`test/mock-verify.mjs`** 是老的整页回归（~90 条，含首页装饰：标题板几何、行书字、卡片匹配）。
  它依赖一个**复刻整页 Codex DOM 的 mock**，那份 mock 早期只存在临时目录、已丢失——
  要跑得先重建（约 2 小时）。等真要大改首页装饰时再说。

**为什么非要自包含**：老 mock 页只躺在临时目录里，被系统清掉就跑不了回归了（真的发生过）。
后果很直接——今晚有几个 bug（卡片样式串到 ChatGPT 模式、z-index 加错层）是**用户发现的，不是测试拦下的**。
测试基建不进仓库 = 迟早归零。

**踩过的坑**：`cdpAlive(port)` 返回 true **只代表调试端口开了，不代表文档就绪**。
连太早拿到还没初始化的 document，`localStorage` 直接抛 `SecurityError`（首跑就这么挂的，偶发性极强）。
必须显式轮询到 `document.readyState === "complete"` 且关键节点存在再开跑。

## 真机诊断三板斧（全只读，不打扰使用者）

1. `document.elementsFromPoint(x, y)` 取某点的元素堆栈——找遮挡层（壁纸被谁挡住）、找结构。
2. `getComputedStyle(el)` 枚举自定义属性 / 读计算值——挖 token、量透明度、验证选择器效果。
3. 按工具类名反推变量：类名 `bg-token-X` → 变量 `--color-token-X`，`querySelectorAll` 验证命中。

## 踩过的坑（按主题归类）

### 注入 / 模板字面量
- **`[data-vscode-context]` 包的是整个会话视图**，不是编辑器。设不透明底会把壁纸整块挡死。
  代码可读性靠 `pre` 底色 + 编辑器/终端自绘的 `--vscode-*` 背景。
- **模板里的正则反斜杠、换行必须双写**：`buildInjectionScript` 返回的页面代码写在 JS 模板字面量里，
  `\(`→`(`、`\s`→`s`、`\n`→换行，都会被模板「煮掉」，页面端静默失配而 Node 自测全绿。
  模板内正则一律 `\\(` `\\s` `\\n`；能自包含就用 `toString()` 内嵌（不经模板煮）。
- **i18n 函数别取名 `t`**：代码里 `t` 大量用作「主题对象」（`applyDecor(t)`、`THEMES.find(t=>…)`），
  `t("key")` 会把主题当函数调 → `t is not a function`。改名 `tr`。

### CSS 绘制 / 层叠
- **负 z-index 的绘制顺序**：stacking context 内负 z 子元素画在「普通流块级背景」之下。
  想让垫底板画在容器背景之上、文字之下，宿主容器要自成堆叠上下文（`isolation: isolate`）。
- **水玻璃 ≠ 毛玻璃**：原图档要透出原画，去掉 `backdrop-filter: blur`，只留半透明色 + 轻 `saturate`。
  毛玻璃（blur）留给沉浸/氛围/含蓄档。
- **双层半透明会叠出更高不透明度**：对话框上方的 project/worktree/branch「帽子」与对话框重叠 ~22px，
  两层水玻璃叠出深带 → 把帽子打透明，让对话框成为唯一水玻璃面。
- **缩放「带动画 + 带气泡」的组件：缩放外层单元，别缩放动画元素本身**：桌宠身体带 `animation`（呼吸/弹跳，
  动的是 `transform`），给身体设 `transform: scale` 会被 keyframes **整块覆盖**、缩放在动画播放时消失；
  且气泡与身体是 flex 兄弟——只缩身体，气泡仍占原 46px 槽、既不位移也不放大，放大后身体压到气泡上（真机实测重叠）。
  正解：气泡+身体包进 `.cs-pet-unit`，对**单元**用 CSS 独立变换属性 `scale: var(--cs-pet-k)`——
  flex 让气泡随之等比位移+放大、间距按比例撑开，身体自身 transform 动画不受影响（独立属性与 transform 叠加）；
  菜单留在单元外不跟着缩（拖它自己的滑块时不自我缩放）。`getBoundingClientRect()` 反映 scale，拖拽/夹子无需特判。
  量几何做断言前要等 `.12s` scale 过渡落定，否则读到中间值（w1==w2 的假阴性）。（独立 scale 属性 Chrome 104+，Electron 满足）
- **能缩放就必有上下限夹子**：任何可变大小的浮层都要有下限（桌宠 <30px 点不到、面板窄于内容裁字）
  和上限（桌宠盖住工作区、面板超出窗口）。桌宠 clamp 的边距曾硬编码 `56`（=身体 46+10）；身体一旦能缩放，
  边距必须跟着 `Math.round(46*k)+10` 走，否则放大后掉出屏幕右下角「消失」。
- **功能面板给等比缩放，装饰件给连续自由拉**：桌宠（个人化、图片比例千奇百怪）用滑块连续拉；
  悬浮窗（功能列表、宽度由内容定）不做自由拉宽（收益低、易崩版），改成 `transform: scale` 整体等比缩放
  `#coskin-ui`（`transform-origin: bottom right`，不 reflow、不崩版），同一根滑块只动一个 `--cs-panel-k`。
- **写进官方 DOM 的每一笔都要记账**：给标题列/帽子写过的 `position/isolation/transform` 等内联样式，
  还原时按 `data-csPrev*` 逐笔恢复。「还原即原样」是可断言的契约。

### 首页卡片（真机结构）
- 卡片是 `flex-col justify-center`，但文字那层带 **`mt-auto`** 被推到底、图标壳 `size-6`(24px) 贴顶留大空档。
  要图标与文字靠拢居中：`svg` 放大（40px）、`span:has(>svg)` 自适应居中、`[class*=mt-auto]` 收掉自动上边距。
- **卡片定制按「原文」匹配，不按位置**：点开卡片后同一批按钮槽会被二级条目复用，按位置替换会把
  戒条盖到二级推荐上。用 `decor.cards[{match[],glyph,lines}]` + `subCards`；首次见到存 `data-cs-orig`
  原文快照，之后一直用快照认卡；匹配不到=保持官方原文（防污染）。
- **文字被拆成多个 span**：二级条目是「前缀高亮 span + 正文 span」，按「最长文字段」匹配拿不到前缀词。
  必须按**整个按钮的原始文本**匹配。
- **字段透传要逐项核对**：`subCards` 规则组装时漏拷 `glyph` 字段 → 二级条目的字不出现。

### 判定 / 兜底
- **深浅判定要有「纸色守卫」**：浅底大墨块的图均值亮度会过线。主色饱和度低且不暗 → 按纸面处理；
  面板留手动翻转。算法永远要有逃生门。
- **官方外观开关是 `html.electron-light/dark`**：随主题同步翻转根治代码高亮错配，还原恢复原类。
- **阅读面板（Review/文档）是背景全透明的 CodeMirror**（`.cm-editor`）：给它不透明特权，
  文字不浮在壁纸上，滚动不再忽糊忽清。

### 能力边界 / 环境
- **Codex 页面被 CSP 挡着，不能 `fetch` GitHub**（实测 `Failed to fetch raw.githubusercontent`）。
  所以「纯面板自查更新」做不到——版本检测走 Node（应用时查一次带进面板），更新走 `git pull`（双击脚本）。
- **页面既不能跑 git 也不能读磁盘**：想「面板一键拉取更新」需要常驻本地服务，
  为安全（无鉴权常驻服务）刻意不做；把更新压成一次双击（`双击换肤` 里就带 `resume --update`）。
- **面板 ↔ CLI 的存储不对称**：磁盘自定义主题两边都可见（switcherPayload 带全部磁盘 custom）；
  但面板用 localStorage 存的（快捷槽/导入主题）CLI 读不到（Node 访问不了浏览器存储）。这是设计遗留。

### 分发 / 版权
- **IP 角色美术不进公开仓库**：AI 生成不改变「画的是谁」。用户的自定义壁纸（动漫角色）放 `themes/custom/`
  （gitignore），公开仓库的同名内置主题用**纯渐变 + 全套 decor**；真图版走 `.coskin` 点对点分享（个人使用）。
- **`.coskin` 是 JSON 文件**（`format:"coskin-theme"`）：配色+decor+壁纸 base64 内嵌；导入 id 自动去重。

## 入口与更新模型（v0.29.0：清爽版 + 排错版，装技能收进 node）

**核心动作统一为 `resume --update`**（`git pull --ff-only` 失败不致命 + 重上「上次用过的主题」，记在 gitignore 的
`.coskin-state.json`）；Codex 关着时直接调试模式启动上肤、零提示，开着时只问一句「重启吗？」。
每平台两个入口，做的完全一样，只差有没有终端窗口：
- **清爽版**（推荐，可钉 Dock/任务栏、无窗口、`--gui`）：mac `CoSkin.app`、win `双击换肤(无窗口).vbs`。
- **排错版**（显示进度，方便排错）：mac `双击换肤.command`、win `双击换肤.bat`。
- **装技能收进 node**（v0.29.0）：`ensureSkillInstalled()` 跨平台、幂等（dst 含当前 ROOT 就跳过）、
  **先把模板读进内存再写 dst**（读不到就抛、绝不截空已装好的文件——正是修 shell `sed>file` 那个坑）。
  在 `resume()`/`menu()` 开头调用，四种入口共用一份，`.vbs` 因此不必自己实现装技能。
- **不再开终端菜单**：换主题 / 自定义配色 / 导入导出 / 还原，全在 Codex 右下角 🎨 面板里（面板已能做全部）。
  `node coskin.mjs menu` 仍保留给 CLI 老流程，但入口文件不再调它。
- 合并动机：面板功能追平后，「双击换肤(菜单)」和「一键换肤(resume)」的差别消失——一个文件即 启动+更新+使用。
- **为什么不能"开 Codex 就自动上肤"**：正常启动的 Codex 没有调试端口，CDP 无从注入（同 Claude Desktop 的加固边界）。
  只能反过来——让「双击换肤」当**你点开 Codex 的那个入口**（它替你以调试模式启动带皮肤的 Codex）。
  常驻守护进程能做但违背「仅会话 / 不常驻 / 不静默重启」三铁律，不做。
- **`.app` 清爽启动器（v0.28.0）**：`CoSkin.app`（放仓库内，靠自身位置 `../../..` 找仓库根）= 无终端窗口地
  `resume --update --gui`，可钉 Dock。`LSUIElement=true` 让它跑完不留 Dock/切换器残影。node 发现要手动补
  nvm/homebrew/volta（GUI App 的 PATH 很干净），找不到 node 直接 osascript 弹窗。ZIP 下载会丢 +x 位、须 `chmod +x`。
- **运行环境自举（v0.31.0）——「全新电脑只装了 Codex 也能双击即用」**：
  `scripts/ensure-node.sh`（mac/Linux）与 `scripts/launch.ps1`（win）三级解析 Node：
  ① 自带副本 → ② 系统 node（含 nvm/homebrew/volta）→ ③ **免密下载官方绿色版**。
  - **免 root 的关键**：只写 `~/.coskin/node`（win `%LOCALAPPDATA%\CoSkin\node`），绝不碰 `/usr/local` 等系统路径 → 不弹密码/UAC。
  - **裸机可用的工具链**：macOS 自带 `curl`/`tar`/`shasum`；Windows 自带 PowerShell `Invoke-WebRequest`/`Expand-Archive`。不需要预装任何东西。
  - **完整性**：从 `latest-v22.x/SHASUMS256.txt` 取包名+官方哈希（不硬编码版本，不会过期），下完 `shasum -a 256` 比对，不符即丢。
  - **只解 `*/bin/node`**：CoSkin 零依赖，不要 npm/头文件 → 磁盘 187MB 降到 **108MB**。实测下载+校验+解压 **8.8 秒**。
  - 无窗口启动器没有终端，下载期间用 `osascript display notification` 报进度，否则看起来像卡死。
  - **借 Codex 自带 Node 走不通**：`ELECTRON_RUN_AS_NODE=1` 对 ChatGPT.app 无效（转发给已运行实例），
    说明 Codex 也关掉了 Electron 的 `runAsNode` 保险丝——和 Claude Desktop 同一种加固。
- **ZIP 分发实测可行**：`git archive`（=GitHub Download ZIP）会把 `755` 写进包；
  **访达/`ditto` 解压后中文名与可执行位都完好**，`.command`/`.app` 直接可双击，不需要 `chmod`。
  但**命令行 Info-ZIP `unzip` 会把中文名弄成乱码并丢权限**——文档里明确让用户用访达解压。
  ZIP 装的没有 `.git`：`resume --update` 检测到就跳过 git 并提示"重新下载新 ZIP"，不再吐 `not a git repository` 的原始报错。
- **Windows 没有 `.app`**：等价物是 `双击换肤(无窗口).vbs`（`WScript.Shell.Run(..., 0, True)` 隐藏窗口跑
  `resume --update --gui`；先 `where node` 查不到就 MsgBox）。确认/报错走 `--gui` 的 PowerShell MsgBox。
  `.vbs` 的中文 MsgBox 有编码风险、且 Windows 端整体尚未在真机充分验证——已在文件头与 README 标注。

## localStorage 键一览（页面侧持久化）

`coskin.quickSlot.v5`（图片快捷槽）、`coskin.imported.v1`（导入的主题数组）、
`coskin.hidden.v1`（面板删除=软隐藏的内置/磁盘主题）、`coskin.decorOverride.v1`（顶栏标题编辑覆盖）、
`coskin.pet.v1`（桌宠开关）、`coskin.pet.pos.v1`（桌宠拖拽位置）、`coskin.pet.image.v1`（自定义形象快照）、
`coskin.pet.scale.v1`（桌宠大小 0.7–2.6×）、`coskin.panel.size.v1`（悬浮窗大小 0.85–1.6×）、
`coskin.customPalette.v1`（自定义配色 live 槽：4 种子色 + 深浅，注入时恢复成 `custom` 主题）。

## 路线图状态（差异化四条）

| 方向 | 状态 |
| --- | --- |
| ① 可读性工程 | ✅ 最扎实卖点：对比度兜底 / 纸色守卫 / 可见度四档（含原图纯水玻璃）/ 阅读面板特权 |
| ② 分发闭环 | ✅ `.coskin` 单文件 + CLI/面板 导出导入删除 + Codex skill 自动安装 + 一键更新 + **面板内 live 配色编辑器**（4 色轮 + hex 输入 + 🎲随机 + ↺复位，实时改整套主题→"存为我的主题"进列表，可导出分享）+ `CoSkin.app` 图标 + README 主题画廊（`docs/gallery/themes.png`，从主题 JSON 渲染，自包含） |
| ③ 跨工具 | ⏳ 未动工。已探明 **Claude Desktop 加固、CDP 端口打不开**（`open --args`/直调二进制都没监听、无 DevTools 日志）→ 现有机制走不通；真正务实目标是 **Cursor/Windsurf/Kiro 等 VS Code(Electron) 分支**（CDP 注入 or VS Code 扩展加载 CSS） |
| ④ 会动的皮肤 | 🌱 桌宠：主题驱动 + 可拖 + 状态感知(working/done) + 自定义形象 + 连续缩放(滑块 0.7–2.6×)；悬浮窗也可等比缩放(0.85–1.6×)。**下一步接真机 error DOM**（出错变色） |

## 审查遗留三债（v0.26.1 已还清）

- ✅ **RESTORE 复活竞态 + 闭包滞留**：注入端加**代际标记** `window.__coskinGen`（每次注入/还原自增），
  `setTheme` 开头 `if (__coskinGen !== __GEN) return` 一道门挡下所有过期回调（图片上传/导入 `.coskin` 落定即便触达也不复活）；
  RESTORE 里 `delete` 掉全部注入期闭包（`__coskinSetTheme`/`__coskinQuickFromDataUrl`/`__coskinState`…），释放含 base64 壁纸的 THEMES。
- ✅ **多窗口部分失败不再静默**：`injectEverywhere` 回传 `failures[]`，`applyTheme`/`restore` 用 `warnPartialFailure` 逐窗口报告（成功的照常生效）。
- ✅ **`apply --spec` 壁纸校验补齐**：抽出 `assertImageFile`（后缀+非空+≤8MB），`--image` 与 `--spec` 共用，spec 路径不再漏检。
