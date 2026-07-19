#!/bin/zsh
# 把 CoSkin 装成 Codex 技能：之后直接对 Codex 说「换个赛博朋克皮肤」它就会用 CoSkin
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/.agents/skills/coskin"
mkdir -p "$DST"
sed "s|__COSKIN_ROOT__|$DIR|g" "$DIR/skill/coskin/SKILL.md" > "$DST/SKILL.md"
echo "✅ 已安装 Codex 技能：$DST"
echo "   仓库路径已写入：$DIR"
echo "   现在可以直接对 Codex 说：「用 coskin 给我换个主题」/「导入这个 .coskin 文件」"
echo ""
echo "按回车关闭窗口…"
read -r
