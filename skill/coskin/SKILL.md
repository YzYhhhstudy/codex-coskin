---
name: coskin
description: Use when 用户想给 Codex Desktop 换肤、还原官方界面、用图片或一句话做主题、导入/导出 .coskin 主题文件、检查更新（macOS 与 Windows）。
---

# CoSkin — Codex Desktop 换肤

仓库路径（安装时写入）：`__COSKIN_ROOT__`。所有命令用已验证的 Node.js 22+ 运行。
命令本身**跨平台**（同一份 `src/coskin.mjs`）；只有把 Codex 拉起来那层分平台：
macOS 完整支持、Windows 支持独立安装版（Store/MSIX 版暂不支持）。

## 铁律（必须遵守）

1. **Codex 正在运行时，任何会重启它的操作必须先当面征得用户同意**。工具自带同意门：
   交互式会问 y/N；非交互式会直接拒绝。除非用户明确说"同意重启"，否则**不得**用
   `--restart-ok` 绕过。
2. 皮肤**仅当前会话有效**：正常重启 Codex 即完全回到官方原样，没有常驻进程。
   这是安全特性，不要试图"帮用户"做成常驻。
3. `status` 是只读检查，不得用 apply/restore 代替它。失败后不要无界重试，保留报错原文。
4. CDP 只监听 127.0.0.1:9341，无鉴权——不要建议用户改绑其他地址。

## 命令

```bash
node __COSKIN_ROOT__/src/coskin.mjs list                 # 列出主题
node __COSKIN_ROOT__/src/coskin.mjs apply <id>           # 应用主题（运行中会先征求重启同意）
node __COSKIN_ROOT__/src/coskin.mjs apply --image <图片> [--name 名字]   # 一张图变主题
node __COSKIN_ROOT__/src/coskin.mjs apply --spec <spec.json>            # 一句话主题（spec 见下）
node __COSKIN_ROOT__/src/coskin.mjs import <文件.coskin.json>           # 导入别人分享的主题
node __COSKIN_ROOT__/src/coskin.mjs export <id> [--out 路径]            # 导出主题为单文件分享
node __COSKIN_ROOT__/src/coskin.mjs resume               # 一键重上"上次用过的主题"（日常最快上肤）
node __COSKIN_ROOT__/src/coskin.mjs update               # git pull 拉最新 + 自动重新应用
node __COSKIN_ROOT__/src/coskin.mjs restore              # 还原官方界面
node __COSKIN_ROOT__/src/coskin.mjs status               # 只读状态
```

Windows 上把路径分隔符换成 `\`（如 `node __COSKIN_ROOT__\src\coskin.mjs list`）。

傻瓜入口（双击就打开带皮肤的 Codex：更新 + 恢复上次主题 + 自动装技能）：
- macOS：`CoSkin.app`（清爽、可钉 Dock、无终端）或 `双击换肤.command`（显示进度）。
- Windows：`双击换肤(无窗口).vbs`（清爽、可钉任务栏）或 `双击换肤.bat`（显示控制台）。
- 底层都是 `node src/coskin.mjs resume --update`（清爽版加 `--gui`：确认/报错走系统弹窗）。
- 换主题 / 自定义配色 / 导入导出都在 Codex 右下角 🎨 面板里。技能安装由 node 侧 `ensureSkillInstalled` 幂等完成。

## 按用户意图分派

- 用户给**一张图** → `apply --image`（自动取色、判深浅、全控件配色）。
- 用户给**一句话描述** → 按 `__COSKIN_ROOT__/docs/theme-prompts.md` 的 spec 模板生成
  spec JSON（palette 四色 + decor 文案/台词/卡片字），存临时文件后 `apply --spec`。
- 用户给 **.coskin.json** → `import` 后按其输出的 id `apply`。
- 用户要**分享主题** → `export <id>`，把生成的文件路径告诉用户。
- 应用后提醒：右下角 🎨 面板可秒切主题、调背景四档（原图/沉浸/氛围/含蓄）、翻转深浅、开关桌宠；
  顶栏主题标题点击可编辑。
