// 主题 CSS 与右下角悬浮切换面板（v0.4：分级流水线）。
//
// 流水线：A 外观判定（纸色守卫+手动翻转）→ B 背景层（可见度档位决定表面透明度）
//        → C 色板 → D token 编译（覆写官方 ~110 变量）→ E 控件设计 → F 细节。
// 面板负载只带 {spec, bg}，CSS 在页面内按当前档位现场编译 —— 可见度/深浅即点即变。
// 结构选择器最初参考 MIT 的 HeiGeAi/heige-codex-skin-studio；token 反推为本项目真机实测。

import { coskinCompileTokens } from "./tokens.mjs";
import { coskinExtractPalette, coskinDecideAppearance } from "./palette.mjs";

// 统一入口（自包含，供两端使用；页面端需先声明 coskinCompileTokens）。
// theme: { id, appearance, palette:{accent,secondary?,surfaceTint?,ink?}, controls?:{visibility} }
// backgroundLayers: 完整 CSS background 值。
export function coskinBuildCss(theme, backgroundLayers) {
  const id = String(theme.id ?? "custom").replace(/[^a-z0-9_-]/gi, "");
  const appearance = theme.appearance === "light" ? "light" : "dark";
  const palette = theme.palette ?? {
    accent: theme.colors.accent,
    secondary: theme.colors.secondary,
    surfaceTint: theme.colors.surface,
    ink: theme.colors.text,
  };
  const controls = theme.controls ?? {};
  const { vars, colors, alpha } = coskinCompileTokens({ appearance, palette, controls });
  const radius = controls.radius ?? 14;
  const a2hex = (a) => Math.round(a * 255).toString(16).padStart(2, "0");
  // 雾纱与幕布都随档位走；原图档（veil=0）完全不加任何遮罩层
  const veilLayer = alpha.veil > 0
    ? "linear-gradient(" + colors.surface + a2hex(alpha.veil) + ", " + colors.surface + a2hex(alpha.veil) + "),\n    "
    : "";
  const scrim = alpha.veil >= 0.3 ? ["e0", "c4"] : alpha.veil >= 0.2 ? ["a8", "8a"] : alpha.veil > 0 ? ["42", "30"] : null;
  const scrimLayers = scrim
    ? "linear-gradient(90deg, " + colors.surface + scrim[0] + " 0 18%, transparent 44%),\n    " +
      "linear-gradient(180deg, transparent 0 46%, " + colors.surface + scrim[1] + " 88% 100%),\n    "
    : "";
  const mainWash = alpha.main > 0
    ? "  background: linear-gradient(180deg, " + colors.surface + "24 0 40%, " + colors.surface + a2hex(Math.min(1, alpha.main + 0.1)) + " 100%) !important;\n"
    : "  background: transparent !important;\n";
  // 原图/沉浸档给主区文字一点投影兜底（卡片外的裸文字也能读）
  const bareTextShadow = alpha.veil <= 0.08
    ? "main.main-surface { text-shadow: 0 1px 4px " + colors.surface + "b3; }\n"
    : "";
  // 原图档=纯水玻璃：只留半透明色，去掉毛玻璃模糊（越透明越透出原画）
  const rawMode = alpha.veil === 0;
  const glass = (px, sat) => rawMode ? "  backdrop-filter: saturate(" + sat + ");\n" : "  backdrop-filter: blur(" + px + "px) saturate(" + sat + ");\n";

  let varBlock = "";
  for (const name in vars) varBlock += "  " + name + ": " + vars[name] + " !important;\n";

  return "/* COSKIN:" + id + " */\n" +
":root {\n" +
"  color-scheme: " + appearance + " !important;\n" +
"  --coskin-accent: " + colors.accent + ";\n" +
"  --coskin-secondary: " + colors.secondary + ";\n" +
"  --coskin-surface: " + colors.surface + ";\n" +
"  --coskin-text: " + colors.text + ";\n" +
varBlock +
"}\n" +
"/* —— B 背景层 —— */\n" +
"#root {\n" +
"  color: " + colors.text + " !important;\n" +
"  background:\n" +
"    " + scrimLayers + veilLayer + backgroundLayers + " !important;\n" +
"}\n" +
"aside.app-shell-left-panel {\n" +
"  background: " + colors.surface + a2hex(alpha.side) + " !important;\n" +
"  border-right: 1px solid " + colors.accent + a2hex(Math.min(0.4, alpha.line + 0.08)) + " !important;\n" +
glass(18, 1.1) +
"}\n" +
"main.main-surface, .browser-main-surface {\n" +
mainWash +
"}\n" +
bareTextShadow +
"header.app-header-tint { color: " + colors.text + " !important; text-shadow: 0 1px 8px " + colors.surface + "cc; }\n" +
"/* —— E 控件设计：玻璃卡片体系 —— */\n" +
"[data-local-conversation-final-assistant] {\n" +
"  background: " + colors.surface + a2hex(Math.max(0.42, alpha.raised - 0.22)) + " !important;\n" +
"  border: 1px solid " + colors.accent + a2hex(Math.min(0.22, alpha.line * 0.8)) + " !important;\n" +
"  border-radius: " + (radius + 2) + "px !important;\n" +
"  box-shadow: 0 6px 22px " + colors.surfaceDeep + "26 !important;\n" +
glass(16, 1.06) +
"}\n" +
".composer-surface-chrome, [data-user-message-bubble], [data-codex-approval-surface] {\n" +
"  color: " + colors.text + " !important;\n" +
"  border: 1px solid " + colors.accent + a2hex(Math.min(0.3, alpha.line)) + " !important;\n" +
"  border-radius: " + (radius + 4) + "px !important;\n" +
"  background: " + colors.surfaceRaised + a2hex(alpha.input) + " !important;\n" +
"  box-shadow: 0 8px 24px " + colors.surfaceDeep + "1f, inset 0 1px " + colors.text + "0f !important;\n" +
glass(20, 1.08) +
"}\n" +
"/* 对话框上方的 project/worktree/branch「帽子」与对话框重叠会叠出双层不透明度；\n" +
"   按帽子自身特征类组合（side-bar-background + -mx-px + flex-nowrap，侧栏没有这些类）精准打透明，\n" +
"   让对话框成为唯一的水玻璃面。 */\n" +
"[class*=\"bg-token-side-bar-background\"][class*=\"-mx-px\"][class*=\"flex-nowrap\"] {\n" +
"  background: transparent !important; backdrop-filter: none !important; box-shadow: none !important;\n" +
"}\n" +
"[data-app-action-sidebar-thread-active=\"true\"] {\n" +
"  background: linear-gradient(90deg, " + colors.accent + "38, " + colors.secondary + "22) !important;\n" +
"  box-shadow: inset 3px 0 0 " + colors.accent + " !important;\n" +
"  border-radius: 8px !important;\n" +
"}\n" +
"aside.app-shell-left-panel a:hover, aside.app-shell-left-panel button:hover {\n" +
"  background: " + colors.accent + "1f !important;\n" +
"}\n" +
":focus-visible { outline: 2px solid " + colors.accent + "99 !important; outline-offset: 1px; }\n" +
"/* 首页建议卡：可点的功能入口，任何档位都要有常驻底色（可读性工程的例外条款） */\n" +
"[class*=\"home-suggestions\"] button {\n" +
"  background: " + colors.surfaceRaised + a2hex(alpha.veil === 0 ? 0.3 : 0.46) + " !important;\n" +
"  border: 1px solid " + colors.accent + "30 !important;\n" +
"  border-radius: " + (radius + 2) + "px !important;\n" +
"  box-shadow: 0 6px 18px " + colors.surfaceDeep + "1c !important;\n" +
(alpha.veil === 0 ? "" : "  backdrop-filter: blur(10px) saturate(1.04);\n") +
"  display: flex !important; flex-direction: column !important;\n" +
"  align-items: center !important; justify-content: center !important;\n" +
"  text-align: center !important; gap: 10px !important;\n" +
"  font-size: 20px !important; padding: 16px 14px !important;\n" +
"  transition: transform .16s ease, border-color .16s ease;\n" +
"}\n" +
"[class*=\"home-suggestions\"] button > span { justify-content: center !important; text-align: center !important; }\n" +
"[class*=\"home-suggestions\"] button:hover {\n" +
"  transform: translateY(-2px);\n" +
"  border-color: " + colors.accent + "7a !important;\n" +
"  box-shadow: 0 10px 26px " + colors.accent + "26 !important;\n" +
"}\n" +
"[class*=\"home-suggestions\"] button svg { width: 40px !important; height: 40px !important; color: " + colors.accent + " !important; }\n" +
"[class*=\"home-suggestions\"] button span:has(> svg) { width: auto !important; height: auto !important; justify-content: center !important; }\n" +
"[class*=\"home-suggestions\"] button [class*=\"justify-between\"] { justify-content: center !important; }\n" +
"/* 真机卡片文字带 mt-auto 被推到底部、图标贴顶留大空档；收掉自动上边距让图标与文字靠拢居中 */\n" +
"[class*=\"home-suggestions\"] button [class*=\"mt-auto\"] { margin-top: 6px !important; }\n" +
"/* 卡片行加宽只在横幅激活时生效（data-cs-cards 标记）——否则会搅坏官方原生布局 */\n" +
"[data-cs-cards] {\n" +
"  width: var(--cs-cards-w, auto) !important;\n" +
"  max-width: none !important;\n" +
"  margin-left: 50% !important;\n" +
"  transform: translateX(-50%) !important;\n" +
"  gap: 16px !important;\n" +
"}\n" +
"[data-cs-cards] button { min-height: var(--cs-card-h, auto) !important; }\n" +
"/* —— F 细节 —— */\n" +
"/* 真机实测：[data-vscode-context] 包的是整个会话视图，必须透明（曾把壁纸整块挡死）。\n" +
"   代码可读性由 pre 底色和编辑器/终端自绘的 --vscode-* 背景保证。 */\n" +
"[data-vscode-context] { background: transparent !important; }\n" +
"/* 阅读面板特权：Review/文档面板是背景全透明的 CodeMirror，文字不能浮在壁纸上 */\n" +
".cm-editor { background: " + colors.surfaceDeep + "f0 !important; border-radius: 10px; }\n" +
".cm-editor .cm-gutters { background: transparent !important; border: none !important; }\n" +
"pre {\n" +
"  background: " + colors.surfaceDeep + a2hex(alpha.deep) + " !important;\n" +
"  border: 1px solid " + colors.accent + "26 !important;\n" +
"  border-radius: " + Math.max(8, radius - 4) + "px !important;\n" +
"}\n" +
"::-webkit-scrollbar { width: 10px; height: 10px; }\n" +
"::-webkit-scrollbar-thumb { background: " + colors.textMuted + "59 !important; border-radius: 5px; }\n" +
"::-webkit-scrollbar-thumb:hover { background: " + colors.accent + "8c !important; }\n" +
"::-webkit-scrollbar-track { background: transparent; }\n" +
"::selection { background: " + colors.accent + "4d; }\n" +
"input, textarea { caret-color: " + colors.accent + "; }\n";
}

// 内置主题的 background 写在 theme.json 的 background.css（纯渐变，无素材）。
// 图片主题只返回纯 url 层 —— 雾纱/幕布由 coskinBuildCss 按可见度档位叠加（原图档=0）。
export function backgroundFromTheme(theme, imageDataUrl = null) {
  if (imageDataUrl) {
    return `url(${JSON.stringify(imageDataUrl)}) center center / cover no-repeat fixed`;
  }
  const css = theme.background?.css;
  if (typeof css !== "string" || css.includes("url(")) {
    throw new Error(`主题 ${theme.id} 的 background.css 缺失或包含外部资源`);
  }
  return css;
}

const PANEL_CSS = `
#coskin-ui { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; font-family: ui-rounded, system-ui, -apple-system, sans-serif; }
#coskin-ui .coskin-fab {
  width: 44px; height: 44px; border-radius: 50%; border: none; cursor: pointer; font-size: 20px;
  background: rgba(24, 26, 46, 0.78); color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.35);
  backdrop-filter: blur(14px); transition: transform .15s ease;
  display: flex; align-items: center; justify-content: center; margin-left: auto;
}
#coskin-ui .coskin-fab:hover { transform: scale(1.08); }
#coskin-ui .coskin-panel {
  display: none; position: relative; flex-direction: column; gap: 4px; margin-bottom: 10px; padding: 10px;
  width: 340px; border-radius: 14px; background: rgba(20, 22, 40, 0.84); color: #f2f4ff;
  box-shadow: 0 12px 36px rgba(0,0,0,.4); backdrop-filter: blur(18px) saturate(1.1);
  border: 1px solid rgba(255,255,255,.08);
}
#coskin-ui .coskin-panel.coskin-open { display: flex; }
#coskin-ui .coskin-head { font-size: 12px; font-weight: 700; opacity: .65; padding: 2px 6px 6px; letter-spacing: .04em; }
#coskin-ui .coskin-update { font-size: 11px; font-weight: 700; color: #7cc4ff; padding: 0 6px 6px; cursor: default; }
#coskin-ui .coskin-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: none; border-radius: 9px;
  background: transparent; color: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left;
  max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
#coskin-ui .coskin-item:hover { background: rgba(255,255,255,.10); }
#coskin-ui .coskin-item.coskin-active { background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.55); }
#coskin-ui .coskin-dot { width: 14px; height: 14px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
/* 主题列表=浮层下拉：绝对定位，不撑高看板（动静结合） */
#coskin-ui .coskin-list {
  position: absolute; left: 8px; right: 8px; z-index: 8; flex-direction: column; gap: 3px;
  background: rgba(22, 24, 44, 0.98); border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
  box-shadow: 0 18px 44px rgba(0,0,0,.55); backdrop-filter: blur(22px) saturate(1.1);
  max-height: 320px; overflow-y: auto; overflow-x: hidden; padding: 6px;
}
#coskin-ui .coskin-list::-webkit-scrollbar { width: 8px; }
#coskin-ui .coskin-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 4px; }
#coskin-ui .coskin-list::-webkit-scrollbar-track { background: transparent; }
#coskin-ui .coskin-actions { display: flex; align-items: center; gap: 6px; padding: 2px 4px; }
#coskin-ui .coskin-sel {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; border: none; background: transparent;
  color: inherit; cursor: pointer; padding: 5px 6px; border-radius: 7px; text-align: left;
}
#coskin-ui .coskin-sel:hover { background: rgba(255,255,255,.10); }
#coskin-ui .coskin-caret { flex: none; font-size: 9px; opacity: .55; }
#coskin-ui .coskin-act-label { flex: 1; min-width: 0; font-size: 12px; font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#coskin-ui .coskin-act {
  flex: none; border: 1px solid rgba(255,255,255,.16); background: transparent; color: inherit;
  font-size: 11px; font-weight: 700; padding: 5px 9px; border-radius: 7px; cursor: pointer;
}
#coskin-ui .coskin-act:hover:not(:disabled) { background: rgba(255,255,255,.12); }
#coskin-ui .coskin-act:disabled { opacity: .3; cursor: default; }
#coskin-ui .coskin-act-del:hover:not(:disabled) { background: rgba(255,90,90,.22); border-color: rgba(255,120,120,.5); }
#coskin-ui .coskin-div { height: 1px; margin: 6px 4px; background: rgba(255,255,255,.12); }
#coskin-ui .coskin-hint { font-size: 10px; font-weight: 500; line-height: 1.5; opacity: .5; padding: 2px 6px 0; white-space: normal; }
#coskin-ui .coskin-ctl { display: flex; align-items: center; gap: 5px; padding: 3px 6px; }
#coskin-ui .coskin-ctl-label { font-size: 11px; font-weight: 600; opacity: .6; flex: none; white-space: nowrap; padding-right: 2px; }
#coskin-ui .coskin-mini {
  flex: 1; border: 1px solid rgba(255,255,255,.16); background: transparent; color: inherit;
  font-size: 11px; font-weight: 600; padding: 4px 0; border-radius: 7px; cursor: pointer;
}
#coskin-ui .coskin-mini:hover { background: rgba(255,255,255,.10); }
#coskin-ui .coskin-mini.coskin-on { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.5); }
#coskin-brand, #coskin-brand * { -webkit-app-region: no-drag; }
#coskin-brand {
  position: fixed; top: 0; z-index: 2147482998; pointer-events: none; display: none;
  height: 46px; align-items: center; justify-content: center; gap: 10px;
  font: 800 20px/1 ui-rounded, system-ui, -apple-system, sans-serif;
  letter-spacing: .1em; opacity: .92;
}
#coskin-brand .cs-sep, #coskin-brand .cs-brand-sub { font-size: 14px; }
#coskin-brand .cs-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cs-accent, #7c6cff); box-shadow: 0 0 10px var(--cs-accent, #7c6cff); }
#coskin-brand .cs-sep { opacity: .4; font-weight: 600; }
#coskin-brand .cs-brand-sub { opacity: .55; font-weight: 700; letter-spacing: .08em; }
.cs-hero-plate {
  position: absolute; z-index: -1; pointer-events: none; border-radius: 22px; overflow: hidden;
  background-size: cover; background-position: var(--cs-hero-focus, 72% 16%);
  border: 1px solid var(--cs-stage-line, rgba(255,255,255,.16));
  box-shadow: 0 18px 48px rgba(0,0,0,.18);
}
.cs-hero-plate::after { content: ""; position: absolute; inset: 0; background: var(--cs-hero-wash, rgba(20,22,40,.5)); }
.cs-hero-art {
  position: absolute; top: 0; right: 0; bottom: 0; width: 36%;
  background-size: cover; background-position: var(--cs-hero-focus, 50% 62%);
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 32%);
  mask-image: linear-gradient(90deg, transparent 0, #000 32%);
  opacity: .92;
}
.cs-glyph { display: block; font-family: "Xingkai SC", "Kaiti SC", "STKaiti", serif; font-size: 42px; line-height: 1.15; font-weight: 700; text-align: center; }
.cs-glyph.cs-glyph-sm { font-size: 26px; }
@keyframes coskin-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes coskin-bob-fast { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
@keyframes coskin-blink { 0%, 91%, 100% { transform: scaleY(1); } 94% { transform: scaleY(.12); } }
@keyframes coskin-spin { to { transform: rotate(360deg); } }
@keyframes coskin-pop { 0% { transform: scale(1); } 40% { transform: scale(1.22); } 100% { transform: scale(1); } }
@keyframes coskin-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
#coskin-pet { position: fixed; right: 24px; bottom: 84px; z-index: 2147482999; display: flex; align-items: flex-end; gap: 9px; pointer-events: none; font-family: ui-rounded, system-ui, sans-serif; }
/* working：呼吸加速 + 一圈转动的光环（用主题强调色） */
#coskin-pet.cs-working .cs-pet-body { animation: coskin-bob-fast 1.1s ease-in-out infinite; }
#coskin-pet.cs-working .cs-pet-body::before {
  content: ""; position: absolute; inset: -5px; border-radius: 50%;
  border: 2px solid transparent; border-top-color: var(--cs-accent, #7c6cff);
  animation: coskin-spin .9s linear infinite;
}
#coskin-pet.cs-done .cs-pet-body { animation: coskin-pop .6s ease; }
#coskin-pet.cs-error .cs-pet-body { animation: coskin-shake .5s ease; box-shadow: 0 8px 18px rgba(0,0,0,.3), 0 0 0 3px var(--cs-pet-err, rgba(220,60,60,.6)); }
#coskin-pet .cs-pet-body { pointer-events: auto; cursor: grab; }
#coskin-pet.cs-drag .cs-pet-body { cursor: grabbing; }
#coskin-pet.cs-drag .cs-pet-bubble { opacity: .35; }
#coskin-pet.cs-flip { flex-direction: row-reverse; }
#coskin-pet.cs-flip .cs-pet-bubble { border-radius: 12px 12px 12px 3px; }
#coskin-pet .cs-pet-bubble {
  max-width: 190px; padding: 7px 11px; border-radius: 12px 12px 3px 12px;
  font-size: 11px; font-weight: 700; line-height: 1.5;
  background: var(--cs-stage-bg, rgba(20,22,40,.72)); color: inherit;
  border: 1px solid var(--cs-stage-line, rgba(255,255,255,.16));
  backdrop-filter: blur(12px); transition: opacity .5s ease; margin-bottom: 26px;
}
#coskin-pet .cs-pet-body {
  width: 46px; height: 46px; flex: none; position: relative;
  border-radius: 52% 48% 46% 54% / 58% 54% 46% 42%;
  background: radial-gradient(circle at 30% 26%, var(--cs-pet-hi, #a99cff), var(--cs-accent, #7c6cff) 62%, var(--cs-pet-lo, #4a3fd1));
  box-shadow: 0 8px 18px rgba(0,0,0,.3), inset 0 -5px 10px rgba(0,0,0,.2), inset 0 3px 6px rgba(255,255,255,.28);
  animation: coskin-bob 3.6s ease-in-out infinite;
}
#coskin-pet .cs-pet-eye {
  position: absolute; top: 16px; width: 7px; height: 9px; border-radius: 50%;
  background: #ffffff; animation: coskin-blink 4.2s ease-in-out infinite;
}
#coskin-pet .cs-pet-eye::after {
  content: ""; position: absolute; left: 2px; top: 3px; width: 3.4px; height: 3.8px; border-radius: 50%;
  background: #10122b;
}
#coskin-pet .cs-pet-eye.l { left: 11px; } #coskin-pet .cs-pet-eye.r { right: 11px; }
#coskin-pet .cs-pet-cheek { position: absolute; top: 25px; width: 6px; height: 3.5px; border-radius: 50%; background: rgba(255,255,255,.35); }
#coskin-pet .cs-pet-cheek.l { left: 8px; } #coskin-pet .cs-pet-cheek.r { right: 8px; }
`;

// 注入脚本：主题编译 + 外观同步 + 🎨 面板（主题列表 / 可见度档位 / 深浅翻转 / 图片上传快捷槽）。
// themes: [{ id, name, accent, appearance, spec:{palette}, bg }]，activeId 为要应用的主题（null=原生）。
export function buildInjectionScript(themes, activeId, updateInfo = null) {
  return `(() => {
  const THEMES = ${JSON.stringify(themes)};
  const ACTIVE = ${JSON.stringify(activeId)};
  const UPDATE = ${JSON.stringify(updateInfo)};
  const QUICK_KEY = "coskin.quickSlot.v5";
  const IMPORT_KEY = "coskin.imported.v1";
  const SHARE_FORMAT = "coskin-theme";
  const D = document;
  const HIDDEN_KEY = "coskin.hidden.v1";
  // 语言跟随 Codex（documentElement.lang），中文显示中文，否则英文
  const LANG = String(D.documentElement.lang || navigator.language || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  const STR = {
    zh: {
      header: "COSKIN · 一键换肤", native: "官方原生", exportBtn: "⇩ 导出", delBtn: "🗑 删除",
      delConfirm: "再点一次删除", noSel: "未选主题", selectTip: "点主题名展开 / 收起列表",
      bg: "背景", raw: "原图", immersive: "沉浸", ambient: "氛围", subtle: "含蓄",
      appearance: "外观", dark: "深", light: "浅", pet: "桌宠", on: "开", off: "关",
      makeImg: "＋ 用图片做主题", uploadShare: "↥ 上传 .coskin 主题文件",
      hint: "点顶部主题名展开列表；选中后底部「导出」分享成 .coskin、「删除」移出列表（内置为隐藏可恢复）。",
      petDrag: "拖我去任何地方", processing: "处理中…", readFail: "读取失败，再试一次",
      tooBig: "已应用（图太大没存进快捷槽）", imgFail: "失败了，换张图试试",
      importing: "导入中…", importOk: "✓ 已导入并应用", importFail: "导入失败：", badFile: "文件不对",
      updateAvail: "有新版本", updateHow: "双击「更新.command」一键升级（会 git pull 并自动重新应用）",
      quotes: ["今天写点什么好？", "小步提交，常回滚。", "先让它跑起来，再让它漂亮。"],
      working: ["运笔中…", "别急，正在写。", "让子弹飞一会儿。", "思考ing…"],
      done: ["写完啦！", "这一轮收工。", "看看成果吧。"],
      error: ["出岔子了，深呼吸。", "红灯别上头。", "回退一步再看。"],
    },
    en: {
      header: "COSKIN · Skins", native: "Official Default", exportBtn: "⇩ Export", delBtn: "🗑 Delete",
      delConfirm: "Click again to delete", noSel: "No theme", selectTip: "Click theme name to show / hide list",
      bg: "Backdrop", raw: "Raw", immersive: "Immersive", ambient: "Ambient", subtle: "Subtle",
      appearance: "Mode", dark: "Dark", light: "Light", pet: "Pet", on: "On", off: "Off",
      makeImg: "＋ Make theme from image", uploadShare: "↥ Import .coskin file",
      hint: "Click the theme name up top to open the list; pick one, then Export it as .coskin or Delete it (built-ins are hidden, not removed).",
      petDrag: "Drag me anywhere", processing: "Processing…", readFail: "Read failed, try again",
      tooBig: "Applied (image too big to save)", imgFail: "Failed, try another image",
      importing: "Importing…", importOk: "✓ Imported & applied", importFail: "Import failed: ", badFile: "bad file",
      updateAvail: "Update available", updateHow: "Double-click 更新.command / update.bat to upgrade (git pull + auto re-apply).",
      quotes: ["What shall we build today?", "Small commits, easy rollbacks.", "Make it work, then make it pretty."],
      working: ["Working on it…", "Cooking…", "Give it a sec.", "Thinking…"],
      done: ["Done!", "Shipped this round.", "Take a look."],
      error: ["Hit a snag—breathe.", "Red light, stay calm.", "Step back and look."],
    },
  };
  const tr = (k) => (STR[LANG] && STR[LANG][k] != null ? STR[LANG][k] : STR.en[k]);
  const loadImported = () => {
    try { const a = JSON.parse(localStorage.getItem(IMPORT_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch { return []; }
  };
  const saveImported = (list) => {
    try { localStorage.setItem(IMPORT_KEY, JSON.stringify(list)); return true; } catch { return false; }
  };
  const loadHidden = () => {
    try { const a = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch { return []; }
  };
  const saveHidden = (a) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(a)); } catch {} };
  ${coskinExtractPalette.toString()}
  ${coskinDecideAppearance.toString()}
  ${coskinCompileTokens.toString()}
  ${coskinBuildCss.toString()}

  const state = window.__coskinState = window.__coskinState || { vis: "ambient", appOverride: null };
  let petOn = "on";
  try { petOn = localStorage.getItem("coskin.pet.v1") || "on"; } catch {}
  state.petOn = petOn !== "off";
  // 重注入前清干净旧定时器
  if (window.__coskinTimers) { for (const t of window.__coskinTimers) clearInterval(t); }
  window.__coskinTimers = [];

  const ensureStyle = (id, css) => {
    let el = D.getElementById(id);
    if (!el) { el = D.createElement("style"); el.id = id; D.documentElement.appendChild(el); }
    el.textContent = css;
  };
  const syncShell = (appearance) => {
    const de = D.documentElement;
    if (window.__coskinPrevShell === undefined) {
      window.__coskinPrevShell = de.classList.contains("electron-dark") ? "electron-dark"
        : de.classList.contains("electron-light") ? "electron-light" : null;
    }
    de.classList.remove("electron-light", "electron-dark");
    if (appearance === null) { if (window.__coskinPrevShell) de.classList.add(window.__coskinPrevShell); return; }
    de.classList.add(appearance === "light" ? "electron-light" : "electron-dark");
  };
  const refreshCtls = () => {
    for (const b of D.querySelectorAll("[data-coskin-vis]")) b.classList.toggle("coskin-on", b.getAttribute("data-coskin-vis") === state.vis);
    const t = THEMES.find((t) => t.id === window.__coskinActive) ?? null;
    const app = t ? (state.appOverride ?? t.appearance) : null;
    for (const b of D.querySelectorAll("[data-coskin-app]")) b.classList.toggle("coskin-on", app !== null && b.getAttribute("data-coskin-app") === app);
  };
  // 页面内现场编译：可见度/深浅即点即变
  const setTheme = (id, keepOverride) => {
    const t = THEMES.find((t) => t.id === id) ?? null;
    if (!keepOverride) state.appOverride = null;
    if (!t) { D.getElementById("coskin-style")?.remove(); syncShell(null); }
    else {
      const appearance = state.appOverride ?? t.appearance;
      const css = coskinBuildCss(
        { id: t.id, appearance: appearance, palette: t.spec.palette, controls: { visibility: state.vis } },
        t.bg,
      );
      ensureStyle("coskin-style", css);
      syncShell(appearance);
    }
    const activeKey = t ? t.id : "__native__";
    for (const b of D.querySelectorAll("[data-coskin-theme]")) {
      b.classList.toggle("coskin-active", b.getAttribute("data-coskin-theme") === activeKey);
    }
    window.__coskinActive = t ? t.id : null;
    refreshCtls();
    if (window.__coskinSyncActions) window.__coskinSyncActions();
    applyDecor(t);
  };
  window.__coskinSetTheme = setTheme;

  // —— 主题化装饰层：顶栏品牌行 + 首页标题板（框住官方标题，壁纸人物做底）+ 桌宠 ——
  // 注意：本函数活在注入脚本模板里，正则反斜杠必须双写（模板字面量会把 \\( 煮成 \(）
  const heroArtFrom = (bg) => {
    const m = String(bg).match(/url\\((?:"|')?data:[^)]+\\)/);
    return m ? m[0] : null;
  };
  // 水玻璃板：透明不模糊，壁纸透板可见，只加一层极轻的主题色染；
  // 图片主题在板右侧放一条人物裁切（左缘羽化），decor.focus 调裁切位置
  const stylePlate = (plate, t, colors) => {
    plate.style.backgroundImage = "none";
    plate.style.backgroundColor = colors.surface + "30";
    plate.style.setProperty(
      "--cs-hero-wash",
      "linear-gradient(120deg, " + colors.accent + "12, " + colors.secondary + "0c)",
    );
    plate.style.setProperty("--cs-stage-line", colors.accent + "38");
    const art = heroArtFrom(t.bg);
    let strip = plate.querySelector(":scope > .cs-hero-art");
    if (art) {
      if (!strip) { strip = D.createElement("div"); strip.className = "cs-hero-art"; plate.appendChild(strip); }
      strip.style.backgroundImage = art;
      strip.style.setProperty("--cs-hero-focus", (t.decor && t.decor.focus) || "50% 62%");
    } else if (strip) {
      strip.remove();
    }
  };
  // 删板子时必须把我们写在官方标题列上的内联样式还原（还原即原样契约）
  const removePlate = (p) => {
    const col = p.parentElement;
    p.remove();
    if (col && col.dataset.csCol !== undefined) {
      col.style.position = col.dataset.csPrevPos || "";
      col.style.isolation = col.dataset.csPrevIso || "";
      if (col.dataset.csPrevTf !== undefined) col.style.transform = col.dataset.csPrevTf || "";
      col.style.removeProperty("--cs-card-h");
      col.style.removeProperty("--cs-cards-w");
      if (!col.getAttribute("style")) col.removeAttribute("style");
      delete col.dataset.csCol; delete col.dataset.csPrevPos; delete col.dataset.csPrevIso;
      delete col.dataset.csPrevTf; delete col.dataset.csTfDelta; delete col.dataset.csCardVars;
    }
  };
  window.__coskinRemovePlate = removePlate;
  // 卡片行书字：decor.cardGlyphs 存在时隐藏原 SVG、注入主题色字符
  const clearGlyphs = () => {
    for (const g of D.querySelectorAll(".cs-glyph")) g.remove();
    for (const s of D.querySelectorAll("svg[data-cs-hid]")) { s.style.removeProperty("display"); delete s.dataset.csHid; }
    for (const b of D.querySelectorAll("[data-cs-glyphed]")) delete b.dataset.csGlyphed;
    for (const b of D.querySelectorAll("[data-cs-orig]")) delete b.dataset.csOrig;
    for (const t of D.querySelectorAll("[data-cs-lined]")) {
      t.textContent = t.dataset.csPrevText || "";
      t.style.whiteSpace = t.dataset.csPrevWs || "";
      t.style.removeProperty("line-height");
      t.style.removeProperty("font-size");
      delete t.dataset.csLined; delete t.dataset.csPrevText; delete t.dataset.csPrevWs;
      if (t.dataset.csWrapped !== undefined) t.replaceWith(D.createTextNode(t.textContent));
    }
  };
  // 卡片短句替换目标：按钮里最长的叶子文本元素；裸文本节点则包一层可还原的 span
  const lineTarget = (btn) => {
    let best = null;
    for (const el of btn.querySelectorAll("span,div,p")) {
      if (el.classList.contains("cs-glyph")) continue;
      if (el.childElementCount === 0 && el.textContent.trim().length > 4) {
        if (!best || el.textContent.length > best.textContent.length) best = el;
      }
    }
    if (best) return best;
    for (const n of btn.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim().length > 4) {
        const w = D.createElement("span");
        w.dataset.csWrapped = "1";
        w.textContent = n.textContent;
        btn.replaceChild(w, n);
        return w;
      }
    }
    return null;
  };
  // 卡片定制改「按原文匹配」：位置会骗人（点开卡片后同一批按钮槽被二级条目复用），
  // 原文不会。匹配不上的按钮一律保持官方原文（二级条目走 subCards 独立映射）。
  const cardRules = (decor) => {
    const rules = [];
    if (Array.isArray(decor.cards)) {
      for (const c of decor.cards) rules.push({ m: [].concat(c.match || []), glyph: c.glyph, lines: c.lines, primary: true });
    }
    if (Array.isArray(decor.subCards)) {
      for (const c of decor.subCards) rules.push({ m: [].concat(c.match || []), glyph: c.glyph, lines: c.lines, primary: false });
    }
    return rules;
  };
  const restoreLine = (t) => {
    t.textContent = t.dataset.csPrevText || "";
    t.style.whiteSpace = t.dataset.csPrevWs || "";
    t.style.removeProperty("line-height");
    t.style.removeProperty("font-size");
    delete t.dataset.csLined; delete t.dataset.csPrevText; delete t.dataset.csPrevWs;
  };
  const dropGlyph = (b) => {
    const g = b.querySelector(":scope > .cs-glyph");
    if (g) g.remove();
    const svg = b.querySelector("svg[data-cs-hid]");
    if (svg) { svg.style.removeProperty("display"); delete svg.dataset.csHid; }
    delete b.dataset.csGlyphed;
  };
  const syncGlyphs = (sug, active) => {
    const decor = (active && active.decor) || {};
    const rules = cardRules(decor);
    if (!rules.length) { clearGlyphs(); return; }
    for (const b of sug.querySelectorAll("button")) {
      // 真机把文字拆成「前缀span+正文span」，必须按整个按钮的原始文本匹配；
      // 首次见到（未改动过）时存快照，之后一直用快照认卡
      if (b.dataset.csOrig === undefined) b.dataset.csOrig = b.textContent;
      const orig = b.dataset.csOrig.toLowerCase();
      const t = lineTarget(b);
      const rule = rules.find((rr) => rr.m.some((k) => orig.includes(String(k).toLowerCase())));
      if (rule && rule.glyph) {
        let g = b.querySelector(":scope > .cs-glyph");
        if (!g) {
          g = D.createElement("span"); g.className = "cs-glyph"; b.prepend(g);
          b.dataset.csGlyphed = "1";
          const svg = b.querySelector("svg");
          if (svg) { svg.dataset.csHid = "1"; svg.style.display = "none"; }
        }
        g.textContent = rule.glyph;
        g.classList.toggle("cs-glyph-sm", !rule.primary);
        if (state.activeColors) g.style.color = state.activeColors.accent;
      } else {
        dropGlyph(b);
      }
      if (rule && rule.lines && t) {
        if (t.dataset.csLined === undefined) {
          t.dataset.csLined = "1";
          t.dataset.csPrevText = t.textContent;
          t.dataset.csPrevWs = t.style.whiteSpace || "";
        }
        if (t.textContent !== rule.lines) {
          t.textContent = rule.lines;
          t.style.whiteSpace = "pre-line";
          t.style.lineHeight = "1.55";
        }
        t.style.fontSize = rule.primary ? "16px" : "14px";
      } else if (t && t.dataset.csLined !== undefined) {
        restoreLine(t);
        delete b.dataset.csOrig;
      }
    }
  };
  // 原图档：算一个「最长戒条恰好不折行」的紧凑行宽（四卡等宽两行）
  const compactCardsWidth = (decor, mainW) => {
    let maxChars = 8;
    if (Array.isArray(decor.cards)) {
      for (const c of decor.cards) {
        for (const ln of String(c.lines || "").split("\\n")) maxChars = Math.max(maxChars, ln.length);
      }
    }
    const cardW = Math.min(400, maxChars * 16 + 64);
    return Math.min(mainW - 120, cardW * 4 + 3 * 16);
  };
  // 标题接管：板子是艺术底，官方标题默认是弱灰色会撞色——直接改成主题墨色+光晕，还原时恢复
  const clearTitleStyle = () => {
    for (const el of D.querySelectorAll("[data-cs-titled]")) {
      el.style.color = el.dataset.csPrevColor || "";
      el.style.textShadow = el.dataset.csPrevShadow || "";
      el.style.fontWeight = el.dataset.csPrevWeight || "";
      if (!el.getAttribute("style")) el.removeAttribute("style");
      delete el.dataset.csTitled; delete el.dataset.csPrevColor; delete el.dataset.csPrevShadow; delete el.dataset.csPrevWeight;
    }
  };
  const styleTitle = (title) => {
    if (!title || !state.activeColors) return;
    // 真机标题拆成多个子元素（项目名是独立 span），容器和子孙一起染色
    const targets = [title, ...title.querySelectorAll("*")];
    for (const el of targets) {
      if (el.dataset.csTitled === undefined) {
        el.dataset.csTitled = "1";
        el.dataset.csPrevColor = el.style.color || "";
        el.dataset.csPrevShadow = el.style.textShadow || "";
        el.dataset.csPrevWeight = el.style.fontWeight || "";
      }
      el.style.color = state.activeColors.text;
      el.style.textShadow = "0 1px 12px " + state.activeColors.surface + "e6, 0 0 2px " + state.activeColors.surface;
      if (el === title) el.style.fontWeight = "800";
    }
  };
  // 找首页标题：整体文本匹配的「最深容器」（允许有子元素——真机把项目名拆成独立 span）
  const findTitle = (main) => {
    if (state.titleEl && state.titleEl.isConnected) return state.titleEl;
    state.titleEl = null;
    let best = null;
    for (const el of main.querySelectorAll("h1,h2,h3,p,div,span")) {
      const t = el.textContent;
      if (t.length < 120 && /work on|构建什么/i.test(t)) {
        if (!best || t.length <= best.textContent.length) best = el;
      }
    }
    state.titleEl = best;
    return state.titleEl;
  };
  // 轮询：首页出现时挂品牌行与标题板，离开时收起；标题板插进锚容器（z-index:-1 垫底）
  const syncHome = () => {
    const brand = D.getElementById("coskin-brand");
    const sug = D.querySelector('[class*="home-suggestions"]');
    const main = D.querySelector("main.main-surface");
    const active = window.__coskinActive ? THEMES.find((x) => x.id === window.__coskinActive) : null;
    if (!active || !sug || !main) {
      if (brand) brand.style.display = "none";
      for (const p of D.querySelectorAll(".cs-hero-plate")) removePlate(p);
      for (const s of D.querySelectorAll("[data-cs-cards]")) { delete s.dataset.csCards; s.style.removeProperty("--cs-cards-w"); }
      clearGlyphs();
      clearTitleStyle();
      return;
    }
    const r = main.getBoundingClientRect();
    if (brand) {
      brand.style.display = "flex";
      brand.style.left = r.left + "px";
      brand.style.width = r.width + "px";
    }
    syncGlyphs(sug, active);
    // 锚容器 = 同时包含标题与卡片的最近祖先（标题找不到时退回卡片父级）
    const title = findTitle(main);
    styleTitle(title);
    // 原图档：零遮挡——不挂板子、不动整列布局；卡片行给紧凑统一宽（戒条两行不折行）
    if (state.vis === "raw") {
      for (const p of D.querySelectorAll(".cs-hero-plate")) removePlate(p);
      const decor = (active && active.decor) || {};
      if (Array.isArray(decor.cards) && decor.cards.length) {
        sug.dataset.csCards = "1";
        sug.style.setProperty("--cs-cards-w", compactCardsWidth(decor, r.width) + "px");
        sug.style.removeProperty("--cs-card-h");
      } else {
        for (const s of D.querySelectorAll("[data-cs-cards]")) { delete s.dataset.csCards; s.style.removeProperty("--cs-cards-w"); }
      }
      return;
    }
    sug.dataset.csCards = "1";
    sug.style.removeProperty("--cs-cards-w"); // 横幅档由锚容器变量供宽
    let anchor = sug.parentElement;
    if (title) {
      let cur = title;
      for (let i = 0; cur && i < 8; i++) { if (cur.contains(sug)) { anchor = cur; break; } cur = cur.parentElement; }
    }
    if (!anchor) return;
    let plate = anchor.querySelector(":scope > .cs-hero-plate");
    if (!plate) {
      for (const p of D.querySelectorAll(".cs-hero-plate")) removePlate(p); // 锚点变了就重建
      plate = D.createElement("div");
      plate.className = "cs-hero-plate";
      // 记录原始内联值，删板子时还原
      anchor.dataset.csCol = "1";
      anchor.dataset.csPrevPos = anchor.style.position || "";
      anchor.dataset.csPrevIso = anchor.style.isolation || "";
      if (getComputedStyle(anchor).position === "static") anchor.style.position = "relative";
      // 关键：让锚容器自成堆叠上下文，负 z 的板子才会画在主区背景之上、标题文字之下
      anchor.style.isolation = "isolate";
      anchor.insertBefore(plate, anchor.firstChild);
      if (state.activeColors) stylePlate(plate, active, state.activeColors);
    }
    // 横幅几何：基准是「工作界面」（悬浮顶栏以下）——main 从 y=0 起、顶栏只是悬浮层，
    // 直接用 main.top 会把板顶塞进标题栏（圆角被吃掉）。高=max(工作区1/3, 包住卡片)。
    const headerEl = D.querySelector("header.app-header-tint");
    const topBase = headerEl ? headerEl.getBoundingClientRect().bottom : r.top;
    const contentH = innerHeight - topBase;
    const plateTopV = topBase + 14;
    const cardH = Math.round(innerHeight / 8);
    const W = Math.max(320, Math.round(r.width - 88));
    if (anchor.dataset.csCardVars === undefined) anchor.dataset.csCardVars = "1";
    anchor.style.setProperty("--cs-card-h", cardH + "px");
    anchor.style.setProperty("--cs-cards-w", Math.min(W - 56, 1400) + "px");
    // 整列上移：图标/标题落在板内上部（transform 可还原）
    if (title && anchor.contains(title)) {
      const target = plateTopV + 34;
      const nowRect = anchor.getBoundingClientRect();
      const currentTf = anchor.dataset.csTfDelta ? parseFloat(anchor.dataset.csTfDelta) : 0;
      const naturalTop = nowRect.top + currentTf;
      const delta = Math.max(0, Math.round(naturalTop - target));
      if (Math.abs(delta - currentTf) > 4) {
        if (anchor.dataset.csPrevTf === undefined) anchor.dataset.csPrevTf = anchor.style.transform || "";
        anchor.dataset.csTfDelta = String(delta);
        anchor.style.transform = delta > 0 ? "translateY(-" + delta + "px)" : (anchor.dataset.csPrevTf || "");
      }
    }
    const aR = anchor.getBoundingClientRect();
    const sR = sug.getBoundingClientRect();
    const plateBottomV = Math.max(plateTopV + Math.round(contentH / 3), sR.bottom + 18);
    plate.style.left = Math.round((aR.width - W) / 2) + "px";
    plate.style.width = W + "px";
    plate.style.right = "auto";
    plate.style.top = Math.round(plateTopV - aR.top) + "px";
    plate.style.height = Math.round(plateBottomV - plateTopV) + "px";
  };
  const updateDecorVisibility = () => {
    const pet = D.getElementById("coskin-pet");
    if (pet) pet.style.display = window.__coskinActive && state.petOn ? "flex" : "none";
    syncHome();
  };
  const applyDecor = (t) => {
    const brand = D.getElementById("coskin-brand");
    const pet = D.getElementById("coskin-pet");
    if (!t) { state.activeColors = null; updateDecorVisibility(); return; }
    const appearance = state.appOverride ?? t.appearance;
    const compiled = coskinCompileTokens({ appearance: appearance, palette: t.spec.palette, controls: { visibility: state.vis } });
    const colors = compiled.colors;
    state.activeColors = colors;
    const decor = t.decor || {};
    for (const el of [brand, pet]) {
      if (!el) continue;
      el.style.setProperty("--cs-accent", colors.accent);
      el.style.setProperty("--cs-secondary", colors.secondary);
      el.style.setProperty("--cs-stage-bg", colors.surface + "cc");
      el.style.setProperty("--cs-stage-line", colors.accent + "3d");
      el.style.setProperty("--cs-pet-hi", colors.secondary);
      el.style.setProperty("--cs-pet-lo", colors.surfaceDeep);
      el.style.color = colors.text;
    }
    if (brand) {
      let ov = {};
      try { ov = JSON.parse(localStorage.getItem("coskin.decorOverride.v1") || "{}")[t.id] || {}; } catch {}
      brand.querySelector(".cs-brand-main").textContent = ov.brand ?? (decor.brand || t.name);
      brand.querySelector(".cs-brand-sub").textContent = ov.tagline ?? (decor.tagline || "CoSkin Edition");
    }
    for (const plate of D.querySelectorAll(".cs-hero-plate")) stylePlate(plate, t, colors);
    state.quotes = Array.isArray(decor.quotes) && decor.quotes.length ? decor.quotes : tr("quotes");
    state.quoteIdx = 0;
    const bubble = pet && pet.querySelector(".cs-pet-bubble");
    if (bubble) { bubble.textContent = state.quotes[0]; bubble.style.opacity = "1"; }
    updateDecorVisibility();
  };

  try {
    const raw = localStorage.getItem(QUICK_KEY);
    if (raw) {
      const q = JSON.parse(raw);
      if (q && q.id === "quick" && q.spec && typeof q.bg === "string" && !THEMES.some((t) => t.id === "quick")) THEMES.push(q);
    }
  } catch {}
  // 导入的 .coskin 主题（面板导入的持久化，和快捷槽一样存本地）
  for (const e of loadImported()) {
    if (e && e.id && e.spec && typeof e.bg === "string" && !THEMES.some((t) => t.id === e.id)) THEMES.push(e);
  }
  // 被隐藏的内置/磁盘主题（面板里"删除"的软删除）从列表滤掉
  const hiddenSet = new Set(loadHidden());
  for (let i = THEMES.length - 1; i >= 0; i--) if (hiddenSet.has(THEMES[i].id)) THEMES.splice(i, 1);

  D.getElementById("coskin-ui")?.remove();
  ensureStyle("coskin-ui-style", ${JSON.stringify(PANEL_CSS)});
  const ui = D.createElement("div"); ui.id = "coskin-ui";
  const panel = D.createElement("div"); panel.className = "coskin-panel";
  const head = D.createElement("div"); head.className = "coskin-head"; head.textContent = tr("header");
  panel.appendChild(head);
  // 有新版本提示（Node 侧应用时查的；页面被 CSP 挡着不能自查 GitHub）
  if (UPDATE && UPDATE.updateAvailable) {
    const up = D.createElement("div"); up.className = "coskin-update";
    up.textContent = "🔵 " + tr("updateAvail") + " v" + UPDATE.latest;
    up.title = tr("updateHow");
    panel.appendChild(up);
  }
  // 主题列表：默认收起的浮层（绝对定位，展开不撑高看板）
  const items = D.createElement("div");
  items.className = "coskin-list";
  items.style.display = "none";

  const makeItem = (key, label, swatch, onClick) => {
    const b = D.createElement("button");
    b.className = "coskin-item";
    if (key) b.setAttribute("data-coskin-theme", key);
    if (swatch) { const dot = D.createElement("span"); dot.className = "coskin-dot"; dot.style.background = swatch; b.appendChild(dot); }
    b.appendChild(D.createTextNode(label));
    b.addEventListener("click", onClick);
    return b;
  };
  // 从面板内存里的主题条目重建可分享的 .coskin 结构（壁纸从 bg 里的 data URL 抽出）
  const buildShare = (t) => {
    const share = {
      format: SHARE_FORMAT, formatVersion: 1,
      theme: { id: t.id, name: t.name, appearance: t.appearance === "light" ? "light" : "dark", palette: t.spec.palette },
    };
    if (t.decor) share.theme.decor = t.decor;
    const m = String(t.bg).match(/url\\(\\s*(?:"|')?(data:[^)"']+)/);
    if (m) {
      const du = m[1];
      share.wallpaper = { mime: du.slice(5).split(";")[0], dataBase64: du.slice(du.indexOf(",") + 1) };
    } else {
      share.theme.background = { css: String(t.bg) };
    }
    return share;
  };
  window.__coskinBuildShare = (id) => { const t = THEMES.find((x) => x.id === id); return t ? JSON.stringify(buildShare(t)) : null; };
  const triggerExport = (t) => {
    const blob = new Blob([JSON.stringify(buildShare(t))], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = D.createElement("a"); a.href = url;
    a.download = (String(t.name).replace(/[\\s\\/:*?"<>|]+/g, "_").slice(0, 60) || "theme") + ".coskin.json";
    D.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // .coskin 文件 → 面板主题条目（和 CLI import 同格式，可互通）
  const entryFromShare = (raw) => {
    if (!raw || raw.format !== SHARE_FORMAT || !raw.theme) throw new Error("不是 CoSkin 主题文件");
    const t = raw.theme;
    if (!t.palette || !/^#[0-9a-f]{6}$/i.test(t.palette.accent || "")) throw new Error("主题文件配色非法");
    const appearance = t.appearance === "light" ? "light" : "dark";
    let bg;
    if (raw.wallpaper && raw.wallpaper.dataBase64) {
      const du = "data:" + raw.wallpaper.mime + ";base64," + raw.wallpaper.dataBase64;
      bg = "url(" + JSON.stringify(du) + ") center center / cover no-repeat fixed";
    } else if (t.background && typeof t.background.css === "string" && t.background.css.indexOf("url(") < 0) {
      bg = t.background.css;
    } else {
      const c = coskinCompileTokens({ appearance: appearance, palette: t.palette }).colors;
      bg = "linear-gradient(160deg, " + c.surfaceDeep + " 0%, " + c.surface + " 55%, " + c.surfaceRaised + " 100%)";
    }
    let base = "imp-" + (String(t.id || t.name || "shared").replace(/[^a-z0-9_-]/gi, "") || "shared");
    let id = base, n = 2;
    while (THEMES.some((x) => x.id === id)) { id = base + "-" + n; n++; }
    return { id: id, name: t.name || "导入主题", accent: t.palette.accent, appearance: appearance, spec: { palette: t.palette }, decor: t.decor || null, bg: bg };
  };
  const applyShareText = (text) => {
    const entry = entryFromShare(JSON.parse(text));
    const list = loadImported(); list.push(entry); saveImported(list);
    THEMES.push(entry); renderThemeItems(); setTheme(entry.id);
    return entry.id;
  };
  window.__coskinApplyShare = applyShareText;

  // 删除/隐藏一个主题：导入的与快捷槽=真删除；内置/磁盘自定义=软隐藏（下次可在别处恢复）
  const deleteTheme = (id) => {
    const idx = THEMES.findIndex((x) => x.id === id);
    if (idx < 0) return { kind: "none" };
    let kind;
    if (id === "quick") { try { localStorage.removeItem(QUICK_KEY); } catch {} kind = "removed"; }
    else if (id.indexOf("imp-") === 0) { saveImported(loadImported().filter((e) => e.id !== id)); kind = "removed"; }
    else { const h = loadHidden(); if (!h.includes(id)) { h.push(id); saveHidden(h); } kind = "hidden"; }
    THEMES.splice(idx, 1);
    if (window.__coskinActive === id) setTheme(null);
    renderThemeItems();
    if (window.__coskinSyncActions) window.__coskinSyncActions();
    return { kind };
  };
  window.__coskinDeleteTheme = deleteTheme;

  // 折叠：点当前主题名弹出/收起浮层列表；选中一个主题后自动收起
  let listOpen = false;
  const setListOpen = (v) => {
    listOpen = v;
    if (v) {
      // 浮层定位：紧贴选择器行下方；空间不够则向上弹
      const top = actionRow.offsetTop + actionRow.offsetHeight + 6;
      items.style.top = top + "px";
      items.style.display = "flex";
    } else {
      items.style.display = "none";
    }
    if (caret) caret.textContent = v ? "▾" : "▸";
  };
  const renderThemeItems = () => {
    items.textContent = "";
    for (const th of THEMES) items.appendChild(makeItem(th.id, th.name, th.accent, () => { setTheme(th.id); setListOpen(false); }));
    items.appendChild(makeItem("__native__", tr("native"), "linear-gradient(135deg,#8a8f98,#e5e7eb)", () => { setTheme(null); setListOpen(false); }));
  };
  renderThemeItems();

  // —— 顶部当前主题选择器（点名字展开列表）+ 固定导出/删除 ——
  const actionRow = D.createElement("div"); actionRow.className = "coskin-actions";
  const nameBtn = D.createElement("button"); nameBtn.className = "coskin-sel"; nameBtn.title = tr("selectTip");
  const caret = D.createElement("span"); caret.className = "coskin-caret"; caret.textContent = "▸";
  const actLabel = D.createElement("span"); actLabel.className = "coskin-act-label";
  nameBtn.appendChild(caret); nameBtn.appendChild(actLabel);
  nameBtn.addEventListener("click", () => setListOpen(!listOpen));
  const expBtn = D.createElement("button"); expBtn.className = "coskin-act"; expBtn.textContent = tr("exportBtn");
  const delBtn = D.createElement("button"); delBtn.className = "coskin-act coskin-act-del"; delBtn.textContent = tr("delBtn");
  let delArmed = null;
  const updateActionBar = () => {
    const id = window.__coskinActive;
    const th = id ? THEMES.find((x) => x.id === id) : null;
    actLabel.textContent = th ? th.name : tr("noSel");
    expBtn.disabled = !th; delBtn.disabled = !th;
    delBtn.textContent = tr("delBtn"); delArmed = null;
  };
  window.__coskinSyncActions = updateActionBar;
  expBtn.addEventListener("click", () => {
    const th = THEMES.find((x) => x.id === window.__coskinActive);
    if (th) triggerExport(th);
  });
  delBtn.addEventListener("click", () => {
    const id = window.__coskinActive;
    if (!id) return;
    if (delArmed !== id) { delArmed = id; delBtn.textContent = tr("delConfirm"); setTimeout(() => { if (delArmed === id) updateActionBar(); }, 2600); return; }
    deleteTheme(id);
  });
  actionRow.appendChild(nameBtn); actionRow.appendChild(expBtn); actionRow.appendChild(delBtn);
  panel.appendChild(actionRow);
  panel.appendChild(items); // 列表紧跟在选择器下方（默认收起）

  // —— B/A 级现场调节：背景可见度 + 深浅翻转 ——
  panel.appendChild(Object.assign(D.createElement("div"), { className: "coskin-div" }));
  const mkCtl = (labelText, defs, attr, onPick) => {
    const row = D.createElement("div"); row.className = "coskin-ctl";
    const lab = D.createElement("span"); lab.className = "coskin-ctl-label"; lab.textContent = labelText;
    row.appendChild(lab);
    for (const [value, text] of defs) {
      const b = D.createElement("button");
      b.className = "coskin-mini"; b.textContent = text; b.setAttribute(attr, value);
      b.addEventListener("click", () => onPick(value));
      row.appendChild(b);
    }
    panel.appendChild(row);
  };
  mkCtl(tr("bg"), [["raw", tr("raw")], ["immersive", tr("immersive")], ["ambient", tr("ambient")], ["subtle", tr("subtle")]], "data-coskin-vis", (v) => {
    state.vis = v;
    if (window.__coskinActive) setTheme(window.__coskinActive, true); else refreshCtls();
  });
  mkCtl(tr("appearance"), [["dark", tr("dark")], ["light", tr("light")]], "data-coskin-app", (v) => {
    if (!window.__coskinActive) return;
    state.appOverride = v;
    setTheme(window.__coskinActive, true);
  });
  mkCtl(tr("pet"), [["on", tr("on")], ["off", tr("off")]], "data-coskin-pet", (v) => {
    state.petOn = v === "on";
    try { localStorage.setItem("coskin.pet.v1", v); } catch {}
    updateDecorVisibility();
    for (const b of D.querySelectorAll("[data-coskin-pet]")) b.classList.toggle("coskin-on", b.getAttribute("data-coskin-pet") === v);
  });
  for (const b of D.querySelectorAll("[data-coskin-pet]")) b.classList.toggle("coskin-on", b.getAttribute("data-coskin-pet") === (state.petOn ? "on" : "off"));

  // —— 图片上传（快捷槽）——
  const quickFromDataUrl = async (rawDataUrl, name) => {
    const img = new Image();
    img.src = rawDataUrl;
    await img.decode();
    const scale = Math.min(1, 2560 / Math.max(img.width, img.height));
    const c = D.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let url = c.toDataURL("image/webp", 0.85);
    if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/jpeg", 0.85);
    const p = await coskinExtractPalette(url);
    const appearance = coskinDecideAppearance(p);
    const spec = { palette: { accent: p.accent, secondary: p.secondary, surfaceTint: p.dominant } };
    const bg = "url(" + JSON.stringify(url) + ") center center / cover no-repeat fixed";
    const entry = { id: "quick", name: name || "我的图片", accent: p.accent, appearance: appearance, spec: spec, bg: bg };
    let saved = true;
    try { localStorage.setItem(QUICK_KEY, JSON.stringify(entry)); } catch { saved = false; }
    const i = THEMES.findIndex((t) => t.id === "quick");
    if (i >= 0) THEMES.splice(i, 1, entry); else THEMES.push(entry);
    renderThemeItems();
    setTheme("quick");
    return saved ? "coskin:quick-saved" : "coskin:quick-applied-unsaved";
  };
  window.__coskinQuickFromDataUrl = quickFromDataUrl;

  panel.appendChild(Object.assign(D.createElement("div"), { className: "coskin-div" }));
  const fileInput = D.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.style.display = "none";
  const UPLOAD_LABEL = tr("makeImg");
  const uploadBtn = makeItem(null, UPLOAD_LABEL, null, () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    uploadBtn.textContent = tr("processing");
    const reader = new FileReader();
    reader.onerror = () => { uploadBtn.textContent = tr("readFail"); setTimeout(() => { uploadBtn.textContent = UPLOAD_LABEL; }, 1800); };
    reader.onload = () => {
      quickFromDataUrl(String(reader.result), f.name.replace(/\\.[^.]+$/, ""))
        .then((r) => { uploadBtn.textContent = r === "coskin:quick-saved" ? UPLOAD_LABEL : tr("tooBig"); })
        .catch(() => { uploadBtn.textContent = tr("imgFail"); })
        .finally(() => { setTimeout(() => { uploadBtn.textContent = UPLOAD_LABEL; }, 2200); });
    };
    reader.readAsDataURL(f);
  });
  panel.appendChild(uploadBtn);
  panel.appendChild(fileInput);

  // —— 上传 .coskin 主题文件（导入别人分享的主题）——
  const shareInput = D.createElement("input");
  shareInput.type = "file";
  shareInput.accept = ".json,.coskin,application/json";
  shareInput.style.display = "none";
  const IMPORT_LABEL = tr("uploadShare");
  const importBtn = makeItem(null, IMPORT_LABEL, null, () => shareInput.click());
  shareInput.addEventListener("change", () => {
    const f = shareInput.files && shareInput.files[0];
    shareInput.value = "";
    if (!f) return;
    importBtn.textContent = tr("importing");
    f.text()
      .then((text) => { applyShareText(text); importBtn.textContent = tr("importOk"); })
      .catch((err) => { importBtn.textContent = tr("importFail") + (err && err.message || tr("badFile")); })
      .finally(() => { setTimeout(() => { importBtn.textContent = IMPORT_LABEL; }, 2400); });
  });
  panel.appendChild(importBtn);
  panel.appendChild(shareInput);

  const hint = D.createElement("div");
  hint.className = "coskin-hint";
  hint.textContent = tr("hint");
  panel.appendChild(hint);

  const fab = D.createElement("button");
  fab.className = "coskin-fab"; fab.textContent = "🎨"; fab.title = tr("header");
  fab.addEventListener("click", () => panel.classList.toggle("coskin-open"));
  ui.appendChild(panel); ui.appendChild(fab);
  D.documentElement.appendChild(ui);
  // 点面板外的任何地方自动收起（重注入前先清掉旧监听，避免累积）
  if (window.__coskinOutsideClick) D.removeEventListener("mousedown", window.__coskinOutsideClick);
  window.__coskinOutsideClick = (e) => {
    if (!ui.contains(e.target)) { panel.classList.remove("coskin-open"); return; }
    // 面板内、但点在列表和选择器之外 → 收起浮层列表
    if (listOpen && !items.contains(e.target) && !nameBtn.contains(e.target)) setListOpen(false);
  };
  D.addEventListener("mousedown", window.__coskinOutsideClick);

  // 品牌行与桌宠的 DOM（装饰层不挡操作；桌宠身体例外——它要能被拖走）
  D.getElementById("coskin-stage")?.remove();
  D.getElementById("coskin-brand")?.remove();
  const brand = D.createElement("div"); brand.id = "coskin-brand";
  brand.appendChild(Object.assign(D.createElement("span"), { className: "cs-dot" }));
  brand.appendChild(Object.assign(D.createElement("span"), { className: "cs-brand-main" }));
  brand.appendChild(Object.assign(D.createElement("span"), { className: "cs-sep", textContent: "/" }));
  brand.appendChild(Object.assign(D.createElement("span"), { className: "cs-brand-sub" }));
  D.documentElement.appendChild(brand);
  // 顶栏标题点击即编辑，回车/失焦保存（按主题存 localStorage 覆盖层，重注入仍生效）
  const makeEditable = (span, key) => {
    span.style.pointerEvents = "auto";
    span.style.cursor = "text";
    span.title = "点击编辑";
    span.addEventListener("click", () => {
      if (!window.__coskinActive) return;
      span.contentEditable = "plaintext-only";
      span.focus();
    });
    const commit = () => {
      if (span.contentEditable !== "plaintext-only") return;
      span.contentEditable = "false";
      const id = window.__coskinActive;
      if (!id) return;
      let all = {};
      try { all = JSON.parse(localStorage.getItem("coskin.decorOverride.v1") || "{}"); } catch {}
      all[id] = all[id] || {};
      all[id][key] = span.textContent.trim();
      try { localStorage.setItem("coskin.decorOverride.v1", JSON.stringify(all)); } catch {}
    };
    span.addEventListener("blur", commit);
    span.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); span.blur(); } });
  };
  makeEditable(brand.querySelector(".cs-brand-main"), "brand");
  makeEditable(brand.querySelector(".cs-brand-sub"), "tagline");
  D.getElementById("coskin-pet")?.remove();
  const pet = D.createElement("div"); pet.id = "coskin-pet";
  const bubble = Object.assign(D.createElement("div"), { className: "cs-pet-bubble" });
  const body = Object.assign(D.createElement("div"), { className: "cs-pet-body" });
  body.title = tr("petDrag");
  for (const cls of ["cs-pet-eye l", "cs-pet-eye r", "cs-pet-cheek l", "cs-pet-cheek r"]) {
    body.appendChild(Object.assign(D.createElement("span"), { className: cls }));
  }
  pet.appendChild(bubble); pet.appendChild(body);
  D.documentElement.appendChild(pet);
  // 桌宠拖拽：抓身体，全屏clamp，位置进 localStorage
  const placePet = (x, y) => {
    x = Math.max(8, Math.min(innerWidth - 60, x));
    y = Math.max(8, Math.min(innerHeight - 60, y));
    pet.style.left = x + "px"; pet.style.top = y + "px";
    pet.style.right = "auto"; pet.style.bottom = "auto";
    pet.classList.toggle("cs-flip", x < 250);
    return { x: x, y: y };
  };
  try {
    const saved = JSON.parse(localStorage.getItem("coskin.pet.pos.v1") || "null");
    if (saved && typeof saved.x === "number") placePet(saved.x, saved.y);
  } catch {}
  body.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const bodyRect = body.getBoundingClientRect();
    const dx = e.clientX - bodyRect.left, dy = e.clientY - bodyRect.top;
    let last = null;
    const move = (ev) => {
      pet.classList.add("cs-drag");
      // 锚点跟身体走：flip 翻边会改变身体在容器里的偏移，每次实时取
      const offset = body.getBoundingClientRect().left - pet.getBoundingClientRect().left;
      last = placePet(ev.clientX - dx - offset, ev.clientY - dy);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      pet.classList.remove("cs-drag");
      if (last) { try { localStorage.setItem("coskin.pet.pos.v1", JSON.stringify(last)); } catch {} }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  window.__coskinTimers.push(setInterval(syncHome, 1200));
  // idle 台词轮播：只在空闲态跑（working/done 时由状态机接管气泡）
  window.__coskinTimers.push(setInterval(() => {
    if (!state.quotes || !state.quotes.length || !window.__coskinActive) return;
    if (state.petMode && state.petMode !== "idle") return;
    state.quoteIdx = (state.quoteIdx + 1) % state.quotes.length;
    const b = D.querySelector("#coskin-pet .cs-pet-bubble");
    if (!b) return;
    b.style.opacity = "0";
    setTimeout(() => { b.textContent = state.quotes[state.quoteIdx]; b.style.opacity = "1"; }, 420);
  }, 9000));

  // —— 状态感知桌宠：选择器无关，测对话区文字长度增长判断 Codex 在不在生成 ——
  const sayState = (arr) => {
    const b = D.querySelector("#coskin-pet .cs-pet-bubble");
    if (!b || !arr || !arr.length) return;
    state.stateQuoteIdx = ((state.stateQuoteIdx || 0) + 1) % arr.length;
    b.style.opacity = "0";
    setTimeout(() => { b.textContent = arr[state.stateQuoteIdx]; b.style.opacity = "1"; }, 260);
  };
  const setPetMode = (mode) => {
    const p = D.getElementById("coskin-pet");
    if (!p) return;
    p.classList.toggle("cs-working", mode === "working");
    p.classList.toggle("cs-done", mode === "done");
    p.classList.toggle("cs-error", mode === "error");
    state.petMode = mode;
  };
  state.petMode = "idle"; state.convLen = -1; state.stable = 0; state.workTick = 0;
  const petTick = () => {
    if (!window.__coskinActive || !state.petOn) return;
    const c = D.querySelector(".thread-scroll-container") || D.querySelector("main.main-surface");
    const len = c ? c.textContent.length : 0;
    const growing = state.convLen >= 0 && len > state.convLen + 1; // 文字在增长=正在生成
    state.convLen = len;
    if (growing) {
      state.stable = 0;
      if (state.petMode !== "working") { setPetMode("working"); sayState(tr("working")); }
      else if (++state.workTick % 5 === 0) sayState(tr("working")); // 生成中每 ~3.5s 换句
    } else {
      state.stable++;
      if (state.petMode === "working" && state.stable >= 2) { setPetMode("done"); sayState(tr("done")); }
      else if (state.petMode === "done" && state.stable >= 5) { setPetMode("idle"); } // 交回 idle 轮播
    }
  };
  window.__coskinPetTick = petTick; // 测试用：可确定性驱动一拍
  window.__coskinTimers.push(setInterval(petTick, 700));

  setTheme(ACTIVE);
  return "coskin:ok";
})()`;
}

export const RESTORE_SCRIPT = `(() => {
  if (window.__coskinTimers) { for (const t of window.__coskinTimers) clearInterval(t); delete window.__coskinTimers; }
  if (window.__coskinOutsideClick) { document.removeEventListener("mousedown", window.__coskinOutsideClick); delete window.__coskinOutsideClick; }
  for (const id of ["coskin-style", "coskin-ui", "coskin-ui-style", "coskin-stage", "coskin-brand", "coskin-pet"]) document.getElementById(id)?.remove();
  for (const p of document.querySelectorAll(".cs-hero-plate")) {
    const col = p.parentElement;
    p.remove();
    if (col && col.dataset.csCol !== undefined) {
      col.style.position = col.dataset.csPrevPos || "";
      col.style.isolation = col.dataset.csPrevIso || "";
      if (col.dataset.csPrevTf !== undefined) col.style.transform = col.dataset.csPrevTf || "";
      col.style.removeProperty("--cs-card-h");
      col.style.removeProperty("--cs-cards-w");
      if (!col.getAttribute("style")) col.removeAttribute("style");
      delete col.dataset.csCol; delete col.dataset.csPrevPos; delete col.dataset.csPrevIso;
      delete col.dataset.csPrevTf; delete col.dataset.csTfDelta; delete col.dataset.csCardVars;
    }
  }
  for (const s of document.querySelectorAll("[data-cs-cards]")) { delete s.dataset.csCards; s.style.removeProperty("--cs-cards-w"); }
  for (const g of document.querySelectorAll(".cs-glyph")) g.remove();
  for (const s of document.querySelectorAll("svg[data-cs-hid]")) { s.style.removeProperty("display"); delete s.dataset.csHid; }
  for (const b of document.querySelectorAll("[data-cs-glyphed]")) delete b.dataset.csGlyphed;
  for (const b of document.querySelectorAll("[data-cs-orig]")) delete b.dataset.csOrig;
  for (const t of document.querySelectorAll("[data-cs-lined]")) {
    t.textContent = t.dataset.csPrevText || "";
    t.style.whiteSpace = t.dataset.csPrevWs || "";
    t.style.removeProperty("line-height");
    t.style.removeProperty("font-size");
    delete t.dataset.csLined; delete t.dataset.csPrevText; delete t.dataset.csPrevWs;
    if (t.dataset.csWrapped !== undefined) t.replaceWith(document.createTextNode(t.textContent));
  }
  for (const el of document.querySelectorAll("[data-cs-titled]")) {
    el.style.color = el.dataset.csPrevColor || "";
    el.style.textShadow = el.dataset.csPrevShadow || "";
    el.style.fontWeight = el.dataset.csPrevWeight || "";
    if (!el.getAttribute("style")) el.removeAttribute("style");
    delete el.dataset.csTitled; delete el.dataset.csPrevColor; delete el.dataset.csPrevShadow; delete el.dataset.csPrevWeight;
  }
  const de = document.documentElement;
  if (window.__coskinPrevShell !== undefined) {
    de.classList.remove("electron-light", "electron-dark");
    if (window.__coskinPrevShell) de.classList.add(window.__coskinPrevShell);
    delete window.__coskinPrevShell;
  }
  window.__coskinActive = null;
  return "coskin:restored";
})()`;

export const PROBE_SCRIPT = `(() => {
  if (!document.getElementById("root")) return null;
  const pet = document.getElementById("coskin-pet");
  const brand = document.getElementById("coskin-brand");
  return {
    active: window.__coskinActive ?? null,
    hasUi: !!document.getElementById("coskin-ui"),
    shell: document.documentElement.className,
    petVisible: !!pet && pet.style.display !== "none",
    brandVisible: !!brand && brand.style.display === "flex",
    heroPlate: !!document.querySelector(".cs-hero-plate"),
  };
})()`;
