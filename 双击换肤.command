#!/bin/zsh
# CoSkin 傻瓜入口：双击打开交互菜单
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

node "$DIR/src/coskin.mjs" menu
echo ""
echo "已退出 CoSkin。按回车关闭窗口…"
read -r
