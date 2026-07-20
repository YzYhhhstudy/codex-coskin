#!/bin/zsh
# CoSkin 主入口：第一次双击会自动装好 Codex 技能，然后打开换肤菜单
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

node "$DIR/src/coskin.mjs" menu
echo ""
echo "已退出 CoSkin。按回车关闭窗口…"
read -r
