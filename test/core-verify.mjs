#!/usr/bin/env node
// 自包含核心回归：token 接管 / 面板 / 配色编辑器 / 桌宠 / 缩放 / 可见度 / 还原 / 闭包清理。
//
// 一般不直接跑这个——用 `node test/run-core.mjs`（它会自己起服务和 Chrome）。
// 直接跑需要自备一个加载了 test/mock/core.html 的 Chrome：node test/core-verify.mjs --port 9666
//
// 覆盖范围刻意收敛：**只测平台无关的核心机制**，不测首页装饰（标题板/行书字/模式判别）——
// 那些需要复刻整页 Codex DOM，等真要大改时再补（见 ENGINEERING_NOTES）。

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Cdp, cdpAlive, listTargets, pageTargets } from "../src/cdp.mjs";
import { PROBE_SCRIPT, RESTORE_SCRIPT, backgroundFromTheme, buildInjectionScript } from "../src/css.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv;
const port = Number(argv[argv.indexOf("--port") + 1] || 9666);

const failures = [];
let passed = 0;
const check = (label, cond, detail = "") => {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label} ${detail}`); failures.push(label); }
};

const deadline = Date.now() + 15000;
while (!(await cdpAlive(port))) {
  if (Date.now() > deadline) { console.error(`端口 ${port} 上没等到 CDP。`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 300));
}
const targets = pageTargets(await listTargets(port)).filter((t) => t.url.includes("core"));
if (!targets.length) { console.error("没找到 core mock 页面。"); process.exit(1); }
const cdp = await Cdp.connect(targets[0].webSocketDebuggerUrl);

const SAMPLE = `(() => ({
  shell: document.documentElement.className,
  menuBg: getComputedStyle(document.querySelector('[role="menu"]')).backgroundColor,
  diffAdd: getComputedStyle(document.querySelector(".diff-add")).color,
  termBg: getComputedStyle(document.querySelector(".term")).backgroundColor,
  sidebarBg: getComputedStyle(document.querySelector(".app-shell-left-panel")).backgroundColor,
  btnBg: getComputedStyle(document.querySelector(".btn-primary")).backgroundColor,
}))()`;

// 必须等页面真加载完再动：CDP 端口就绪 ≠ 文档就绪。连太早会拿到还没初始化的 document，
// localStorage 直接抛 SecurityError（首跑就这么挂的，偶发性极强）。
let ready = "";
for (let i = 0; i < 75; i++) {
  ready = await cdp.evaluate(`(() => { try { localStorage.getItem("x"); } catch { return "nostore"; } return document.readyState + "|" + (document.getElementById("root") ? "root" : "noroot"); })()`);
  if (ready === "complete|root") break;
  await new Promise((r) => setTimeout(r, 200));
}
if (ready !== "complete|root") { console.error(`页面没就绪：${ready}`); process.exit(1); }

console.log("\n[0] 官方原生基线");
await cdp.evaluate(`(() => { for (const k of Object.keys(localStorage).filter((x) => x.startsWith("coskin."))) localStorage.removeItem(k); return "clean"; })()`);
const baseline = await cdp.evaluate(SAMPLE);
check("基线外观 = electron-light", baseline.shell.includes("electron-light"), baseline.shell);

// 载入真实内置主题（负载只带 spec+bg，CSS 页面内现场编译）
const files = (await readdir(join(ROOT, "themes"))).filter((f) => f.endsWith(".json")).sort();
const payload = [];
for (const f of files) {
  const t = JSON.parse(await readFile(join(ROOT, "themes", f), "utf8"));
  const palette = t.palette ?? { accent: t.colors.accent, secondary: t.colors.secondary, surfaceTint: t.colors.surface, ink: t.colors.text };
  payload.push({ id: t.id, name: t.name, accent: palette.accent, appearance: t.appearance === "light" ? "light" : "dark",
    spec: { palette }, decor: t.decor ?? null, bg: backgroundFromTheme(t) });
}

console.log("\n[1] 注入 nebula：token 接管 + 面板挂载");
const injected = await cdp.evaluate(buildInjectionScript(payload, "nebula"), { timeoutMs: 30000 });
check("注入返回 coskin:ok", injected === "coskin:ok", String(injected));
let probe = await cdp.evaluate(PROBE_SCRIPT);
check("当前皮肤 = nebula 且面板已挂载", probe?.active === "nebula" && probe?.hasUi === true, JSON.stringify(probe));
let s = await cdp.evaluate(SAMPLE);
check("外观类切到 electron-dark", s.shell.includes("electron-dark"), s.shell);
check("菜单背景已跟随主题", s.menuBg !== baseline.menuBg, s.menuBg);
check("diff 新增色已跟随主题", s.diffAdd !== baseline.diffAdd, s.diffAdd);
check("终端底色已跟随主题", s.termBg !== baseline.termBg, s.termBg);
check("侧栏底色已跟随主题", s.sidebarBg !== baseline.sidebarBg, s.sidebarBg);
check("主按钮已跟随主题", s.btnBg !== baseline.btnBg, s.btnBg);
const wrapperBg = await cdp.evaluate(`getComputedStyle(document.querySelector("[data-vscode-context]")).backgroundColor`);
check("会话包装层保持透明（壁纸不被挡）", wrapperBg === "rgba(0, 0, 0, 0)", wrapperBg);
const cmBg = await cdp.evaluate(`getComputedStyle(document.querySelector(".cm-editor")).backgroundColor`);
const cmAlpha = Number((cmBg.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/) ?? [null, "1"])[1]);
check("阅读面板不透明度 ≥ 0.9", cmAlpha >= 0.9 || !cmBg.startsWith("rgba"), cmBg);
check("桌宠已出现", probe?.petVisible === true, JSON.stringify(probe));

console.log("\n[2] 桌宠：开关 / 拖拽 / 缩放单元");
await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-fab").click(); document.querySelector('[data-coskin-pet="off"]').click(); "off"`);
probe = await cdp.evaluate(PROBE_SCRIPT);
check("桌宠可关闭", probe?.petVisible === false, JSON.stringify(probe));
await cdp.evaluate(`document.querySelector('[data-coskin-pet="on"]').click(); "on"`);
const drag = await cdp.evaluate(`(() => {
  const body = document.querySelector("#coskin-pet .cs-pet-body");
  const r = body.getBoundingClientRect();
  const fire = (tg, type, x, y) => tg.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  fire(body, "mousedown", r.left + 10, r.top + 10);
  fire(window, "mousemove", 200, 300);
  fire(window, "mouseup", 200, 300);
  let saved = null; try { saved = JSON.parse(localStorage.getItem("coskin.pet.pos.v1")); } catch {}
  return { left: document.getElementById("coskin-pet").style.left, saved: !!saved };
})()`);
check("桌宠可拖动且位置已保存", drag.left !== "" && drag.saved === true, JSON.stringify(drag));
check("气泡+身体同在缩放单元 .cs-pet-unit 内", (await cdp.evaluate(`!!document.querySelector("#coskin-pet .cs-pet-unit .cs-pet-bubble") && !!document.querySelector("#coskin-pet .cs-pet-unit .cs-pet-body")`)) === true);
await cdp.evaluate(`window.__coskinPetScale(1.8); "s"`);
check("桌宠缩放写入 --cs-pet-k", (await cdp.evaluate(`document.getElementById("coskin-pet").style.getPropertyValue("--cs-pet-k")`)) === "1.8");
check("缩放持久化", (await cdp.evaluate(`localStorage.getItem("coskin.pet.scale.v1")`)) === "1.8");
await cdp.evaluate(`window.__coskinPetScale(9); "big"`);
check("超上限夹到 2.6", (await cdp.evaluate(`document.getElementById("coskin-pet").style.getPropertyValue("--cs-pet-k")`)) === "2.6");
await cdp.evaluate(`window.__coskinPetScale(0.1); "tiny"`);
check("超下限夹到 0.7", (await cdp.evaluate(`document.getElementById("coskin-pet").style.getPropertyValue("--cs-pet-k")`)) === "0.7");
const clamp = await cdp.evaluate(`(() => {
  window.__coskinPetScale(2.6);
  const p = window.__coskinPlacePet(innerWidth - 2, innerHeight - 2);
  const m = Math.round(46 * 2.6) + 10;
  return { x: p.x, y: p.y, bx: innerWidth - m, by: innerHeight - m };
})()`);
check("放大后按新尺寸夹回（非硬编码 56）", clamp.x <= clamp.bx && clamp.y <= clamp.by, JSON.stringify(clamp));
await cdp.evaluate(`window.__coskinPetScale(1); localStorage.removeItem("coskin.pet.pos.v1"); "reset"`);

console.log("\n[3] 配色编辑器：色轮 / hex / 随机 / 复位 / 存为主题");
check("编辑器存在且默认收起", (await cdp.evaluate(`(() => { const e = document.querySelector("#coskin-ui .coskin-editor"); return !!e && !e.classList.contains("coskin-open"); })()`)) === true);
await cdp.evaluate(`document.getElementById("coskin-edit-toggle").click(); "open"`);
check("点标题→编辑器展开", (await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-editor").classList.contains("coskin-open")`)) === true);
check("四色轮 + 四 hex 输入齐全", (await cdp.evaluate(`document.querySelectorAll("#coskin-ui .coskin-editor .coskin-sw input[type=color]").length`)) === 4
  && (await cdp.evaluate(`document.querySelectorAll("#coskin-ui .coskin-hex").length`)) === 4);
await cdp.evaluate(`(() => { const h = document.querySelector("#coskin-ui .coskin-hex"); h.value = "#ff2d55"; h.dispatchEvent(new Event("input", { bubbles: true })); })()`);
check("输入 hex→色轮跟随 + 生成 custom 主题", (await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-sw input[type=color]").value`)) === "#ff2d55"
  && (await cdp.evaluate(`window.__coskinActive`)) === "custom");
check("hex 已编译进 token", (await cdp.evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--color-token-focus-border").trim().toLowerCase()`)) === "#ff2d55");
check("自定义配色已持久化", (await cdp.evaluate(`(() => { try { return JSON.parse(localStorage.getItem("coskin.customPalette.v1")).palette.accent; } catch { return ""; } })()`)) === "#ff2d55");
const before = await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-sw input[type=color]").value`);
await cdp.evaluate(`document.querySelectorAll("#coskin-ui .coskin-editor .coskin-edit-row .coskin-mini")[2].click(); "rand"`);
check("🎲 随机改变强调色", (await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-sw input[type=color]").value`)) !== before);
check("随机后 hex 与色轮同步", (await cdp.evaluate(`(() => { const c = document.querySelector("#coskin-ui .coskin-sw input[type=color]"); const h = document.querySelector("#coskin-ui .coskin-hex"); return c.value.toLowerCase() === h.value.toLowerCase(); })()`)) === true);
await cdp.evaluate(`document.querySelectorAll("#coskin-ui .coskin-editor .coskin-edit-row .coskin-mini")[3].click(); "reset"`);
check("↺ 复位回到打开时的种子色", (await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-sw input[type=color]").value`)) === "#7c6cff");
await cdp.evaluate(`(() => { document.querySelector("#coskin-ui .coskin-name").value = "测试红"; document.querySelector("#coskin-ui .coskin-editor .coskin-act").click(); })()`);
check("存为主题→进 coskin.imported.v1", (await cdp.evaluate(`(() => { try { return JSON.parse(localStorage.getItem("coskin.imported.v1")).some((e) => String(e.id).indexOf("imp-mine") === 0 && e.name === "测试红"); } catch { return false; } })()`)) === true);
check("存的主题出现在列表且成为当前皮肤", (await cdp.evaluate(`!!document.querySelector('[data-coskin-theme^="imp-mine"]') && window.__coskinActive.indexOf("imp-mine") === 0`)) === true);
await cdp.evaluate(`window.__coskinSetTheme("nebula"); document.getElementById("coskin-edit-toggle").click(); "back"`);

console.log("\n[4] 面板整体缩放 + 板子质感四档");
await cdp.evaluate(`(() => { const r = document.querySelector("#coskin-ui .coskin-size input"); r.value = "1.35"; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
check("面板缩放写入 --cs-panel-k", (await cdp.evaluate(`document.getElementById("coskin-ui").style.getPropertyValue("--cs-panel-k")`)) === "1.35");
check("面板缩放持久化", (await cdp.evaluate(`localStorage.getItem("coskin.panel.size.v1")`)) === "1.35");
check("板子质感四档控件齐全", (await cdp.evaluate(`document.querySelectorAll("[data-coskin-plate]").length`)) === 4);
check("初始高亮生效（在 panel 子树里查，不是 document）", (await cdp.evaluate(`[...document.querySelectorAll("[data-coskin-plate]")].some((b) => b.classList.contains("coskin-on"))`)) === true);
for (const fx of ["flat", "raise", "frost", "both"]) {
  await cdp.evaluate(`document.querySelector('[data-coskin-plate="${fx}"]').click(); "${fx}"`);
  check(`板子档位「${fx}」已选中并持久化`, (await cdp.evaluate(`localStorage.getItem("coskin.plateFx.v1")`)) === fx);
}
await cdp.evaluate(`document.querySelector('[data-coskin-plate="raise"]').click(); "raise"`);

console.log("\n[5] 背景可见度：氛围 → 沉浸，表面应变透");
const ambient = (await cdp.evaluate(SAMPLE)).sidebarBg;
await cdp.evaluate(`document.querySelector('[data-coskin-vis="immersive"]').click(); "im"`);
check("侧栏透明度改变", (await cdp.evaluate(SAMPLE)).sidebarBg !== ambient, ambient);
check("沉浸档按钮高亮", (await cdp.evaluate(`document.querySelector('[data-coskin-vis="immersive"]').classList.contains("coskin-on")`)) === true);
await cdp.evaluate(`document.querySelector('[data-coskin-vis="ambient"]').click(); "am"`);

console.log("\n[6] 还原：逐项回基线 + 闭包清理 + 代际门");
await cdp.evaluate(`window.__coskinStaleSetTheme = window.__coskinSetTheme; "captured"`);
const restored = await cdp.evaluate(RESTORE_SCRIPT);
check("还原返回 coskin:restored", restored === "coskin:restored", String(restored));
s = await cdp.evaluate(SAMPLE);
check("外观类回到基线", s.shell === baseline.shell, s.shell);
check("菜单背景回到基线", s.menuBg === baseline.menuBg, s.menuBg);
check("diff 色回到基线", s.diffAdd === baseline.diffAdd, s.diffAdd);
check("终端底色回到基线", s.termBg === baseline.termBg, s.termBg);
check("侧栏底色回到基线", s.sidebarBg === baseline.sidebarBg, s.sidebarBg);
check("主按钮回到基线", s.btnBg === baseline.btnBg, s.btnBg);
probe = await cdp.evaluate(PROBE_SCRIPT);
check("无皮肤、无面板", probe?.active === null && probe?.hasUi === false, JSON.stringify(probe));
check("面板/桌宠已拆除、定时器已清", (await cdp.evaluate(`!document.getElementById("coskin-ui") && !document.getElementById("coskin-pet") && window.__coskinTimers === undefined`)) === true);
check("注入期闭包全部清除", (await cdp.evaluate(`["__coskinSetTheme","__coskinQuickFromDataUrl","__coskinApplyShare","__coskinBuildShare","__coskinDeleteTheme","__coskinSyncActions","__coskinSetPetImage","__coskinClearPetImage","__coskinState","__coskinPetScale","__coskinPanelScale","__coskinPlacePet","__coskinPetTick"].every((k) => window[k] === undefined)`)) === true);
check("还原后旧闭包被触达也不复活皮肤（代际门）", (await cdp.evaluate(`(() => { try { window.__coskinStaleSetTheme && window.__coskinStaleSetTheme("nebula"); } catch {} return !!document.getElementById("coskin-style"); })()`)) === false);
check("卡片样式作用域标记已清", (await cdp.evaluate(`document.documentElement.dataset.csCodex === undefined`)) === true);

cdp.close();
console.log(failures.length === 0
  ? `\n核心回归全部通过 ✅（${passed} 条断言）`
  : `\n共 ${failures.length} 项失败：${failures.join("；")}`);
process.exit(failures.length === 0 ? 0 : 1);
