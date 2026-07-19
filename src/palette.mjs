// 自定义图片 → 自动取色 → 配色推导。
//
// 重要约定：coskinExtractPalette / coskinDeriveTheme 是【完全自包含】的函数
// （不引用任何模块级变量），因为它们会被 Function.prototype.toString() 内嵌进
// 注入脚本，在 Codex 页面里原样执行；coskinDeriveTheme 同时也被 Node 端直接调用。
// 一份实现，两端共用，避免逻辑漂移。

// 页面端：把图片画到小 canvas 上统计颜色。返回 {luminance, dominant, accent, secondary}
export async function coskinExtractPalette(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = 48, H = 48;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  let lum = 0;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, sat: 0 };
    e.count += 1; e.r += r; e.g += g; e.b += b; e.sat = Math.max(e.sat, sat);
    buckets.set(key, e);
  }
  lum /= n;
  const entries = [...buckets.values()].map((e) => ({
    r: e.r / e.count, g: e.g / e.count, b: e.b / e.count, count: e.count, sat: e.sat,
  }));
  entries.sort((a, b) => b.count - a.count);
  const dominant = entries[0];
  const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const vivid = entries
    .filter((e) => e.sat > 0.22 && e.count >= n * 0.002)
    .sort((a, b) => b.sat * Math.sqrt(b.count) - a.sat * Math.sqrt(a.count));
  const accent = vivid[0] ?? dominant;
  const secondary = vivid.find((e) => dist(e, accent) > 90) ?? accent;
  const hex = (e) => "#" + [e.r, e.g, e.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return { luminance: lum, dominant: hex(dominant), accent: hex(accent), secondary: hex(secondary) };
}

// 两端共用：由取色结果推导一套「保证可读」的主题配色（对比度不足自动往纯白/纯黑推）
export function coskinDeriveTheme(palette) {
  const parse = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (c) => "#" + [c.r, c.g, c.b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const relLum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const contrast = (a, b) => {
    const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const appearance = palette.luminance >= 0.52 ? "light" : "dark";
  const dom = parse(palette.dominant);
  const surface = appearance === "dark"
    ? mix(dom, { r: 10, g: 13, b: 26 }, 0.74)
    : mix(dom, { r: 255, g: 255, b: 255 }, 0.8);
  let text = appearance === "dark"
    ? mix({ r: 244, g: 246, b: 255 }, parse(palette.accent), 0.06)
    : mix({ r: 15, g: 23, b: 42 }, parse(palette.accent), 0.1);
  const pole = appearance === "dark" ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  let guard = 0;
  while (contrast(text, surface) < 4.5 && guard < 12) {
    text = mix(text, pole, 0.3);
    guard += 1;
  }
  return {
    appearance,
    colors: {
      accent: palette.accent.toLowerCase(),
      secondary: palette.secondary.toLowerCase(),
      surface: toHex(surface),
      text: toHex(text),
    },
  };
}

// 外观判定（Stage A）：均值亮度 + 「纸色守卫」。
// 大片浅底配深色笔墨的图（宣纸/素描/报纸风）均值会被拖低，
// 单看 luminance 会误判成深色 —— 主色饱和度低且不算暗时，按浅色纸面处理。
// 自包含：会被 toString() 内嵌进注入脚本。
export function coskinDecideAppearance(palette) {
  const lum = palette.luminance;
  if (lum >= 0.6) return "light";
  if (lum <= 0.42) return "dark";
  const n = parseInt(String(palette.dominant).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const domLum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (sat < 0.3 && domLum > 0.45) return "light"; // 纸色守卫
  return domLum >= 0.5 ? "light" : "dark";
}

// Node 端包装：让页面替我们跑 coskinExtractPalette（returnByValue 直接拿对象）
export function buildPaletteExpression(imageDataUrl) {
  return `(${coskinExtractPalette.toString()})(${JSON.stringify(imageDataUrl)})`;
}
