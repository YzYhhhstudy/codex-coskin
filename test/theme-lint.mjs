// 主题体检：每款内置主题都要能通过 token 编译 + CSS 生成，且核心文字对比度达标。
// 纯 Node、零 CDP。加新主题必跑：node test/theme-lint.mjs
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coskinCompileTokens } from "../src/tokens.mjs";
import { coskinBuildCss, backgroundFromTheme } from "../src/css.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HEX6 = /^#[0-9a-f]{6}$/i;
const failures = [];
const fail = (id, msg) => { console.log(`  ❌ ${id}: ${msg}`); failures.push(id); };

const files = (await readdir(join(ROOT, "themes"))).filter((f) => f.endsWith(".json")).sort();
console.log(`体检 ${files.length} 款内置主题：`);
for (const f of files) {
  const id = f.replace(/\.json$/, "");
  let theme;
  try { theme = JSON.parse(await readFile(join(ROOT, "themes", f), "utf8")); }
  catch (e) { fail(id, "JSON 解析失败：" + e.message); continue; }

  const p = theme.palette;
  if (!p || !["accent", "secondary", "surfaceTint", "ink"].every((k) => HEX6.test(p[k] ?? ""))) {
    fail(id, "palette 四色必须都是 #rrggbb"); continue;
  }
  if (!theme.name || !["light", "dark"].includes(theme.appearance)) { fail(id, "缺 name 或 appearance 非法"); continue; }
  if (theme.background?.css?.includes("url(")) { fail(id, "background.css 不允许外部资源"); continue; }

  try {
    const compiled = coskinCompileTokens({ appearance: theme.appearance, palette: p });
    // 对比度守卫：正文文字 vs 主表面 ≥ 4.5（WCAG AA 正文）
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      const lin = ch.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    };
    const c = compiled.colors;
    const [hi, lo] = [lum(c.text), lum(c.surface)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < 4.5) { fail(id, `正文对比度 ${ratio.toFixed(2)} < 4.5`); continue; }
    coskinBuildCss(theme, backgroundFromTheme(theme)); // 不抛即通过
    console.log(`  ✅ ${theme.name} (${id}, ${theme.appearance}, 对比度 ${ratio.toFixed(1)})`);
  } catch (e) {
    fail(id, "编译失败：" + e.message);
  }
}

if (failures.length) { console.error(`\n${failures.length} 款不合格：${failures.join("、")}`); process.exit(1); }
console.log("\n全部内置主题体检通过 ✅");
