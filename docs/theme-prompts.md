# CoSkin 提示词库

两类提示词，对应两条「做主题」的路：

- **一句话 → 主题**：让任何 AI（Claude / Codex / ChatGPT）把一句描述变成 spec JSON，
  `node src/coskin.mjs apply --spec 文件.json` 直接上身。不需要生图，秒出。
- **一句话 → 壁纸 → 主题**：先用生图模型出一张干净壁纸，再走图片通道
  （🎨 面板上传，或 `apply --image`），取色和全套控件配色自动完成。

## 一、spec 生成提示词（一句话 → 全控件主题）

把下面整段复制给任何 AI，替换最后的描述：

```text
你是配色设计师。把最后那句描述变成一个主题 spec，只输出 JSON，不要解释：

{
  "name": "主题名（跟随描述语言）",
  "appearance": "dark 或 light",
  "palette": {
    "accent": "#rrggbb",      // 唯一主强调色：按钮、链接、选中态、光标都用它
    "secondary": "#rrggbb",   // 辅助色：图表、次要高亮，与 accent 拉开色相
    "surfaceTint": "#rrggbb", // 界面底色的色相种子：深色主题给暗色，浅色主题给亮色
    "ink": "#rrggbb"          // 可选：正文文字色倾向（工具会自动做对比度兜底）
  },
  "background": {
    "css": "2~4 层 CSS 渐变（radial-gradient / linear-gradient / repeating-linear-gradient 组合），呼应描述的气质；禁止 url()、禁止图片"
  },
  "decor": {
    "brand": "首页横幅上的品牌短语（2~6 字）",
    "tagline": "首页横幅主标语（一句，呼应描述的气质）",
    "sub": "横幅副行（可选）",
    "quotes": ["桌宠轮播台词 3~5 条，短句，有性格"],
    "cards": [{ "match": ["Explore and understand", "探索并理解"], "glyph": "酒", "lines": "上行保留原功能语义\\n下行写主题戒条/风味" }],
    "subCards": [{ "match": ["learn how a feature works"], "lines": "点开卡片后的二级条目定制（按原文关键词匹配，匹配不到的保持官方原文）" }],
    "focus": "横幅右侧人物切图焦点（可选），如 50% 62%——第一个数左右、第二个数上下"
  }
}

要求：颜色克制、成体系，像一个真正的编辑器主题而不是海报；深色主题的
surfaceTint 明度要低（大约 #101020~#303040 区间），浅色反之；accent 要能在
surfaceTint 铺出的底色上看得清。描述：【宣纸水墨禅意，朱砂点睛】
```

拿到 JSON 存成文件（如 `~/mytheme.json`），然后：

```bash
node src/coskin.mjs apply --spec ~/mytheme.json
```

内置的「宣纸 Rice-Paper」就是用上面那句示例描述生成的，效果见 docs/verify/04-xuanzhi.png。
没给 `background.css` 时工具会用种子色自动合成一套渐变底，所以 palette 四个色就够成一个主题。

## 二、壁纸生成提示词（一句话 → 干净底图）

构图五规矩（参考 HeiGe 与 Dream-Skin 社区经验，实测有效）：

1. **16:9、2560×1440**，提示词和生成器参数都要写；
2. **画面必须干净**：`no text, no watermark, no logo, no UI` 必须写进提示词；
3. **主体放右三分之一**，左侧留大面积安全区给侧栏和对话区；
4. **人物一律原创虚构**，公开分发不碰真人和版权角色；
5. **亮度配外观**：深色图配 dark、浅色配 light（CoSkin 会自动判断）。

万能模板（中括号处替换）：

```text
2560x1440 wallpaper, 16:9, 【主体与风格：original fictional ..., 场景, 材质】,
subject on the right third of the frame, generous negative space on the left,
【色板：dominant colors ...】, 【气氛：mood ...】, high detail, clean composition,
no text, no watermark, no logo, no UI elements
```

两套现成示例：

**赛博雨夜**（dark）：
```text
2560x1440 cyberpunk city wallpaper, 16:9, rain-soaked neon metropolis at night viewed from a rooftop, glowing holographic waves between skyscrapers on the right third, electric blue and magenta palette with teal reflections, left side fading into dark mist for negative space, cinematic atmosphere, high detail, no text, no watermark, no logo, no UI elements
```

**水墨留白**（light）：
```text
2560x1440 chinese ink painting wallpaper, 16:9, minimalist shan-shui landscape with bold ink strokes forming distant peaks on the right, vast empty rice-paper white space on the left, a tiny boat on calm water, one accent of vermilion seal-red, elegant negative space composition, subtle paper texture, no text, no calligraphy, no watermark, no logo, no UI elements
```

生成后检查：比例 16:9、无文字水印、主体不在正中间、亮度和想要的外观一致，
然后 🎨 面板「＋ 用图片做主题」上传即可。

## 附：为什么 CoSkin 的主题会「全控件生效」

CoSkin 不是把壁纸糊上去再逐个刷选择器，而是把 spec 编译成对 Codex 官方设计
令牌体系的整套覆写（`--color-token-*`、`--color-*`、`--vscode-*`，约 110 个变量，
实测清单见 [codex-token-inventory.json](codex-token-inventory.json)）——菜单、滚动条、
diff 红绿、终端 ANSI 16 色、深浅外观类都由官方变量驱动，所以全部自动跟随主题，
且对 Codex 升级更有韧性。
