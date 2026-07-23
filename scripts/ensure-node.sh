#!/bin/sh
# CoSkin 运行环境自举（macOS / Linux）
#
# 目标：全新电脑上只装了 Codex、连 Node 都没有时，双击 CoSkin 也能直接跑起来。
# 优先级：① ~/.coskin 里的自带副本 → ② 系统 node（含 nvm/homebrew/volta）→ ③ 免密下载官方绿色版。
#
# 关键：③ 只往 **用户目录** ~/.coskin/node 写，绝不碰 /usr/local 之类的系统路径，
#      所以**不需要 root、不需要输密码**。卸载 = 删掉 ~/.coskin 就干净了。
#      下载的包会用 nodejs.org 官方 SHASUMS256 校验，不匹配就丢弃。
#
# 输出：stdout = 可用的 node 可执行路径；进度/错误走 stderr；失败退出码非 0。
# 用法：NODE="$(sh scripts/ensure-node.sh)" || 处理失败
# 测试钩子：COSKIN_FORCE_DOWNLOAD=1 跳过 ①②，强制走下载路径。

MIN_MAJOR=22
COSKIN_HOME="${COSKIN_HOME:-$HOME/.coskin}"
NODE_DIR="$COSKIN_HOME/node"

log() { printf '%s\n' "$*" >&2; }
# 无窗口启动器（CoSkin.app）没有终端，进度只能靠系统通知
notify() {
  [ "$(uname -s)" = "Darwin" ] || return 0
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"$1\" with title \"CoSkin\"" >/dev/null 2>&1 || true
}

ver_ok() {
  [ -x "$1" ] || return 1
  v=$("$1" -v 2>/dev/null) || return 1
  maj=${v#v}; maj=${maj%%.*}
  case "$maj" in "" | *[!0-9]*) return 1 ;; esac
  [ "$maj" -ge "$MIN_MAJOR" ]
}

if [ -z "$COSKIN_FORCE_DOWNLOAD" ]; then
  # ① 之前装过的自带副本
  if ver_ok "$NODE_DIR/bin/node"; then printf '%s\n' "$NODE_DIR/bin/node"; exit 0; fi

  # ② 系统 node：PATH 里没有就把 nvm / homebrew / volta 的常见位置补上再找
  if ! command -v node >/dev/null 2>&1; then
    # shellcheck disable=SC1091
    [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  fi
  sys="$(command -v node 2>/dev/null)"
  for cand in "$sys" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
    [ -n "$cand" ] || continue
    if ver_ok "$cand"; then printf '%s\n' "$cand"; exit 0; fi
  done
fi

# ③ 免密下载官方绿色版到用户目录
case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) log "❌ 暂不支持的系统：$(uname -s)"; exit 1 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) log "❌ 暂不支持的架构：$(uname -m)"; exit 1 ;;
esac

log "首次运行：没找到 Node ${MIN_MAJOR}+，正在准备运行环境（约 50MB，只此一次）。"
log "装到 $NODE_DIR —— 只写你的用户目录，不需要密码。"
notify "首次运行：正在准备运行环境（约 50MB）…"

tmp="$(mktemp -d)" || { log "❌ 无法创建临时目录"; exit 1; }
# shellcheck disable=SC2064
trap "rm -rf '$tmp'" EXIT INT TERM

base="https://nodejs.org/dist/latest-v${MIN_MAJOR}.x"
if ! curl -fsSL --max-time 60 "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"; then
  log "❌ 连不上 nodejs.org（检查网络后重试）"; exit 1
fi
pkg=$(grep -o "node-v[0-9.]*-${os}-${arch}\.tar\.gz" "$tmp/SHASUMS256.txt" | head -1)
[ -n "$pkg" ] || { log "❌ 没找到匹配的安装包（${os}-${arch}）"; exit 1; }
want=$(grep " $pkg\$" "$tmp/SHASUMS256.txt" | awk '{print $1}' | head -1)

log "下载 $pkg …"
if ! curl -fL --max-time 900 "$base/$pkg" -o "$tmp/$pkg"; then
  log "❌ 下载失败（检查网络后重试）"; exit 1
fi
got=$(shasum -a 256 "$tmp/$pkg" | awk '{print $1}')
if [ "$got" != "$want" ]; then
  log "❌ 校验和不匹配，已丢弃该文件（下载损坏或被篡改）"; exit 1
fi

mkdir -p "$NODE_DIR" || { log "❌ 无法创建 $NODE_DIR"; exit 1; }
# CoSkin 是零依赖的，只需要 node 这一个二进制：官方包里的 npm / C++ 头文件一概不解，
# 磁盘占用从 ~187MB 降到 ~110MB。
if ! tar -xzf "$tmp/$pkg" -C "$NODE_DIR" --strip-components=1 '*/bin/node'; then
  log "❌ 解压失败"; exit 1
fi
if ! ver_ok "$NODE_DIR/bin/node"; then
  log "❌ 装好的 Node 不可用"; exit 1
fi

log "✅ 运行环境就绪（$("$NODE_DIR/bin/node" -v)）"
notify "运行环境就绪，继续换肤…"
printf '%s\n' "$NODE_DIR/bin/node"
