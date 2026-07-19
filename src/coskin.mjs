#!/usr/bin/env node
// CoSkin — Codex Desktop 换肤 MVP
// 用法： node src/coskin.mjs <menu|launch|list|apply|restore|status|screenshot>

import { readdir, readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

import { withPageTargets, Cdp, listTargets, pageTargets } from "./cdp.mjs";
import { DEFAULT_PORT, appState, ensureSkinnable, findApp } from "./launcher.mjs";
import { RESTORE_SCRIPT, PROBE_SCRIPT, backgroundFromTheme, buildInjectionScript } from "./css.mjs";
import { buildPaletteExpression, coskinDecideAppearance } from "./palette.mjs";
import { coskinCompileTokens } from "./tokens.mjs";

const HEX6 = /^#[0-9a-f]{6}$/i;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const THEMES_DIR = join(ROOT, "themes");
const CUSTOM_DIR = join(THEMES_DIR, "custom");
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

const major = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(major) || major < 22) {
  console.error(`需要 Node.js 22 或更新版本（当前 ${process.versions.node}）。`);
  process.exit(1);
}

// ---------- 主题加载 ----------

async function loadBuiltinThemes() {
  const files = (await readdir(THEMES_DIR, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();
  const themes = [];
  for (const file of files) {
    const theme = JSON.parse(await readFile(join(THEMES_DIR, file), "utf8"));
    themes.push({ ...theme, kind: "builtin" });
  }
  return themes;
}

async function loadCustomThemes() {
  let dirs = [];
  try {
    dirs = (await readdir(CUSTOM_DIR, { withFileTypes: true })).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
  const themes = [];
  for (const dir of dirs) {
    try {
      const themePath = join(CUSTOM_DIR, dir.name, "theme.json");
      const theme = JSON.parse(await readFile(themePath, "utf8"));
      themes.push({ ...theme, kind: "custom", dir: join(CUSTOM_DIR, dir.name) });
    } catch {}
  }
  return themes.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"));
}

async function loadAllThemes() {
  return [...(await loadBuiltinThemes()), ...(await loadCustomThemes())];
}

async function imageDataUrl(path) {
  const ext = extname(path).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error(`只支持 PNG / JPG / JPEG / WebP，收到：${ext || "无后缀"}`);
  const info = await stat(path);
  if (info.size === 0) throw new Error("图片是空文件。");
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过 8MB 上限，请先压缩一下。`);
  }
  const bytes = await readFile(path);
  return `data:${MIME[ext]};base64,${bytes.toString("base64")}`;
}

// v1 主题（四色 colors）归一化成 v2 种子色板
function paletteOf(theme) {
  return (
    theme.palette ?? {
      accent: theme.colors.accent,
      secondary: theme.colors.secondary,
      surfaceTint: theme.colors.surface,
      ink: theme.colors.text,
    }
  );
}

// 注入面板携带：全部内置主题 + （若在用）当前自定义主题。
// 负载只带 {spec, bg}，CSS 由页面按当前可见度/外观现场编译。
// 其余自定义主题不随包注入（图片体积大），从终端菜单选择时再注入。
async function switcherPayload(activeTheme) {
  const builtins = await loadBuiltinThemes();
  const list = [...builtins];
  if (activeTheme && activeTheme.kind === "custom" && !list.some((t) => t.id === activeTheme.id)) {
    list.push(activeTheme);
  }
  const payload = [];
  for (const theme of list) {
    const palette = paletteOf(theme);
    const bg = theme.backgroundFile
      ? backgroundFromTheme(theme, await imageDataUrl(join(theme.dir, theme.backgroundFile)))
      : backgroundFromTheme(theme);
    payload.push({
      id: theme.id,
      name: theme.name,
      accent: palette.accent,
      appearance: theme.appearance === "light" ? "light" : "dark",
      spec: { palette },
      decor: theme.decor ?? null,
      bg,
    });
  }
  return payload;
}

// ---------- 核心动作 ----------

function log(msg) {
  console.log(msg);
}

async function ensureReady(port, confirmRestart = null) {
  const { relaunched } = await ensureSkinnable(port, { log, confirmRestart });
  if (relaunched) log("Codex 已就绪（本次启动带本机调试端口）。");
  return relaunched;
}

// 终端里问一句 y/N；非交互环境直接返回 false（宁可失败也不打断用户）
async function askYesNo(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

const RESTART_QUESTION =
  "换肤需要把 Codex 重启到本机调试模式（对话记录会保留，Codex 会自动恢复）。现在重启它吗？";

async function injectEverywhere(port, script) {
  const results = await withPageTargets(port, async (cdp) => {
    const probe = await cdp.evaluate(PROBE_SCRIPT);
    if (probe === null) return "skip";
    return cdp.evaluate(script, { timeoutMs: 60000 });
  });
  const applied = results.filter((r) => r.ok && r.value !== "skip");
  const failed = results.filter((r) => !r.ok);
  if (applied.length === 0) {
    const hint = failed[0]?.error?.message ?? "没找到带 #root 的 Codex 窗口";
    throw new Error(`注入失败：${hint}`);
  }
  return { applied: applied.length, failed: failed.length };
}

async function applyTheme(port, themeId, confirmRestart = null) {
  const themes = await loadAllThemes();
  const theme = themes.find((t) => t.id === themeId);
  if (!theme) {
    throw new Error(`没有叫「${themeId}」的主题。可用：${themes.map((t) => t.id).join("、")}`);
  }
  await ensureReady(port, confirmRestart);
  log(`正在应用主题「${theme.name}」…`);
  const payload = await switcherPayload(theme);
  const { applied } = await injectEverywhere(port, buildInjectionScript(payload, theme.id));
  log(`✅ 已应用「${theme.name}」（${applied} 个窗口）。右下角 🎨 按钮可随时一键切换或还原。`);
  return theme;
}

async function restore(port) {
  const state = await appState(findApp(), port);
  if (!state.cdpAlive) {
    log("Codex 没在调试模式下运行 —— 皮肤本来就只在这种会话里存在，现在已是官方原生界面。");
    return;
  }
  await injectEverywhere(port, RESTORE_SCRIPT).catch((error) => {
    log(`还原时没找到注入痕迹（${error.message}），界面应已是原生状态。`);
  });
  log("✅ 已还原官方界面（下次正常启动 Codex 也不会带任何皮肤）。");
}

async function createCustomTheme(port, imagePath, displayName, confirmRestart = null) {
  const cleanPath = resolve(imagePath);
  const dataUrl = await imageDataUrl(cleanPath);
  await ensureReady(port, confirmRestart);

  log("正在图片里取色…");
  const targets = pageTargets(await listTargets(port));
  if (targets.length === 0) throw new Error("没找到 Codex 页面窗口。");
  let palette = null;
  for (const target of targets) {
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl).catch(() => null);
    if (!cdp) continue;
    try {
      const probe = await cdp.evaluate(PROBE_SCRIPT);
      if (probe === null) continue;
      palette = await cdp.evaluate(buildPaletteExpression(dataUrl), { awaitPromise: true, timeoutMs: 60000 });
      break;
    } finally {
      cdp.close();
    }
  }
  if (!palette || typeof palette.luminance !== "number") {
    throw new Error("取色失败：连不上 Codex 主窗口，或图片无法解码。");
  }

  const appearance = coskinDecideAppearance(palette);
  const spec = {
    appearance,
    palette: { accent: palette.accent, secondary: palette.secondary, surfaceTint: palette.dominant },
  };
  const name = (displayName ?? "").trim() || basename(cleanPath, extname(cleanPath));
  const hash = createHash("md5").update(dataUrl).digest("hex").slice(0, 8);
  const asciiSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const id = asciiSlug ? `c-${asciiSlug}` : `c-${hash}`;

  const dir = join(CUSTOM_DIR, id);
  await mkdir(dir, { recursive: true });
  const backgroundFile = `bg${extname(cleanPath).toLowerCase()}`;
  await copyFile(cleanPath, join(dir, backgroundFile));
  const theme = { schemaVersion: 2, id, name, appearance, palette: spec.palette, backgroundFile, sourceImage: cleanPath };
  await writeFile(join(dir, "theme.json"), JSON.stringify(theme, null, 2) + "\n");
  log(`✅ 主题「${name}」已生成（${appearance === "dark" ? "深色" : "浅色"}调，强调色 ${spec.palette.accent}），保存在 themes/custom/${id}/`);
  return id;
}

// 一句话/AI 产出的 spec 文件 → 正式主题。spec 格式见 docs/theme-prompts.md。
async function createThemeFromSpec(specPath) {
  const raw = JSON.parse(await readFile(resolve(specPath), "utf8"));
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error("spec 缺少 name。");
  const appearance = raw.appearance === "light" ? "light" : "dark";
  const palette = raw.palette ?? {};
  if (!HEX6.test(palette.accent ?? "")) throw new Error("spec.palette.accent 必须是 #rrggbb。");
  for (const key of ["secondary", "surfaceTint", "ink"]) {
    if (palette[key] != null && !HEX6.test(palette[key])) throw new Error(`spec.palette.${key} 必须是 #rrggbb。`);
  }
  const name = raw.name.trim();
  const asciiSlug = (raw.id ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const id = asciiSlug ? `c-${asciiSlug}` : `c-spec-${Date.now().toString(36)}`;
  const dir = join(CUSTOM_DIR, id);
  await mkdir(dir, { recursive: true });

  const theme = { schemaVersion: 2, id, name, appearance, palette };
  if (typeof raw.wallpaper === "string" && raw.wallpaper.trim()) {
    const wp = resolve(cleanDraggedPath(raw.wallpaper));
    const ext = extname(wp).toLowerCase();
    if (!IMAGE_EXT.has(ext)) throw new Error(`wallpaper 只支持 PNG / JPG / WebP，收到：${ext}`);
    theme.backgroundFile = `bg${ext}`;
    await copyFile(wp, join(dir, theme.backgroundFile));
  } else if (raw.background?.css && typeof raw.background.css === "string") {
    if (raw.background.css.includes("url(")) throw new Error("background.css 不允许引用外部资源。");
    theme.background = { css: raw.background.css };
  } else {
    // 没给壁纸也没给渐变：由种子色自动合成一套体面的渐变底
    const { colors } = coskinCompileTokens({ appearance, palette });
    theme.background = {
      css:
        `radial-gradient(1100px 700px at 86% -8%, ${colors.accent}30 0%, transparent 55%), ` +
        `radial-gradient(900px 650px at -6% 108%, ${colors.secondary}26 0%, transparent 60%), ` +
        `linear-gradient(160deg, ${colors.surfaceDeep} 0%, ${colors.surface} 55%, ${colors.surfaceRaised} 100%)`,
    };
  }
  await writeFile(join(dir, "theme.json"), JSON.stringify(theme, null, 2) + "\n");
  log(`✅ spec 主题「${name}」已生成（${appearance === "dark" ? "深色" : "浅色"}调），保存在 themes/custom/${id}/`);
  return id;
}

// —— 分享闭环：主题 ↔ 单个 .coskin.json 文件（壁纸以 base64 内嵌）——
const SHARE_FORMAT = "coskin-theme";
const EXT_BY_MIME = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

function safeFileName(name) {
  return String(name).replace(/[/\\:*?"<>|\s]+/g, "_").slice(0, 60) || "theme";
}

async function exportTheme(id, outArg) {
  const themes = await loadAllThemes();
  const theme = themes.find((t) => t.id === id);
  if (!theme) throw new Error(`没有叫「${id}」的主题。用 list 查看可用主题。`);
  const share = {
    format: SHARE_FORMAT,
    formatVersion: 1,
    theme: {
      id: theme.id,
      name: theme.name,
      appearance: theme.appearance === "light" ? "light" : "dark",
      palette: paletteOf(theme),
    },
  };
  if (theme.decor) share.theme.decor = theme.decor;
  if (theme.backgroundFile) {
    const bytes = await readFile(join(theme.dir, theme.backgroundFile));
    const ext = extname(theme.backgroundFile).toLowerCase();
    share.wallpaper = { mime: MIME[ext] ?? "image/jpeg", dataBase64: bytes.toString("base64") };
  } else if (theme.background?.css) {
    share.theme.background = { css: theme.background.css };
  }
  const out = outArg
    ? resolve(cleanDraggedPath(outArg))
    : join(ROOT, "output", `${safeFileName(theme.name)}.coskin.json`);
  await mkdir(dirname(out), { recursive: true });
  const text = JSON.stringify(share);
  await writeFile(out, text);
  log(`📦 已导出「${theme.name}」→ ${out}（${(text.length / 1024 / 1024).toFixed(2)}MB）`);
  log("把这个文件发给任何人，对方在 CoSkin 菜单选「导入 .coskin 主题文件」即可一键装上。");
  return out;
}

async function importThemeFile(sharePath) {
  const file = resolve(cleanDraggedPath(sharePath));
  const raw = JSON.parse(await readFile(file, "utf8"));
  if (raw.format !== SHARE_FORMAT || !raw.theme) throw new Error("这不是 CoSkin 主题文件（.coskin.json）。");
  const t = raw.theme;
  if (typeof t.name !== "string" || !t.name.trim()) throw new Error("主题文件缺少 name。");
  if (!HEX6.test(t.palette?.accent ?? "")) throw new Error("主题文件的 palette.accent 非法。");
  const appearance = t.appearance === "light" ? "light" : "dark";
  let base = String(t.id ?? "").replace(/[^a-z0-9_-]/gi, "") || `shared-${createHash("md5").update(t.name).digest("hex").slice(0, 6)}`;
  if (!base.startsWith("c-")) base = `c-${base}`;
  let id = base;
  for (let n = 2; existsSync(join(CUSTOM_DIR, id)); n++) id = `${base}-${n}`;
  const dir = join(CUSTOM_DIR, id);
  await mkdir(dir, { recursive: true });
  const theme = { schemaVersion: 2, id, name: t.name.trim(), appearance, palette: t.palette };
  if (t.decor) theme.decor = t.decor;
  if (raw.wallpaper?.dataBase64) {
    const bytes = Buffer.from(raw.wallpaper.dataBase64, "base64");
    if (!bytes.length) throw new Error("主题文件里的壁纸是空的。");
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("主题文件里的壁纸超过 8MB 上限。");
    theme.backgroundFile = `bg${EXT_BY_MIME[raw.wallpaper.mime] ?? ".jpg"}`;
    await writeFile(join(dir, theme.backgroundFile), bytes);
  } else if (typeof t.background?.css === "string" && !t.background.css.includes("url(")) {
    theme.background = { css: t.background.css };
  } else {
    const { colors } = coskinCompileTokens({ appearance, palette: t.palette });
    theme.background = {
      css: `linear-gradient(160deg, ${colors.surfaceDeep} 0%, ${colors.surface} 55%, ${colors.surfaceRaised} 100%)`,
    };
  }
  await writeFile(join(dir, "theme.json"), JSON.stringify(theme, null, 2) + "\n");
  log(`✅ 已导入主题「${theme.name}」（id: ${id}）`);
  return id;
}

async function status(port) {
  const appPath = findApp();
  const state = await appState(appPath, port);
  log(`应用：${appPath}`);
  log(`运行中：${state.running ? "是" : "否"}    调试端口 ${port}：${state.cdpAlive ? "可用" : "未开"}`);
  if (state.cdpAlive) {
    const results = await withPageTargets(port, (cdp) => cdp.evaluate(PROBE_SCRIPT));
    for (const r of results) {
      if (!r.ok) { log(`  · ${r.target.url} —— 连接失败：${r.error.message}`); continue; }
      if (r.value === null) { log(`  · ${r.target.url} —— 非主界面窗口`); continue; }
      log(`  · ${r.target.url} —— 当前皮肤：${r.value.active ?? "官方原生"}${r.value.hasUi ? "（🎨 面板已挂载）" : ""}`);
    }
  }
  const themes = await loadAllThemes();
  log(`可用主题：${themes.map((t) => `${t.name}(${t.id})`).join("、")}`);
}

async function screenshot(port, outPath) {
  const targets = pageTargets(await listTargets(port));
  for (const target of targets) {
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl).catch(() => null);
    if (!cdp) continue;
    try {
      const probe = await cdp.evaluate(PROBE_SCRIPT);
      if (probe === null) continue;
      await cdp.send("Page.bringToFront").catch(() => {});
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, { timeoutMs: 30000 });
      const file = outPath ?? join(ROOT, `coskin-shot-${Date.now()}.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      log(`📸 截图已保存：${file}`);
      return file;
    } finally {
      cdp.close();
    }
  }
  throw new Error("没找到可截图的 Codex 主窗口。");
}

// ---------- 交互式菜单（傻瓜模式） ----------

function cleanDraggedPath(input) {
  let s = input.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1);
  } else {
    s = s.replace(/\\(.)/g, "$1"); // 终端拖拽会转义空格和括号
  }
  if (s.startsWith("~/")) s = join(homedir(), s.slice(2));
  return s;
}

async function menu(port) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const themes = await loadAllThemes();
      console.log("\n══════════ CoSkin · Codex 一键换肤 ══════════");
      themes.forEach((t, i) => {
        console.log(`  ${i + 1}) 应用主题：${t.name}${t.kind === "custom" ? "（自定义）" : ""}`);
      });
      const nCustom = themes.length + 1;
      const nImport = themes.length + 2;
      const nExport = themes.length + 3;
      const nRestore = themes.length + 4;
      const nStatus = themes.length + 5;
      console.log(`  ${nCustom}) 用我自己的图片做主题…`);
      console.log(`  ${nImport}) 导入 .coskin 主题文件…`);
      console.log(`  ${nExport}) 导出主题为 .coskin 文件（分享给朋友）…`);
      console.log(`  ${nRestore}) 还原官方界面`);
      console.log(`  ${nStatus}) 查看状态`);
      console.log("  0) 退出");
      const answer = (await rl.question("请输入编号并回车：")).trim();
      const n = Number(answer);
      // Codex 在运行时，重启前必须当面征得同意
      const confirmRestart = async () => {
        const yes = (await rl.question(`${RESTART_QUESTION} [y/N] `)).trim().toLowerCase();
        return yes === "y" || yes === "yes";
      };
      try {
        if (answer === "0") break;
        if (Number.isInteger(n) && n >= 1 && n <= themes.length) {
          await applyTheme(port, themes[n - 1].id, confirmRestart);
        } else if (n === nCustom) {
          const raw = await rl.question("把图片文件拖进这个窗口，然后回车：");
          const path = cleanDraggedPath(raw);
          const name = (await rl.question("给主题起个名字（直接回车用文件名）：")).trim();
          const id = await createCustomTheme(port, path, name, confirmRestart);
          await applyTheme(port, id, confirmRestart);
        } else if (n === nImport) {
          const raw = await rl.question("把 .coskin.json 文件拖进这个窗口，然后回车：");
          const id = await importThemeFile(raw);
          await applyTheme(port, id, confirmRestart);
        } else if (n === nExport) {
          const which = (await rl.question("导出哪个主题？输入上面列表里的编号：")).trim();
          const idx = Number(which);
          if (!Number.isInteger(idx) || idx < 1 || idx > themes.length) throw new Error("编号不对。");
          await exportTheme(themes[idx - 1].id);
        } else if (n === nRestore) {
          await restore(port);
        } else if (n === nStatus) {
          await status(port);
        } else {
          console.log("没有这个选项，再试一次。");
        }
      } catch (error) {
        console.error(`❌ ${error.message}`);
      }
    }
  } finally {
    rl.close();
  }
}

// ---------- 入口 ----------

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const command = args[0] ?? "menu";
const port = Number(argValue(args, "--port") ?? process.env.COSKIN_PORT ?? DEFAULT_PORT);

// --restart-ok 表示提前授权重启；否则运行中的 Codex 只会在终端里当面问你
const cliConfirm = args.includes("--restart-ok") ? async () => true : () => askYesNo(RESTART_QUESTION);

try {
  if (command === "menu") {
    await menu(port);
  } else if (command === "launch") {
    await ensureReady(port, cliConfirm);
    log("✅ Codex 已在可换肤模式下运行。");
  } else if (command === "list") {
    for (const t of await loadAllThemes()) log(`${t.id}\t${t.name}\t${t.kind}`);
  } else if (command === "apply") {
    const image = argValue(args, "--image");
    const specPath = argValue(args, "--spec");
    if (image) {
      const id = await createCustomTheme(port, cleanDraggedPath(image), argValue(args, "--name"), cliConfirm);
      await applyTheme(port, id, cliConfirm);
    } else if (specPath) {
      const id = await createThemeFromSpec(cleanDraggedPath(specPath));
      await applyTheme(port, id, cliConfirm);
    } else {
      const id = args[1];
      if (!id || id.startsWith("--")) {
        throw new Error("用法：apply <主题id> ｜ apply --image <图片> [--name 名字] ｜ apply --spec <spec.json>");
      }
      await applyTheme(port, id, cliConfirm);
    }
  } else if (command === "export") {
    const id = args[1];
    if (!id || id.startsWith("--")) throw new Error("用法：export <主题id> [--out 输出路径]");
    await exportTheme(id, argValue(args, "--out"));
  } else if (command === "import") {
    const file = args[1];
    if (!file) throw new Error("用法：import <文件.coskin.json>");
    const id = await importThemeFile(file);
    log(`应用它：node src/coskin.mjs apply ${id}（或菜单里直接选）`);
  } else if (command === "restore") {
    await restore(port);
  } else if (command === "status") {
    await status(port);
  } else if (command === "screenshot") {
    await screenshot(port, argValue(args, "--out"));
  } else {
    log(`未知命令：${command}\n可用：menu | launch | list | apply | restore | status | screenshot`);
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
// CDP WebSocket 的关闭握手偶发挂起会拖住事件循环，命令跑完显式退出
process.exit(0);
