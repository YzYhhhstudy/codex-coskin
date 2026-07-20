#!/bin/zsh
# CoSkin 一键上肤：直接重上你上次用过的主题（关机/关 Codex 后最快的方式）
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
  echo "没找到 Node.js（需要 22 或更新版本）。"
  echo "按回车关闭…"; read -r; exit 1
fi

node "$DIR/src/coskin.mjs" resume
echo ""
echo "按回车关闭窗口…"
read -r
