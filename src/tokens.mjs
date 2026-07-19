// Token 编译器：把极简 spec（几个种子色）编译成对 Codex 官方变量体系的整套覆写。
// 官方变量清单实测自真机（docs/codex-token-inventory.json）：
//   --color-token-*（界面 token）、--color-*（语义色）、--vscode-*（内嵌编辑器/终端）。
//
// coskinCompileTokens 是【完全自包含】函数：Node 直接调用，也会被 toString()
// 内嵌进注入脚本供面板上传时在页面内现场编译。不得引用模块级变量。

// spec: {
//   appearance: 'dark' | 'light',
//   palette: { accent: '#rrggbb', secondary?: '#rrggbb', surfaceTint?: '#rrggbb', ink?: '#rrggbb' },
//   controls?: { visibility?: 'immersive' | 'ambient' | 'subtle' }   // Stage B：壁纸可见度
// }
// 返回 { vars: {...}, colors: {...}, alpha: {...当前档位的表面透明度} }
export function coskinCompileTokens(spec) {
  // ---- 颜色小工具（必须内联，保持自包含） ----
  const parse = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
  const rgba = (c, a) => "rgba(" + clamp(c.r) + ", " + clamp(c.g) + ", " + clamp(c.b) + ", " + a + ")";
  const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const relLum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const contrast = (a, b) => { const [h, l] = [relLum(a), relLum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
  const toHsl = (c) => {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { h, s, l };
  };
  const fromHsl = ({ h, s, l }) => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rgb = [0, 0, 0];
    if (h < 60) rgb = [c, x, 0]; else if (h < 120) rgb = [x, c, 0]; else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c]; else if (h < 300) rgb = [x, 0, c]; else rgb = [c, 0, x];
    return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
  };
  // 把 hue 往目标色相拉，但保留主题的饱和度气质（做 success/error/warning 的「同风格语义色」）
  const semantic = (accentHsl, targetHue, dark) => fromHsl({
    h: targetHue,
    s: Math.min(0.85, Math.max(0.35, accentHsl.s * 0.9 + 0.15)),
    l: dark ? 0.62 : 0.42,
  });
  // 对比度兜底：不足 ratio 就把 fg 往 pole 推
  const ensure = (fg, bg, ratio, pole) => {
    let out = fg, i = 0;
    while (contrast(out, bg) < ratio && i < 14) { out = mix(out, pole, 0.25); i += 1; }
    return out;
  };

  // ---- 壁纸可见度 → 表面透明度 / 描边强度 / 雾纱强度（代码区任何档位不透明）----
  // raw = 原图：零薄纱零幕布，主区全透，可读性靠玻璃卡片与文字投影
  const VIS = {
    raw: { side: 0.42, main: 0, raised: 0.58, overlay: 0.86, deep: 0.93, input: 0.6, line: 0.1, veil: 0 },
    immersive: { side: 0.56, main: 0.38, raised: 0.7, overlay: 0.9, deep: 0.93, input: 0.72, line: 0.16, veil: 0.08 },
    ambient: { side: 0.74, main: 0.72, raised: 0.87, overlay: 0.95, deep: 0.96, input: 0.9, line: 0.28, veil: 0.2 },
    subtle: { side: 0.9, main: 0.92, raised: 0.96, overlay: 0.98, deep: 1, input: 0.96, line: 0.32, veil: 0.3 },
  };
  const alpha = VIS[(spec.controls && spec.controls.visibility) || "ambient"] || VIS.ambient;

  // ---- 种子 ----
  const dark = spec.appearance !== "light";
  const accent = parse(spec.palette.accent);
  const accentHsl = toHsl(accent);
  const secondary = spec.palette.secondary ? parse(spec.palette.secondary) : fromHsl({ h: (accentHsl.h + 40) % 360, s: accentHsl.s * 0.8, l: accentHsl.l });
  const tintSeed = spec.palette.surfaceTint ? parse(spec.palette.surfaceTint) : accent;
  const black = { r: 9, g: 11, b: 20 }, white = { r: 255, g: 255, b: 255 };
  const pole = dark ? white : { r: 0, g: 0, b: 0 };

  // ---- 面：4 层递进 ----
  const surface0 = dark ? mix(tintSeed, black, 0.82) : mix(tintSeed, white, 0.88); // 最底（编辑器/终端底）
  const surface1 = dark ? mix(tintSeed, black, 0.74) : mix(tintSeed, white, 0.82); // 主面
  const surface2 = dark ? mix(tintSeed, black, 0.64) : mix(tintSeed, white, 0.72); // 抬升面（卡片/输入框）
  const surface3 = dark ? mix(tintSeed, black, 0.52) : mix(tintSeed, white, 0.60); // 悬浮面（菜单/弹层）

  // ---- 墨：4 级文字 ----
  let ink0 = spec.palette.ink ? parse(spec.palette.ink) : (dark ? mix(white, accent, 0.06) : mix({ r: 18, g: 22, b: 34 }, accent, 0.10));
  ink0 = ensure(ink0, surface1, 4.5, pole);
  const ink1 = ensure(mix(ink0, surface1, 0.30), surface1, 3.2, pole);
  const ink2 = ensure(mix(ink0, surface1, 0.50), surface1, 2.4, pole);
  const ink3 = mix(ink0, surface1, 0.65); // placeholder/最弱

  // ---- 线（强度随可见度档位：原图/沉浸档几乎无边框，避免"玻璃贴纸"感）----
  const line = rgba(mix(accent, ink0, 0.35), alpha.line);
  const lineHeavy = rgba(mix(accent, ink0, 0.30), Math.min(0.5, alpha.line + 0.17));

  // ---- 语义色（同风格 success/error/warning）----
  const good = semantic(accentHsl, 145, dark);
  const bad = semantic(accentHsl, 4, dark);
  const warn = semantic(accentHsl, 42, dark);
  const link = ensure(dark ? fromHsl({ h: accentHsl.h, s: Math.min(0.9, accentHsl.s + 0.1), l: 0.7 }) : fromHsl({ h: accentHsl.h, s: Math.min(0.9, accentHsl.s + 0.1), l: 0.38 }), surface1, 4.5, pole);
  const onAccent = ensure(relLum(accent) > 0.4 ? { r: 20, g: 22, b: 30 } : white, accent, 4.2, relLum(accent) > 0.4 ? { r: 0, g: 0, b: 0 } : white);

  // ---- 终端 ANSI 16 色（跟随主题气质）----
  const ansiHues = { red: 4, green: 145, yellow: 46, blue: 215, magenta: 300, cyan: 180 };
  const ansi = (hue, bright) => hex(ensure(fromHsl({
    h: hue === -1 ? accentHsl.h : hue,
    s: Math.min(0.8, Math.max(0.4, accentHsl.s * 0.85 + 0.1)),
    l: bright ? 0.72 : 0.6,
  }), surface0, 2.6, pole));

  const A = hex(accent), S2 = hex(secondary);
  const vars = {
    // —— Codex 界面 token（tailwind @theme：--color-token-<slug>）——
    "--color-token-foreground": hex(ink0),
    "--color-token-conversation-body": hex(ink0),
    "--color-token-non-assistant-body-descendant": hex(ink0),
    "--color-token-text-primary": hex(ink0),
    "--color-token-text-secondary": hex(ink1),
    "--color-token-text-tertiary": hex(ink2),
    "--color-token-muted-foreground": hex(ink1),
    "--color-token-description-foreground": hex(ink2),
    "--color-token-input-placeholder-foreground": hex(ink3),
    "--color-token-conversation-summary-leading": hex(ink1),
    "--color-token-conversation-summary-trailing": hex(ink2),
    "--color-token-button-tertiary-foreground": hex(ink1),
    "--color-token-icon-foreground": hex(ink1),
    "--color-token-bg-primary": rgba(surface1, alpha.main),
    "--color-token-bg-secondary": rgba(surface2, alpha.raised),
    "--color-token-bg-subtle": rgba(surface2, alpha.raised),
    "--color-token-bg-fog": rgba(surface0, 0.5),
    "--color-token-main-surface-primary": rgba(surface1, alpha.main),
    "--color-token-side-bar-background": rgba(surface1, alpha.side),
    "--color-token-input-background": rgba(surface2, alpha.input),
    "--color-token-input-border": line,
    "--color-token-dropdown-background": rgba(surface3, alpha.overlay),
    "--color-token-menu-border": line,
    "--color-token-border": line,
    "--color-token-border-default": line,
    "--color-token-border-heavy": lineHeavy,
    "--color-token-button-border": line,
    "--color-token-button-foreground": hex(ink0),
    "--color-token-focus-border": A,
    "--color-token-list-hover-background": rgba(mix(accent, surface2, 0.75), 0.5),
    "--color-token-list-active-selection-background": rgba(mix(accent, surface2, 0.6), 0.6),
    "--color-token-toolbar-hover-background": rgba(mix(accent, surface2, 0.75), 0.45),
    "--color-token-badge-background": rgba(mix(accent, surface2, 0.55), 0.9),
    "--color-token-checkbox-background": A,
    "--color-token-radio-active-foreground": A,
    "--color-token-radio-inactive-border": lineHeavy,
    "--color-token-link": hex(link),
    "--color-token-text-link-foreground": hex(link),
    "--color-token-text-link-active-foreground": hex(mix(link, pole, 0.2)),
    "--color-token-text-preformat-foreground": hex(mix(ink0, secondary, 0.25)),
    "--color-token-text-code-block-background": rgba(surface0, alpha.deep),
    "--color-token-diff-surface": rgba(surface0, alpha.deep),
    "--color-token-diff-editor-removed-line-background": rgba(bad, dark ? 0.18 : 0.14),
    "--color-token-git-decoration-added-resource-foreground": hex(good),
    "--color-token-git-decoration-deleted-resource-foreground": hex(bad),
    "--color-token-scrollbar-slider-background": rgba(mix(ink0, surface1, 0.7), 0.35),
    "--color-token-scrollbar-slider-active-background": rgba(accent, 0.55),
    "--color-token-charts-blue": S2,
    "--color-token-charts-orange": hex(warn),
    "--color-token-on-accent": hex(onAccent),
    // —— 语义 --color-* ——
    "--color-background-accent": A,
    "--color-background-accent-hover": hex(mix(accent, pole, 0.12)),
    "--color-background-accent-active": hex(mix(accent, pole, 0.2)),
    "--color-background-button-primary": A,
    "--color-background-button-secondary-inactive": rgba(surface2, 0.9),
    "--color-background-button-secondary-active": rgba(mix(accent, surface2, 0.7), 0.9),
    "--color-background-button-tertiary": "transparent",
    "--color-background-elevated-primary-opaque": hex(surface2),
    "--color-background-elevated-secondary": rgba(surface2, 0.9),
    "--color-background-status-success": rgba(good, 0.18),
    "--color-background-status-error": rgba(bad, 0.18),
    "--color-background-status-warning": rgba(warn, 0.18),
    "--color-background-surface": rgba(surface1, 0.9),
    "--color-background-panel": rgba(surface1, 0.94),
    "--color-text-foreground": hex(ink0),
    "--color-text-accent": A,
    "--color-text-on-accent": hex(onAccent),
    "--color-text-error": hex(ensure(bad, surface1, 4.5, pole)),
    "--color-text-button-secondary": hex(ink0),
    "--color-icon-primary": hex(ink1),
    "--color-icon-secondary": hex(ink2),
    "--color-icon-success": hex(good),
    "--color-icon-warning": hex(warn),
    "--color-accent-green": hex(good),
    "--color-accent-red": hex(bad),
    "--color-accent-yellow": hex(warn),
    "--color-border": line,
    "--color-border-heavy": lineHeavy,
    "--color-editor-added": hex(good),
    "--codex-base-accent": A,
    // —— 内嵌编辑器 / 终端（--vscode-*，只覆写高影响项）——
    "--vscode-foreground": hex(ink0),
    "--vscode-descriptionForeground": hex(ink2),
    "--vscode-icon-foreground": hex(ink1),
    "--vscode-textLink-foreground": hex(link),
    "--vscode-input-foreground": hex(ink0),
    "--vscode-input-placeholderForeground": hex(ink3),
    "--vscode-menu-background": hex(surface3),
    "--vscode-menu-foreground": hex(ink0),
    "--vscode-list-hoverBackground": rgba(mix(accent, surface2, 0.75), 0.4),
    "--vscode-list-inactiveSelectionBackground": rgba(mix(accent, surface2, 0.6), 0.45),
    "--vscode-editor-background": hex(surface0),
    "--vscode-editor-foreground": hex(ink0),
    "--vscode-editorLineNumber-foreground": hex(ink3),
    "--vscode-editorLineNumber-activeForeground": hex(ink1),
    "--vscode-terminal-background": hex(surface0),
    "--vscode-terminal-foreground": hex(ink0),
    "--vscode-terminalCursor-foreground": A,
    "--vscode-terminal-ansiBlack": hex(dark ? surface2 : mix(ink0, surface0, 0.1)),
    "--vscode-terminal-ansiBrightBlack": hex(ink3),
    "--vscode-terminal-ansiRed": ansi(ansiHues.red, false),
    "--vscode-terminal-ansiBrightRed": ansi(ansiHues.red, true),
    "--vscode-terminal-ansiGreen": ansi(ansiHues.green, false),
    "--vscode-terminal-ansiBrightGreen": ansi(ansiHues.green, true),
    "--vscode-terminal-ansiYellow": ansi(ansiHues.yellow, false),
    "--vscode-terminal-ansiBrightYellow": ansi(ansiHues.yellow, true),
    "--vscode-terminal-ansiBlue": ansi(ansiHues.blue, false),
    "--vscode-terminal-ansiBrightBlue": ansi(ansiHues.blue, true),
    "--vscode-terminal-ansiMagenta": ansi(ansiHues.magenta, false),
    "--vscode-terminal-ansiBrightMagenta": ansi(ansiHues.magenta, true),
    "--vscode-terminal-ansiCyan": ansi(ansiHues.cyan, false),
    "--vscode-terminal-ansiBrightCyan": ansi(ansiHues.cyan, true),
    "--vscode-terminal-ansiWhite": hex(dark ? ink1 : surface0),
    "--vscode-terminal-ansiBrightWhite": hex(dark ? white : ink0),
    "--vscode-statusBar-border": line,
    "--vscode-panelTitle-activeBorder": A,
  };

  return {
    vars,
    alpha,
    colors: {
      accent: A,
      secondary: S2,
      surface: hex(surface1),
      surfaceDeep: hex(surface0),
      surfaceRaised: hex(surface2),
      surfaceOverlay: hex(surface3),
      text: hex(ink0),
      textMuted: hex(ink1),
      link: hex(link),
      good: hex(good),
      bad: hex(bad),
      warn: hex(warn),
    },
  };
}
