#!/bin/zsh
# CoSkin 唯一入口：双击我 = 启动 Codex（带皮肤）+ 更新到最新 + 恢复你上次用的主题。
# 换主题 / 自定义配色 / 导入导出，全在 Codex 右下角的 🎨 面板里做（不再需要终端菜单）。
# 第一次双击还会自动把 CoSkin 装成 Codex 技能。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$p/node" ]; then PATH="$p:$PATH"; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "没找到 Node.js（需要 22 或更新版本）。装好后再双击我。"
  echo "按回车关闭…"; read -r; exit 1
fi

# 安装 Codex 技能（先查是否已装且路径正确，是则跳过，避免重复写）
DST="$HOME/.agents/skills/coskin"
if [ -f "$DST/SKILL.md" ] && grep -qF "$DIR" "$DST/SKILL.md" 2>/dev/null; then
  echo "✅ Codex 技能已安装（可直接对 Codex 说「用 coskin 换个主题」）"
else
  mkdir -p "$DST"
  if sed "s|__COSKIN_ROOT__|$DIR|g" "$DIR/skill/coskin/SKILL.md" > "$DST/SKILL.md" 2>/dev/null; then
    echo "✅ 已安装 Codex 技能（可直接对 Codex 说「用 coskin 换个主题」）"
  fi
fi
echo ""

# 启动 Codex（关着会自动以调试模式打开）+ 拉最新代码 + 重上你上次用过的主题
node "$DIR/src/coskin.mjs" resume --update
echo ""
echo "🎨 换主题 / 自定义配色 / 导入导出，点 Codex 右下角的 🎨 按钮就行。"
echo "按回车关闭窗口…"
read -r
