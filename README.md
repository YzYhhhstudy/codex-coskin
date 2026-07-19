# CoSkin — 给 Codex Desktop 一键换肤（token 编译器）

写代码的地方，也该顺眼。CoSkin 通过**本机回环 CDP 注入**给 Codex Desktop（macOS 上就是
`/Applications/ChatGPT.app`，bundle id `com.openai.codex`）换肤：不改 `app.asar`、不动签名、
不装常驻进程，正常重启一次 Codex 就完全回到官方原样。

**v0.3 起不是「换壁纸」而是「接管调色板」**：一张图片或一句话被编译成对 Codex 官方设计
令牌（`--color-token-*` / `--color-*` / `--vscode-*`，约 110 个变量）的整套覆写——侧栏、
菜单、按钮、滚动条、diff 红绿、内嵌终端的 ANSI 16 色、深浅外观类，**每个控件**都跟随主题，
且自动做对比度兜底。官方 token 清单为真机实测（[docs/codex-token-inventory.json](docs/codex-token-inventory.json)）。

四套内置主题全部是**纯 CSS 渐变**（零素材、零版权风险）；「宣纸 Rice-Paper」由一句
「宣纸水墨禅意，朱砂点睛」生成，是「一句话 → 主题」通道的示例。

> 状态：机制与控件级接管已在隔离环境验证（60+ 项断言，见 `docs/verify/`），代码零依赖（Node 22+）。
> 目前仅 macOS（Windows 待做）。需要已装好的 Codex Desktop（即 `/Applications/ChatGPT.app`）。

## 安装（第一次用）

需要 macOS + [Node.js 22+](https://nodejs.org) + Codex Desktop。

```bash
git clone https://github.com/YzYhhhstudy/codex-coskin.git
cd codex-coskin
# macOS 会给下载的脚本加隔离标记，先解除（只需一次）：
xattr -dr com.apple.quarantine .
```

然后**双击 `双击换肤.command`**（或终端 `node src/coskin.mjs menu`）。零依赖、不用 `npm install`。

## 傻瓜式上手（3 步）

1. **双击 `双击换肤.command`**（第一次 macOS 可能提示右键 → 打开）。
2. 在菜单里**输入主题编号，回车**。
3. 如果 Codex 正在运行，工具会先问你「现在重启它吗？」——**输 `y` 回车**即可
   （对话记录会保留，Codex 自动恢复；不同意就什么都不会动）。

装完后 Codex **右下角会出现一个 🎨 按钮**：点开就是主题面板，内置主题之间**免重启秒切**，
随时可点「官方原生」还原。面板下方还有两组即点即变的旋钮：

- **背景：原图 / 沉浸 / 氛围 / 含蓄** —— 一根轴调「看图」还是「干活」：
  「原图」零雾纱零幕布、主区全透、边框几乎消失（内容浮在玻璃岛上）；「沉浸」轻纱；
  「氛围」均衡日常；「含蓄」稳重。代码/编辑器区任何档位都保持不透明，可读性优先。
- **外观：深 / 浅** —— 自动判定错了（比如浅色宣纸图配大片墨色）一键翻转，
  Codex 自身的深浅模式跟着走。
- **桌宠：开 / 关** —— 一只纯 CSS 画的小生物（呼吸浮动、眨眼、轮播 `decor.quotes` 台词），
  颜色吃主题强调色，**抓住身体可以拖到屏幕任何位置**（位置会记住，靠左时气泡自动翻边）。
- **首页装饰**（检测到首页时自动出现，离开自动收起）：顶栏中央一行**主题名 · 标语**
  （来自 `decor` 字段）；官方的图标 + "What should we work on…" 标题被一块**艺术标题板**
  框成独立板块——图片主题会截取壁纸人物做板底（`decor.focus` 可调裁切焦点）。
  装饰层不挡任何操作，还原时连同定时器一并拆除（有回归断言）。
- **阅读面板特权**：Review/文档面板（CodeMirror）在任何档位都保持不透明底——
  文字永远不浮在壁纸上，滚动不再忽糊忽清。

### 用自己的图片换肤（两条路）

**面板直传（最快）**：🎨 面板里点「＋ 用图片做主题」→ 选一张图 → 完事。压缩、取色、
深浅外观、可读性薄纱全自动。这是一个**快捷槽**：存在 Codex 本地（localStorage），
重复上传会覆盖，下次注入面板时自动回到列表。

**终端菜单（可长期保存多套）**：`双击换肤.command` 里选「用我自己的图片做主题…」→
把图片拖进终端窗口回车 → 起名。生成的是正式主题文件，保存在 `themes/custom/`，
可备份、可分发，以后菜单里一直有。

两条路都支持 PNG / JPG / WebP（终端路径 ≤8MB）。

### 用一句话换肤（不用图片）

把 [docs/theme-prompts.md](docs/theme-prompts.md) 里的「spec 生成提示词」丢给任何 AI，
换上你的一句描述（比如「宣纸水墨禅意，朱砂点睛」），它会吐一个 spec JSON。然后：

```bash
node src/coskin.mjs apply --spec ~/mytheme.json
```

palette 四个种子色就够编译出全套控件配色；不给背景时会自动合成配套渐变。

### 分享主题（单文件，发给谁都能用）

菜单里选「导出主题为 .coskin 文件」——整套主题（配色、横幅文案、卡片字与戒条、桌宠台词、
壁纸本体）打成**一个 `.coskin.json` 文件**，微信/网盘随便发。对方在菜单选
「导入 .coskin 主题文件」拖进来即装（id 自动去重，绝不覆盖已有主题）。命令行等价：

```bash
node src/coskin.mjs export c-652ba90b            # → output/正是修行时.coskin.json
node src/coskin.mjs import ~/Downloads/xx.coskin.json
```

### 装成 Codex 技能（对话式换肤）

双击 `安装到Codex技能.command`，CoSkin 会注册为 Codex 的 skill（`~/.agents/skills/coskin/`）。
之后直接对 Codex 说「换个赛博朋克主题」「导入这个 .coskin 文件」它就会操作 CoSkin——
技能规程里写死了安全铁律：重启必须当面征得同意、皮肤仅当前会话、status 只读。

### 还原官方界面（三选一）

- 右下角 🎨 面板里点「官方原生」；
- 双击 `还原官方.command`；
- 什么都不做，正常重启一次 Codex —— 皮肤只存在于当前会话（MVP 不做常驻，这是安全特性）。

## 命令行用法

```bash
node src/coskin.mjs menu                     # 交互菜单（.command 双击的就是它）
node src/coskin.mjs apply nebula             # 内置主题：nebula / daybreak / matcha / xuanzhi
node src/coskin.mjs apply --image ~/x.jpg --name 我的壁纸
node src/coskin.mjs apply --spec ~/mytheme.json   # 一句话→AI 产出 spec→主题
node src/coskin.mjs restore                  # 还原官方
node src/coskin.mjs status                   # 查看运行/注入状态
node src/coskin.mjs launch --restart-ok      # 需要时允许自动重启 Codex（脚本场景）
```

Codex 在运行时，任何会触发重启的命令都会**先当面征得同意**（`--restart-ok` 视为提前授权）。

## 定制化流水线（分级实现，逐级完善）

| 级 | 职责 | 状态 |
| --- | --- | --- |
| A 外观判定 | 均值亮度 + 纸色守卫（浅底深墨图不误判）；面板可手动翻转 | ✅ v0.4 |
| B 背景层 | 壁纸/渐变 + 可见度档位（沉浸/氛围/含蓄 → 表面透明度）+ 可读性薄纱与幕布 | ✅ v0.4 |
| C 色板 | 图片取色 / 一句话 spec / 手写种子色（accent·secondary·surfaceTint·ink） | ✅ v0.3 |
| D token 编译 | 种子色 → 官方 ~110 变量（含终端 ANSI16、diff、滚动条），WCAG 对比度兜底 | ✅ v0.3 |
| E 控件设计 | 玻璃卡片、描边、圆角、强调条、焦点环、悬浮态；后续加卡片风格预设/图标点缀 | 🚧 基础版 |
| F 细节 | 选区、光标、滚动条、状态色；后续加动效、粒子、会话状态感知 | 🚧 基础版 |

每一级都是独立函数，能单独调；spec 里给对应字段就能覆盖默认行为。

## 工作原理（一段话版）

Codex Desktop 是 Electron 应用。CoSkin 请它以 `--remote-debugging-address=127.0.0.1
--remote-debugging-port=9341` 重启一次，然后通过 Chrome DevTools Protocol 往主窗口注入一段
CSS（主题）和一小段 JS（右下角 🎨 切换面板）。主题 CSS 由 **token 编译器**生成：几个种子色
→ 面/墨/线/语义色/终端 ANSI 的完整色阶（带 WCAG 对比度兜底）→ 覆写 Codex 官方变量体系；
同时把 `html.electron-light/dark` 外观类同步到主题的深浅，代码高亮不再错配。主题切换是
页面内换 CSS，零等待；所有注入可逆，还原时逐项回到基线（回归测试有断言）。

## 已知边界（都是实话）

- 皮肤**不跨重启保留**：刻意不装常驻进程/launch agent，重启即官方原样（安全特性）。
- 外观类同步是会话内的视觉同步，不改 Codex 设置里的持久选项。
- CDP 即使只绑 127.0.0.1 也**没有鉴权**，皮肤会话期间本机同权限进程都能连上这个端口。
  不换肤时正常启动 Codex，端口就不存在。
- Codex 升级如果改了界面结构或启动参数，选择器需要适配（`src/css.mjs` 一处集中维护）。
- 机制验证在隔离的无头 Chromium + 模拟 Codex DOM 上完成（`test/mock-verify.mjs`，
  截图在 `docs/verify/`）；真机 Codex 的选择器已对齐社区逆向成果，首次真机应用后如有出入，
  调 `src/css.mjs` 即可。

## 机制验证截图（控件齐全版模拟页：右侧面板/菜单/diff/终端全部跟随）

| 官方原生基线 | 浅色纸面图（壁纸可见+纸色守卫） | 深色图 · 沉浸档 |
| --- | --- | --- |
| ![native](docs/verify/00-native-baseline.png) | ![sepia](docs/verify/05-sepia-quick.png) | ![dark](docs/verify/05c-dark-immersive.png) |

更多：[01-nebula](docs/verify/01-nebula.png) · [03-immersive](docs/verify/03-immersive.png) · [04-xuanzhi](docs/verify/04-xuanzhi.png) · [06-restored](docs/verify/06-restored.png)

## 目录结构

```
src/coskin.mjs      CLI + 交互菜单
src/launcher.mjs    Codex 启停（重启必须用户同意）
src/cdp.mjs         零依赖 CDP 客户端（Node 22+ 内置 WebSocket/fetch）
src/css.mjs         主题 CSS + 🎨 面板生成（选择器集中在这）
src/palette.mjs     取色（页面内 canvas）+ 配色推导 + 对比度兜底
themes/*.json       内置主题（纯渐变）
themes/custom/      你生成的图片主题（已 gitignore）
test/mock-verify.mjs  全链路回归验证
```

## 致谢与许可

- Codex Desktop 的 DOM 选择器体系参考了 [HeiGeAi/heige-codex-skin-studio](https://github.com/HeiGeAi/heige-codex-skin-studio)（MIT）的逆向成果，特此致谢；
- 亦受 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 开创的玩法启发。

本项目代码 MIT。内置主题为原创纯渐变，不含任何第三方视觉素材。
