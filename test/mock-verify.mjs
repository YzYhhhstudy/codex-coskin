// 端到端机制验证 v0.4：分级流水线 —
// token 接管（菜单/diff/终端/外观类）→ 可见度档位 → 外观翻转 → 纸色守卫 → 快捷槽 → 还原。
// 用法：node test/mock-verify.mjs --port 9555 --shots <截图目录>
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Cdp, cdpAlive, listTargets, pageTargets } from "../src/cdp.mjs";
import { PROBE_SCRIPT, RESTORE_SCRIPT, backgroundFromTheme, buildInjectionScript } from "../src/css.mjs";
import { buildPaletteExpression, coskinDecideAppearance } from "../src/palette.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const port = Number(argValue("--port", "9555"));
const shotsDir = argValue("--shots");
if (!shotsDir) { console.error("必须提供 --shots <截图目录>"); process.exit(1); }
await mkdir(shotsDir, { recursive: true });

const failures = [];
function check(label, condition, detail = "") {
  if (condition) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label} ${detail}`); failures.push(label); }
}

const deadline = Date.now() + 15000;
while (!(await cdpAlive(port))) {
  if (Date.now() > deadline) { console.error(`端口 ${port} 上没有等到 CDP。`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 400));
}

const targets = pageTargets(await listTargets(port)).filter((t) => t.url.includes("mock"));
if (targets.length === 0) { console.error("没找到 mock 页面目标。"); process.exit(1); }
const cdp = await Cdp.connect(targets[0].webSocketDebuggerUrl);
await cdp.send("Page.enable").catch(() => {});

async function shot(name) {
  const data = (await cdp.send("Page.captureScreenshot", { format: "png" }, { timeoutMs: 30000 })).data;
  const file = join(shotsDir, `${name}.png`);
  await writeFile(file, Buffer.from(data, "base64"));
  console.log(`  📸 ${file}`);
}

const SAMPLE = `(() => ({
  shell: document.documentElement.className,
  menuBg: getComputedStyle(document.querySelector('[role="menu"]')).backgroundColor,
  diffAdd: getComputedStyle(document.querySelector(".diff-add")).color,
  termBg: getComputedStyle(document.querySelector(".term")).backgroundColor,
  sidebarBg: getComputedStyle(document.querySelector(".app-shell-left-panel")).backgroundColor,
  btnBg: getComputedStyle(document.querySelector(".btn-primary")).backgroundColor,
}))()`;

console.log("\n[0] 采集官方原生基线");
await cdp.evaluate(`localStorage.removeItem("coskin.decorOverride.v1"); localStorage.removeItem("coskin.pet.pos.v1"); "clean"`);
const baseline = await cdp.evaluate(SAMPLE);
check("基线外观 = electron-light", baseline.shell.includes("electron-light"), baseline.shell);
await shot("00-native-baseline");

// 载入内置主题：负载只带 spec+bg，CSS 页面内现场编译
const themeFiles = (await readdir(join(ROOT, "themes"))).filter((f) => f.endsWith(".json")).sort();
const payload = [];
for (const file of themeFiles) {
  const theme = JSON.parse(await readFile(join(ROOT, "themes", file), "utf8"));
  const palette = theme.palette ?? {
    accent: theme.colors.accent, secondary: theme.colors.secondary,
    surfaceTint: theme.colors.surface, ink: theme.colors.text,
  };
  payload.push({
    id: theme.id, name: theme.name, accent: palette.accent,
    appearance: theme.appearance === "light" ? "light" : "dark",
    spec: { palette }, decor: theme.decor ?? null, bg: backgroundFromTheme(theme),
  });
}

console.log(`\n[1] 注入 nebula（负载 ${payload.length} 套主题，页面内编译）`);
const injectResult = await cdp.evaluate(buildInjectionScript(payload, "nebula"), { timeoutMs: 30000 });
check("注入返回 coskin:ok", injectResult === "coskin:ok", String(injectResult));
let probe = await cdp.evaluate(PROBE_SCRIPT);
check("当前皮肤 = nebula 且面板已挂载", probe?.active === "nebula" && probe?.hasUi === true, JSON.stringify(probe));
let s = await cdp.evaluate(SAMPLE);
check("外观类切到 electron-dark", s.shell.includes("electron-dark"), s.shell);
check("下拉菜单背景已跟随主题", s.menuBg !== baseline.menuBg, s.menuBg);
check("diff 新增色已跟随主题", s.diffAdd !== baseline.diffAdd, s.diffAdd);
check("终端底色已跟随主题", s.termBg !== baseline.termBg, s.termBg);
check("主按钮已跟随主题", s.btnBg !== baseline.btnBg, s.btnBg);
// 回归守卫：会话视图包装层（真机 data-vscode-context）绝不能变成不透明的遮光板
const wrapperBg = await cdp.evaluate(`getComputedStyle(document.querySelector("[data-vscode-context]")).backgroundColor`);
check("会话包装层保持透明（壁纸不被挡）", wrapperBg === "rgba(0, 0, 0, 0)", wrapperBg);
check("顶栏品牌行已出现", probe?.brandVisible === true, JSON.stringify(probe));
check("标题板已插进首页标题列", probe?.heroPlate === true, JSON.stringify(probe));
const plateGeo = await cdp.evaluate(`(() => {
  const p = document.querySelector(".cs-hero-plate").getBoundingClientRect();
  const s = document.querySelector('[class*="home-suggestions"]').getBoundingClientRect();
  const btn = document.querySelector('[class*="home-suggestions"] button');
  const mw = document.querySelector("main.main-surface").getBoundingClientRect().width;
  return { h: p.height, w: p.width, wrapsCards: p.bottom >= s.bottom, cardH: btn.getBoundingClientRect().height, vh: innerHeight, mw: mw };
})()`);
check("横幅高 ≥ 工作区 1/3 且包住卡片", plateGeo.h >= plateGeo.vh * 0.3 && plateGeo.wrapsCards, JSON.stringify(plateGeo));
check("横幅宽接近主区宽（留白 ≤ 120px）", plateGeo.w >= plateGeo.mw - 120, `w=${plateGeo.w} mw=${plateGeo.mw}`);
check("卡片高 ≥ 窗高 1/8", plateGeo.cardH >= plateGeo.vh / 8 - 2, String(plateGeo.cardH));
check("首页标题已接管为主题墨色（防撞色）", (await cdp.evaluate(`(() => { const t = document.querySelector("[data-cs-titled]"); return !!t && t.style.color !== ""; })()`)) === true);
check("桌宠已出现", probe?.petVisible === true, JSON.stringify(probe));
const sugBg = await cdp.evaluate(`getComputedStyle(document.querySelector('[class*="home-suggestions"] button')).backgroundColor`);
check("建议卡有常驻底色（非 hover 才显）", sugBg !== "rgba(0, 0, 0, 0)", sugBg);
const cmBg = await cdp.evaluate(`getComputedStyle(document.querySelector(".cm-editor")).backgroundColor`);
const cmAlpha = Number((cmBg.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/) ?? [null, "1"])[1]);
check("阅读面板(cm-editor)不透明度 ≥ 0.9", cmAlpha >= 0.9 || !cmBg.startsWith("rgba"), cmBg);
await shot("01-nebula");

console.log("\n[1b] 桌宠：开关 + 拖拽");
await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-fab").click(); document.querySelector('[data-coskin-pet="off"]').click(); "off"`);
probe = await cdp.evaluate(PROBE_SCRIPT);
check("桌宠可关闭", probe?.petVisible === false, JSON.stringify(probe));
await cdp.evaluate(`document.querySelector('[data-coskin-pet="on"]').click(); document.querySelector("#coskin-ui .coskin-fab").click(); "on"`);
const dragResult = await cdp.evaluate(`(() => {
  const body = document.querySelector("#coskin-pet .cs-pet-body");
  const r = body.getBoundingClientRect();
  const fire = (target, type, x, y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  fire(body, "mousedown", r.left + 10, r.top + 10);
  fire(window, "mousemove", 200, 300);
  fire(window, "mouseup", 200, 300);
  const pet = document.getElementById("coskin-pet");
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("coskin.pet.pos.v1")); } catch {}
  return { left: pet.style.left, flip: pet.classList.contains("cs-flip"), saved: !!saved };
})()`);
check("桌宠可拖动且位置已保存", dragResult.left !== "" && dragResult.saved === true, JSON.stringify(dragResult));
check("靠左时气泡自动翻边", dragResult.flip === true, JSON.stringify(dragResult));

console.log("\n[2] 打开 🎨 面板（含可见度/外观控件）");
await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-fab").click(); "clicked"`);
check("面板展开", (await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-panel").classList.contains("coskin-open")`)) === true);
check("可见度控件存在（含原图档）", (await cdp.evaluate(`document.querySelectorAll("[data-coskin-vis]").length`)) === 4);
await shot("02-panel-open");

console.log("\n[3] 背景可见度：氛围 → 沉浸，表面应变得更透");
const ambientSidebar = (await cdp.evaluate(SAMPLE)).sidebarBg;
await cdp.evaluate(`document.querySelector('[data-coskin-vis="immersive"]').click(); "clicked"`);
const immersiveSidebar = (await cdp.evaluate(SAMPLE)).sidebarBg;
check("侧栏透明度改变", immersiveSidebar !== ambientSidebar, `${ambientSidebar} -> ${immersiveSidebar}`);
check("沉浸档按钮高亮", (await cdp.evaluate(`document.querySelector('[data-coskin-vis="immersive"]').classList.contains("coskin-on")`)) === true);
await shot("03-immersive");
await cdp.evaluate(`document.querySelector('[data-coskin-vis="ambient"]').click(); "clicked"`);

console.log("\n[4] 秒切 xuanzhi（一句话→主题）并手动翻转外观");
await cdp.evaluate(`document.querySelector('[data-coskin-theme="xuanzhi"]').click(); document.querySelector("#coskin-ui .coskin-fab").click(); "clicked"`);
probe = await cdp.evaluate(PROBE_SCRIPT);
check("当前皮肤 = xuanzhi 且外观浅色", probe?.active === "xuanzhi" && probe.shell.includes("electron-light"), JSON.stringify(probe));
const brandText = await cdp.evaluate(`document.querySelector("#coskin-brand .cs-brand-main").textContent + "|" + document.querySelector("#coskin-brand .cs-brand-sub").textContent`);
check("品牌行文案来自主题 decor", brandText === "宣纸工坊|笔墨有骨，代码有禅。", brandText);
const petQuote = await cdp.evaluate(`document.querySelector("#coskin-pet .cs-pet-bubble").textContent`);
check("桌宠台词来自主题 decor", petQuote === "正是修行时。", petQuote);
await new Promise((r) => setTimeout(r, 1400)); // 等一拍轮询挂行书字
const glyph = await cdp.evaluate(`document.querySelector('[class*="home-suggestions"] button .cs-glyph')?.textContent ?? null`);
check("建议卡图标已换成主题行书字（笔墨纸砚）", glyph === "笔", String(glyph));
const cardLine = await cdp.evaluate(`document.querySelector('[class*="home-suggestions"] button').textContent`);
check("卡片短句已替换为主题双行文案", cardLine.includes("落笔前先读帖"), cardLine.slice(0, 40));
const fifth = await cdp.evaluate(`[...document.querySelectorAll('[class*="home-suggestions"] button')][4].textContent`);
check("未匹配的（二级）条目保持官方原文，不被戒条污染", fifth.includes("learn how a feature works") && !fifth.includes("落笔"), fifth.slice(0, 50));
const split = await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('[class*="home-suggestions"] button')][5]; const g = b.querySelector(".cs-glyph"); return { text: b.textContent.slice(0, 40), glyph: g ? g.textContent : null, small: !!g && g.classList.contains("cs-glyph-sm") }; })()`);
check("拆分span的二级条目按整钮原文匹配（墨+小字号+主题文案）", split.glyph === "墨" && split.small === true && split.text.includes("先淡后浓"), JSON.stringify(split));
const lineFs = await cdp.evaluate(`getComputedStyle(document.querySelector("[data-cs-lined]")).fontSize`);
check("戒条字号 = 16px（内联覆盖工具类）", lineFs === "16px", lineFs);
const brandEdit = await cdp.evaluate(`(() => {
  const s = document.querySelector("#coskin-brand .cs-brand-main");
  s.click(); s.textContent = "自定义标题"; s.dispatchEvent(new Event("blur"));
  try { return JSON.parse(localStorage.getItem("coskin.decorOverride.v1")).xuanzhi.brand; } catch (e) { return String(e); }
})()`);
check("顶栏标题点击可编辑并持久化", brandEdit === "自定义标题", String(brandEdit));
await shot("04-xuanzhi");
await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-fab").click(); "reopen"`);
await cdp.evaluate(`document.querySelector('[data-coskin-app="dark"]').click(); "clicked"`);
probe = await cdp.evaluate(PROBE_SCRIPT);
check("外观手动翻转为深色", probe.shell.includes("electron-dark"), probe.shell);
await cdp.evaluate(`document.querySelector('[data-coskin-app="light"]').click(); "clicked"`);

console.log("\n[5] 纸色守卫：浅底深墨图（模拟宣纸画）应判为浅色");
const sepiaDataUrl = await cdp.evaluate(
  `(() => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 400;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e8dcc4"; ctx.fillRect(0, 0, 640, 400);            // 宣纸底
    ctx.fillStyle = "#2b2620";
    ctx.fillRect(40, 30, 90, 340); ctx.fillRect(200, 60, 70, 300);      // 大片墨柱
    ctx.fillRect(340, 30, 80, 340); ctx.fillRect(500, 70, 90, 290);
    ctx.fillStyle = "#a33b28"; ctx.fillRect(300, 180, 40, 40);          // 朱砂印
    return c.toDataURL("image/png");
  })()`,
);
const sepiaPalette = await cdp.evaluate(buildPaletteExpression(sepiaDataUrl), { awaitPromise: true, timeoutMs: 30000 });
console.log(`     亮度 ${sepiaPalette.luminance.toFixed(2)}，主色 ${sepiaPalette.dominant}，强调色 ${sepiaPalette.accent}`);
check("纸色守卫判为 light", coskinDecideAppearance(sepiaPalette) === "light", coskinDecideAppearance(sepiaPalette));

console.log("\n[5b] 用宣纸测试图走面板上传：应得到浅色纸面主题且壁纸可见");
const quickResult = await cdp.evaluate(
  `window.__coskinQuickFromDataUrl(${JSON.stringify(sepiaDataUrl)}, "宣纸测试")`,
  { awaitPromise: true, timeoutMs: 60000 },
);
check("上传返回 coskin:quick-saved", quickResult === "coskin:quick-saved", String(quickResult));
probe = await cdp.evaluate(PROBE_SCRIPT);
check("当前皮肤 = quick 且外观浅色", probe?.active === "quick" && probe.shell.includes("electron-light"), JSON.stringify(probe));
await new Promise((r) => setTimeout(r, 1400));
check("切到无 cardGlyphs 主题后行书字已清除", (await cdp.evaluate(`!document.querySelector(".cs-glyph")`)) === true);
check("快捷槽记录带 spec+bg", (await cdp.evaluate(`(() => { const q = JSON.parse(localStorage.getItem("coskin.quickSlot.v5")); return !!(q && q.spec && q.bg); })()`)) === true);
await shot("05-sepia-quick");

console.log("\n[5r] 原图档：图片主题应零雾纱、主区全透（用户看到原图）");
const gradCount = (s) => s.split("linear-gradient(").length - 1;
const ambientRootBgi = await cdp.evaluate(`getComputedStyle(document.getElementById("root")).backgroundImage`);
check("氛围档存在雾纱/幕布层", gradCount(ambientRootBgi) >= 2 && ambientRootBgi.includes("url("), `gradients=${gradCount(ambientRootBgi)}`);
await cdp.evaluate(`document.querySelector('[data-coskin-vis="raw"]').click(); "clicked"`);
const rawRootBgi = await cdp.evaluate(`getComputedStyle(document.getElementById("root")).backgroundImage`);
check("原图档零渐变遮罩、仅原图", gradCount(rawRootBgi) === 0 && rawRootBgi.includes("url("), `gradients=${gradCount(rawRootBgi)}`);
const rawMain = await cdp.evaluate(`(() => { const cs = getComputedStyle(document.querySelector("main.main-surface")); return { bg: cs.backgroundColor, bgi: cs.backgroundImage }; })()`);
check("原图档主区完全透明", rawMain.bg === "rgba(0, 0, 0, 0)" && rawMain.bgi === "none", JSON.stringify(rawMain));
await new Promise((r2) => setTimeout(r2, 1400));
check("原图档零遮挡：板子已撤", (await cdp.evaluate(`!document.querySelector(".cs-hero-plate")`)) === true);
check("原图档卡片无模糊（水玻璃）", (await cdp.evaluate(`getComputedStyle(document.querySelector('[class*="home-suggestions"] button')).backdropFilter`)) === "none");
const rawGlass = await cdp.evaluate(`(() => ({
  side: getComputedStyle(document.querySelector(".app-shell-left-panel")).backdropFilter,
  comp: getComputedStyle(document.querySelector(".composer-surface-chrome")).backdropFilter,
}))()`);
check("原图档侧栏无模糊（纯水玻璃）", !/blur/.test(rawGlass.side), rawGlass.side);
check("原图档对话框无模糊（纯水玻璃）", !/blur/.test(rawGlass.comp), rawGlass.comp);
const capBg = await cdp.evaluate(`getComputedStyle(document.querySelector(".cap.bg-token-side-bar-background")).backgroundColor`);
check("对话框上方帽子已打透明（消除双层重叠）", capBg === "rgba(0, 0, 0, 0)" || capBg === "transparent", capBg);
check("原图档无 cards 配置的主题不做加宽（快捷槽保持官方布局）", (await cdp.evaluate(`!document.querySelector("[data-cs-cards]")`)) === true);
await cdp.evaluate(`document.querySelector('[data-coskin-theme="xuanzhi"]').click(); "sw"`);
await new Promise((r2) => setTimeout(r2, 300));
check("原图档+cards 主题=紧凑统一宽（有标记有宽度、无强制高）", (await cdp.evaluate(`(() => { const s = document.querySelector("[data-cs-cards]"); return !!s && s.style.getPropertyValue("--cs-cards-w") !== "" && s.style.getPropertyValue("--cs-card-h") === ""; })()`)) === true);
await cdp.evaluate(`window.__coskinSetTheme("quick"); "back"`);
await new Promise((r2) => setTimeout(r2, 200));
await shot("05r-raw");
await cdp.evaluate(`document.querySelector('[data-coskin-vis="ambient"]').click(); "clicked"`);
await new Promise((r2) => setTimeout(r2, 1400));
check("回到氛围档板子复位", (await cdp.evaluate(`!!document.querySelector(".cs-hero-plate")`)) === true);
check("氛围档侧栏恢复毛玻璃（有模糊）", /blur/.test(await cdp.evaluate(`getComputedStyle(document.querySelector(".app-shell-left-panel")).backdropFilter`)));
check("氛围档卡片行加宽标记复位", (await cdp.evaluate(`!!document.querySelector("[data-cs-cards]")`)) === true);
check("图片主题板右侧有人物裁切条", (await cdp.evaluate(`!!document.querySelector(".cs-hero-plate .cs-hero-art")`)) === true);

console.log("\n[5c] 深色图上传对照（背景可见度检查）");
const darkDataUrl = await cdp.evaluate(
  `(() => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 400;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 640, 400);
    g.addColorStop(0, "#0f2027"); g.addColorStop(1, "#2c5364");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = "#ff6f61"; ctx.beginPath(); ctx.arc(500, 120, 90, 0, Math.PI * 2); ctx.fill();
    return c.toDataURL("image/png");
  })()`,
);
await cdp.evaluate(`window.__coskinQuickFromDataUrl(${JSON.stringify(darkDataUrl)}, "深空测试")`, { awaitPromise: true, timeoutMs: 60000 });
probe = await cdp.evaluate(PROBE_SCRIPT);
check("深色图判为深色", probe.shell.includes("electron-dark"), probe.shell);
await cdp.evaluate(`document.querySelector('[data-coskin-vis="immersive"]').click(); "clicked"`);
await shot("05c-dark-immersive");
await cdp.evaluate(`document.querySelector('[data-coskin-vis="ambient"]').click(); "clicked"`);

console.log("\n[5d] 重新注入：快捷槽应从 localStorage 恢复");
const reinject = await cdp.evaluate(buildInjectionScript(payload, "nebula"), { timeoutMs: 60000 });
check("重注入成功", reinject === "coskin:ok", String(reinject));
check("快捷槽恢复进面板", (await cdp.evaluate(`!!document.querySelector('[data-coskin-theme="quick"]')`)) === true);

console.log("\n[6] 还原官方界面：控件采样逐项回基线");
const restored = await cdp.evaluate(RESTORE_SCRIPT);
check("还原返回 coskin:restored", restored === "coskin:restored", String(restored));
s = await cdp.evaluate(SAMPLE);
check("外观类回到基线", s.shell === baseline.shell, s.shell);
check("菜单背景回到基线", s.menuBg === baseline.menuBg, s.menuBg);
check("diff 色回到基线", s.diffAdd === baseline.diffAdd, s.diffAdd);
check("终端底色回到基线", s.termBg === baseline.termBg, s.termBg);
check("主按钮回到基线", s.btnBg === baseline.btnBg, s.btnBg);
probe = await cdp.evaluate(PROBE_SCRIPT);
check("无皮肤、无面板", probe?.active === null && probe?.hasUi === false, JSON.stringify(probe));
check("品牌行/标题板/桌宠已拆除、定时器已清", (await cdp.evaluate(`!document.getElementById("coskin-brand") && !document.getElementById("coskin-pet") && !document.querySelector(".cs-hero-plate") && window.__coskinTimers === undefined`)) === true);
const colResidue = await cdp.evaluate(`(() => { const c = document.querySelector(".home-col"); return c.style.position + "|" + c.style.isolation + "|" + (c.dataset.csCol ?? ""); })()`);
check("标题列内联样式残留已清（position/isolation/标记）", colResidue === "||", colResidue);
check("标题接管样式已还原", (await cdp.evaluate(`!document.querySelector("[data-cs-titled]")`)) === true);
check("卡片短句已还原为官方原文", (await cdp.evaluate(`document.querySelector('[class*="home-suggestions"] button').textContent`)).includes("探索并理解代码"), "");
await shot("06-restored");

cdp.close();

if (failures.length > 0) {
  console.error(`\n共 ${failures.length} 项失败：${failures.join("；")}`);
  process.exit(1);
}
console.log("\n全部通过 ✅ v0.4 成立：token 接管 + 可见度档位 + 外观翻转 + 纸色守卫 + 快捷槽 + 完整还原。");
