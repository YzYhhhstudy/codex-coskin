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

# 启动 Codex（关着会自动以调试模式打开）+ 拉最新代码 + 重上你上次用过的主题
# （装 Codex 技能已收进 node 侧 resume，幂等，不再在这里做）
node "$DIR/src/coskin.mjs" resume --update
echo ""
echo "🎨 换主题 / 自定义配色 / 导入导出，点 Codex 右下角的 🎨 按钮就行。"
echo "按回车关闭窗口…"
read -r
