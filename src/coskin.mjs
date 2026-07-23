#!/usr/bin/env node
// CoSkin — Codex Desktop 换肤 MVP
// 用法： node src/coskin.mjs <menu|launch|list|apply|restore|status|screenshot>

import { readdir, readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

import { withPageTargets, Cdp, listTargets, pageTargets } from "./cdp.mjs";
import { DEFAULT_PORT, appState, ensureSkinnable, findApp } from "./launcher.mjs";
import { CONTRACT_SCRIPT, RESTORE_SCRIPT, PROBE_SCRIPT, backgroundFromTheme, buildInjectionScript } from "./css.mjs";
import { buildPaletteExpression, coskinDecideAppearance } from "./palette.mjs";
import { coskinCompileTokens } from "./tokens.mjs";

const HEX6 = /^#[0-9a-f]{6}$/i;
const run = promisify(execFile);

async function rememberTheme(id) {
  try { await writeFile(STATE_FILE, JSON.stringify({ lastTheme: id }) + "\n"); } catch {}
}
async function lastTheme() {
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")).lastTheme || null; } catch { return null; }
}
const REPO_RAW = "https://raw.githubusercontent.com/YzYhhhstudy/codex-coskin/master/package.json";

// ---------- 版本 / 更新 ----------
async function localVersion() {
  try { return JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version || "0.0.0"; }
  catch { return "0.0.0"; }
}
async function latestVersion() {
  try {
    const res = await fetch(REPO_RAW, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return JSON.parse(await res.text()).version || null;
  } catch { return null; }
}
function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
// 最多查一次，best-effort：离线/超时都返回 updateAvailable:false
async function getUpdateInfo() {
  const current = await localVersion();
  const latest = await latestVersion();
  return { current, latest, updateAvailable: !!latest && cmpVer(latest, current) > 0 };
}
async function currentActiveTheme(port) {
  const results = await withPageTargets(port, (cdp) => cdp.evaluate("window.__coskinActive || null"));
  for (const r of results) if (r.ok && r.value) return r.value;
  return null;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const THEMES_DIR = join(ROOT, "themes");
const CUSTOM_DIR = join(THEMES_DIR, "custom");
const STATE_FILE = join(ROOT, ".coskin-state.json"); // 定义须在 ROOT 之后
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

// 图片校验统一入口：后缀 + 非空 + ≤8MB。--image / --spec 的壁纸都走这里，避免某条路漏检。
async function assertImageFile(path) {
  const ext = extname(path).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error(`只支持 PNG / JPG / JPEG / WebP，收到：${ext || "无后缀"}`);
  const info = await stat(path);
  if (info.size === 0) throw new Error("图片是空文件。");
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过 8MB 上限，请先压缩一下。`);
  }
  return ext;
}

async function imageDataUrl(path) {
  const ext = await assertImageFile(path);
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
// 面板与 CLI 同步：带上所有内置 + 所有磁盘自定义主题（壁纸内嵌，体积换一致性）。
async function switcherPayload(activeTheme) {
  const builtins = await loadBuiltinThemes();
  const customs = await loadCustomThemes();
  const list = [...builtins, ...customs];
  if (activeTheme && !list.some((t) => t.id === activeTheme.id)) {
    list.push(activeTheme); // 兜底：极少数情况下 active 不在磁盘（如临时对象）
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

// 无窗口启动器（.app / .vbs）没有终端可交互：确认、报错、完成提示都走系统原生弹窗。
async function guiConfirm(question) {
  try {
    if (process.platform === "darwin") {
      // 必须借 System Events 弹：CoSkin.app 是 LSUIElement（不进 Dock 的后台型 app），
      // 它自己弹的对话框不会被带到最前——用户压根看不见，表现就是"点了没反应"。
      const { stdout } = await run("osascript", ["-e",
        `tell application "System Events" to display dialog ${JSON.stringify(question)} with title "CoSkin" buttons {"取消", "重启"} default button "重启" cancel button "取消"`]);
      return /重启/.test(stdout);
    }
    if (process.platform === "win32") {
      // 和 mac 用 System Events 同理：无窗口启动器弹的框会被别的窗口盖住，
      // 用一个 TopMost 的宿主窗体当 owner 顶到最前，否则用户看不见 → 像"点了没反应"。
      const { stdout } = await run("powershell", ["-NoProfile", "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; [System.Windows.Forms.MessageBox]::Show($o, ${JSON.stringify(question)}, 'CoSkin', 'YesNo', 'Question')`]);
      return /Yes/i.test(stdout);
    }
  } catch { /* 用户点了取消 = 非零退出，按「不重启」处理 */ }
  return false;
}
async function guiAlert(message) {
  try {
    if (process.platform === "darwin") {
      await run("osascript", ["-e", `tell application "System Events" to display dialog ${JSON.stringify(message)} with title "CoSkin" buttons {"好"} default button "好"`]);
    } else if (process.platform === "win32") {
      await run("powershell", ["-NoProfile", "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; [System.Windows.Forms.MessageBox]::Show($o, ${JSON.stringify(message)}, 'CoSkin')`]);
    }
  } catch {}
}
async function guiNotify(message) {
  try {
    if (process.platform === "darwin") await run("osascript", ["-e", `display notification ${JSON.stringify(message)} with title "CoSkin"`]);
  } catch {}
}

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
  return {
    applied: applied.length,
    failed: failed.length,
    failures: failed.map((r) => ({ url: r.target?.url, message: r.error?.message ?? "未知错误" })),
  };
}

// 多窗口部分失败别静默：其余窗口成功了，但失败的要如实报出来，否则「✅ 已应用」会误导。
function warnPartialFailure(action, failed, failures) {
  if (!failed) return;
  log(`⚠️ 另有 ${failed} 个窗口${action}失败（上面成功的已生效）：`);
  for (const f of failures ?? []) log(`   · ${f.url ?? "未知窗口"} —— ${f.message}`);
}

// Codex 升级改了类名或结构时，mock 回归照样全绿、用户却看见板子歪了——与其让用户来发现，
// 不如换肤当场只读自检一次，说人话。**永远不影响换肤结果**：自检自己出错就当没这回事。
async function warnIfContractBroken(port) {
  let report = null;
  try {
    const results = await withPageTargets(port, (cdp) => cdp.evaluate(CONTRACT_SCRIPT));
    report = results.find((r) => r.ok && r.value && Array.isArray(r.value.broken))?.value ?? null;
  } catch { return; }
  if (!report || !report.broken.length) return;
  log("⚠️ 自检：Codex 的界面结构和我们的假设对不上了，下面这些会失效——");
  for (const b of report.broken) log(`   · ${b.what} —— ${b.effect}`);
  log("   多半是 Codex 升级换了界面。跑 `npm run smoke` 看完整报告，改 src/css.mjs 里的选择器即可。");
  if (GUI) {
    await guiAlert("CoSkin 自检：Codex 界面结构变了，部分效果可能失效。\n\n"
      + report.broken.map((b) => "· " + b.what + " —— " + b.effect).join("\n")
      + "\n\n换肤本身已经完成，配色多半还在。");
  }
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
  const updateInfo = await getUpdateInfo();
  const { applied, failed, failures } = await injectEverywhere(port, buildInjectionScript(payload, theme.id, updateInfo));
  await rememberTheme(theme.id);
  log(`✅ 已应用「${theme.name}」（${applied} 个窗口）。右下角 🎨 按钮可随时一键切换或还原。`);
  warnPartialFailure("应用", failed, failures);
  await warnIfContractBroken(port);
  if (updateInfo.updateAvailable) log(`🔵 有新版本 v${updateInfo.latest}（当前 v${updateInfo.current}）——双击「双击换肤」会自动拉取更新。`);
  return theme;
}

async function gitPull() {
  try { const { stdout } = await run("git", ["pull", "--ff-only"], { cwd: ROOT }); return { ok: true, msg: stdout.trim() }; }
  catch (error) { return { ok: false, msg: (error.stderr || error.message).toString().trim() }; }
}

// 幂等装/更新 Codex 技能到 ~/.agents/skills/coskin。跨平台（Node fs），所有入口共用一份，
// 无需每个 .command/.bat/.vbs 各自实现。先把模板读进内存再写目标——读不到就抛、绝不截空已装好的文件。
async function ensureSkillInstalled() {
  try {
    const dstDir = join(homedir(), ".agents", "skills", "coskin");
    const dst = join(dstDir, "SKILL.md");
    try {
      const cur = await readFile(dst, "utf8");
      if (cur.includes(ROOT)) return; // 已装且指向当前仓库 → 跳过
    } catch {}
    const tpl = await readFile(join(ROOT, "skill", "coskin", "SKILL.md"), "utf8"); // 读不到→抛，不碰 dst
    await mkdir(dstDir, { recursive: true });
    await writeFile(dst, tpl.split("__COSKIN_ROOT__").join(ROOT));
    log("✅ 已安装/更新 Codex 技能（对 Codex 说「用 coskin 换个主题」即可）");
  } catch { /* 装技能失败不致命，不打断换肤 */ }
}

// 一键恢复：可选先拉最新代码，再重新应用上次用过的主题（关机/关 Codex 后最快的上肤方式）。
// Codex 已关闭时会直接以调试模式启动并上肤（无运行实例→不打断，无需确认）。
async function resume(port, confirmRestart, doUpdate = false) {
  await ensureSkillInstalled();
  if (doUpdate) {
    // ZIP 安装没有 .git，别去跑 git pull 报一串看不懂的错——直接说清楚怎么升级
    if (!existsSync(join(ROOT, ".git"))) {
      log("ZIP 安装：跳过自动更新（想升级就去 GitHub 重新下载最新 ZIP 覆盖本文件夹）。");
    } else {
      log("检查更新…");
      const r = await gitPull();
      log(r.ok ? (r.msg || "已是最新。") : `更新跳过（${r.msg.split("\n")[0]}），继续用当前版本。`);
    }
  }
  const themes = await loadAllThemes();
  const last = await lastTheme();
  const target =
    (last && themes.find((t) => t.id === last)) ||
    themes.find((t) => t.kind === "builtin") ||
    themes[0];
  if (!target) throw new Error("没有可用主题，先在菜单里做一个吧。");
  log(`一键上肤：${target.name}${last === target.id ? "（上次用的）" : "（默认）"}`);
  await applyTheme(port, target.id, confirmRestart);
}

async function update(port, confirmRestart) {
  log("正在从 GitHub 拉取最新代码…");
  const r = await gitPull();
  if (!r.ok) {
    throw new Error(
      "git pull 失败：" + r.msg.split("\n")[0] +
        "\n若有本地改动，请先 git stash 或 git commit 再更新；或手动 git pull。",
    );
  }
  log(r.msg || "已是最新。");
  const state = await appState(await findApp(), port).catch(() => ({ cdpAlive: false }));
  if (!state.cdpAlive) { log("✅ 代码已更新。下次应用主题即用新版本。"); return; }
  const active = await currentActiveTheme(port).catch(() => null);
  if (!active) { log("✅ 代码已更新。在右下角 🎨 面板重选一个主题即用新版本。"); return; }
  try {
    log(`重新应用当前主题以生效新版本…`);
    await applyTheme(port, active, confirmRestart);
  } catch {
    log(`✅ 代码已更新。当前主题「${active}」在面板里，重选一次即用新版本。`);
  }
}

async function restore(port) {
  const state = await appState(await findApp(), port);
  if (!state.cdpAlive) {
    log("Codex 没在调试模式下运行 —— 皮肤本来就只在这种会话里存在，现在已是官方原生界面。");
    return;
  }
  const res = await injectEverywhere(port, RESTORE_SCRIPT).catch((error) => {
    log(`还原时没找到注入痕迹（${error.message}），界面应已是原生状态。`);
    return null;
  });
  if (res) warnPartialFailure("还原", res.failed, res.failures);
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
    const ext = await assertImageFile(wp); // 与 --image 同一套校验：后缀 + 非空 + ≤8MB
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
  const appPath = await findApp();
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
  await ensureSkillInstalled();
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
      const nUpdate = themes.length + 4;
      const nRestore = themes.length + 5;
      const nStatus = themes.length + 6;
      console.log(`  ${nCustom}) 用我自己的图片做主题…`);
      console.log(`  ${nImport}) 导入 .coskin 主题文件…`);
      console.log(`  ${nExport}) 导出主题为 .coskin 文件（分享给朋友）…`);
      console.log(`  ${nUpdate}) 检查并更新到最新版本`);
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
        } else if (n === nUpdate) {
          await update(port, confirmRestart);
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

// --gui：无终端的启动器（.app / .vbs）用系统弹窗确认/报错；--restart-ok：提前授权重启（无人值守）
const GUI = args.includes("--gui");
const cliConfirm = args.includes("--restart-ok")
  ? async () => true
  : (GUI ? () => guiConfirm(RESTART_QUESTION) : () => askYesNo(RESTART_QUESTION));

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
  } else if (command === "resume") {
    await resume(port, cliConfirm, args.includes("--update"));
    if (GUI) await guiNotify("✅ 已换肤，Codex 这就带皮肤打开。");
  } else if (command === "update") {
    await update(port, cliConfirm);
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
  if (GUI) await guiAlert("CoSkin 换肤失败：" + error.message);
  process.exit(1);
}
// CDP WebSocket 的关闭握手偶发挂起会拖住事件循环，命令跑完显式退出
process.exit(0);
