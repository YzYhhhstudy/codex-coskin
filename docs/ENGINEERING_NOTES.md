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
- **模拟页验证 ≠ 真机**：mock 锁回归（60+ 断言、还原逐项回基线），但真机 DOM 总有惊喜。
  每次真机反馈 → 先只读侦察 → 再把新结构+新断言补进 mock。

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
  为安全（无鉴权常驻服务）刻意不做；把更新压成一次双击（`一键换肤` = `resume --update`）。
- **面板 ↔ CLI 的存储不对称**：磁盘自定义主题两边都可见（switcherPayload 带全部磁盘 custom）；
  但面板用 localStorage 存的（快捷槽/导入主题）CLI 读不到（Node 访问不了浏览器存储）。这是设计遗留。

### 分发 / 版权
- **IP 角色美术不进公开仓库**：AI 生成不改变「画的是谁」。用户的自定义壁纸（动漫角色）放 `themes/custom/`
  （gitignore），公开仓库的同名内置主题用**纯渐变 + 全套 decor**；真图版走 `.coskin` 点对点分享（个人使用）。
- **`.coskin` 是 JSON 文件**（`format:"coskin-theme"`）：配色+decor+壁纸 base64 内嵌；导入 id 自动去重。

## 入口与更新模型（v0.23 定稿）

**每平台只有 2 个双击文件**，把用户接触面压到最小：
- `双击换肤`：查一次技能是否已装（`grep -qF $DIR`，已装且路径对则跳过，路径变则自愈重装）→ 打开菜单。
- `一键换肤`：`resume --update` = `git pull --ff-only`（失败不致命，跳过继续）+ 重上「上次用过的主题」
  （记在 gitignore 的 `.coskin-state.json`）。Codex 关着时直接调试模式启动上肤，零提示。
- 没有专门的「还原」文件：面板「官方原生」或关掉 Codex 即还原。更新/装技能已并入上面两个。

## localStorage 键一览（页面侧持久化）

`coskin.quickSlot.v5`（图片快捷槽）、`coskin.imported.v1`（导入的主题数组）、
`coskin.hidden.v1`（面板删除=软隐藏的内置/磁盘主题）、`coskin.decorOverride.v1`（顶栏标题编辑覆盖）、
`coskin.pet.v1`（桌宠开关）、`coskin.pet.pos.v1`（桌宠拖拽位置）。

## 路线图状态（差异化四条）

| 方向 | 状态 |
| --- | --- |
| ① 可读性工程 | ✅ 最扎实卖点：对比度兜底 / 纸色守卫 / 可见度四档（含原图纯水玻璃）/ 阅读面板特权 |
| ② 分发闭环 | ✅ `.coskin` 单文件 + CLI/面板 导出导入删除 + Codex skill 自动安装 + 一键更新 |
| ③ 跨工具 | ⏳ 未动工。已探明 **Claude Desktop 是 Electron、可 CDP 注入**（见 PLATFORM-PLAN）；定位级机会 |
| ④ 会动的皮肤 | 🌱 桌宠已主题驱动（可拖/翻边/台词轮播/配色随主题）；**下一步接 agent 状态**（跑任务呼吸、出错变色） |

## 已知待办（多智能体审查遗留，仍未修）

- RESTORE 后 `window.__coskinSetTheme` / `__coskinQuickFromDataUrl` / `__coskinState` 等全局闭包仍存活：
  ① 在途图片上传落定会「复活」皮肤（还原后 1-2 秒竞态）；② 闭包持有含 base64 壁纸的 THEMES，每窗口滞留数 MB。
  修法：RESTORE 里 delete 这些全局 + 注入代际标记拒绝过期回调。
- 多窗口 apply/restore 的部分失败被静默吞（`failed` 计数无人消费），成功提示可能误导。
- `apply --spec` 的 wallpaper 分支只查扩展名不查 8MB/空文件（面板/CLI import 已查；spec 路径漏）。
