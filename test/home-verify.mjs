#!/usr/bin/env node
// 首页装饰回归：板子几何 / 内容上移 / 标题接管 / 行书字认卡 / 模式判别 / 品牌行让位 / 还原即原样。
//
// 一般不直接跑这个——用 `node test/run-mock.mjs home`（它会自己起服务和 Chrome）。
// 直接跑需要自备一个加载了 test/mock/home.html 的 Chrome：node test/home-verify.mjs --port 9667
//
// 与 core-verify 的分工：core 管平台无关的核心机制（token/面板/桌宠/还原），
// home 管首页那套「按真机 DOM 形状吃饭」的装饰逻辑——历次真机翻车全集中在这里。

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Cdp, cdpAlive, listTargets, pageTargets } from "../src/cdp.mjs";
import { PROBE_SCRIPT, RESTORE_SCRIPT, backgroundFromTheme, buildInjectionScript } from "../src/css.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv;
const port = Number(argv[argv.indexOf("--port") + 1] || 9667);

const failures = [];
let passed = 0;
const check = (label, cond, detail = "") => {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label} ${detail}`); failures.push(label); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// 板子有 1px 描边，外框比代码里设定的 width/height 各多 2px。
// 几何断言一律用「扣掉描边」的内框，否则夹子明明精确生效也会被判超标。
const BORDER = 2;
const plateRatio = (g) => (g.plate.height - BORDER) / (g.innerHeight - g.header.bottom);

const deadline = Date.now() + 15000;
while (!(await cdpAlive(port))) {
  if (Date.now() > deadline) { console.error(`端口 ${port} 上没等到 CDP。`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 300));
}
const targets = pageTargets(await listTargets(port)).filter((t) => t.url.includes("home"));
if (!targets.length) { console.error("没找到 home mock 页面。"); process.exit(1); }
const cdp = await Cdp.connect(targets[0].webSocketDebuggerUrl);

// 固定视口：几何断言全都是绝对像素，窗口大小不能随机器变
const setViewport = async (width, height) =>
  cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
await setViewport(1440, 900);

// CDP 端口就绪 ≠ 文档就绪（core 那边首跑就栽在这，localStorage 直接抛 SecurityError）
let ready = "";
for (let i = 0; i < 75; i++) {
  ready = await cdp.evaluate(`(() => { try { localStorage.getItem("x"); } catch { return "nostore"; } return document.readyState + "|" + (window.__mock ? "mock" : "nomock"); })()`);
  if (ready === "complete|mock") break;
  await new Promise((r) => setTimeout(r, 200));
}
if (ready !== "complete|mock") { console.error(`页面没就绪：${ready}`); process.exit(1); }

// syncHome 是 1200ms 一拍的轮询，改完 DOM 要等它跑过去。轮询等待比死等快也更稳。
const waitFor = async (expr, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    if (await cdp.evaluate(`!!(${expr})`)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
};
const tick = () => new Promise((r) => setTimeout(r, 1400)); // 保证至少跑过一整拍

// 一次性把首页几何全量取回来，避免十几次往返
const GEO = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
  const plate = q(".cs-hero-plate");
  const anchor = q("#cards-wrap");
  const titleBox = q("#title-wrap");
  const title = q(".heading-xl");
  const icon = titleBox ? titleBox.querySelector("svg") : null;
  const cs = titleBox ? getComputedStyle(titleBox) : null;
  let hdrCtrlRight = 0;
  for (const el of document.querySelectorAll("header.app-header-tint button, header.app-header-tint a")) {
    const r = el.getBoundingClientRect();
    if (r.height > 8 && r.right > hdrCtrlRight) hdrCtrlRight = r.right;
  }
  const brand = document.getElementById("coskin-brand");
  return {
    header: box(q("header.app-header-tint")),
    main: box(q("main.main-surface")),
    plate: box(plate),
    anchor: box(anchor),
    titleBox: box(titleBox),
    title: box(title),
    icon: box(icon),
    sug: box(q("#sug")),
    composer: box(q("#composer")),
    brand: box(brand),
    brandDisplay: brand ? getComputedStyle(brand).display : null,
    hdrCtrlRight,
    innerHeight: window.innerHeight,
    liftPx: anchor && anchor.dataset.csLiftPx !== undefined ? Number(anchor.dataset.csLiftPx) : null,
    titleBoxTf: titleBox ? titleBox.style.transform : null,
    titleBoxZ: cs ? cs.zIndex : null,
    titleBoxPos: cs ? cs.position : null,
    anchorPos: anchor ? getComputedStyle(anchor).position : null,
    anchorIso: anchor ? getComputedStyle(anchor).isolation : null,
    plateZ: plate ? getComputedStyle(plate).zIndex : null,
    plateFirstChild: !!(anchor && anchor.firstElementChild && anchor.firstElementChild.classList.contains("cs-hero-plate")),
    codexScope: document.documentElement.dataset.csCodex,
    cardsMark: q("#sug") ? q("#sug").dataset.csCards : undefined,
    cardsW: anchor ? anchor.style.getPropertyValue("--cs-cards-w") : "",
    sugCardsW: q("#sug") ? q("#sug").style.getPropertyValue("--cs-cards-w") : "",
  };
})()`;

// 卡片现状：字形 / 文案 / 原 svg 是否被藏
const CARDS = `(() => [...document.querySelectorAll("#sug button")].map((b) => {
  const g = b.querySelector(":scope > .cs-glyph");
  const svg = b.querySelector("svg");
  const label = b.querySelector(".mt-auto");
  return {
    orig: b.dataset.csOrig ?? null,
    glyph: g ? g.textContent : null,
    glyphSm: g ? g.classList.contains("cs-glyph-sm") : null,
    glyphColor: g ? getComputedStyle(g).color : null,
    glyphFont: g ? getComputedStyle(g).fontSize : null,
    svgHidden: svg ? (svg.dataset.csHid === "1" && svg.style.display === "none") : null,
    text: label ? label.textContent : "",
    ws: label ? label.style.whiteSpace : "",
    fontSize: label ? label.style.fontSize : "",
  };
}))()`;

console.log("\n[0] 官方原生基线");
await cdp.evaluate(`(() => { for (const k of Object.keys(localStorage).filter((x) => x.startsWith("coskin."))) localStorage.removeItem(k); return "clean"; })()`);
const g0 = await cdp.evaluate(GEO);
const cards0 = await cdp.evaluate(CARDS);
const titleColor0 = await cdp.evaluate(`getComputedStyle(document.querySelector(".heading-xl")).color`);
check("基线：无板子、无行书字、无作用域标记",
  g0.plate === null && cards0.every((c) => c.glyph === null) && g0.codexScope === undefined);
check("基线顶栏高 48、主区可测", g0.header.bottom === 48 && g0.main.width > 600, JSON.stringify(g0.header));

// 载入真实内置主题（xiuxing 是唯一带 cards + subCards 的，首页装饰全靠它）
const files = (await readdir(join(ROOT, "themes"))).filter((f) => f.endsWith(".json")).sort();
const payload = [];
for (const f of files) {
  const t = JSON.parse(await readFile(join(ROOT, "themes", f), "utf8"));
  const palette = t.palette ?? { accent: t.colors.accent, secondary: t.colors.secondary, surfaceTint: t.colors.surface, ink: t.colors.text };
  payload.push({ id: t.id, name: t.name, accent: palette.accent, appearance: t.appearance === "light" ? "light" : "dark",
    spec: { palette }, decor: t.decor ?? null, bg: backgroundFromTheme(t) });
}
const xiuxing = JSON.parse(await readFile(join(ROOT, "themes", "xiuxing.json"), "utf8"));

console.log("\n[1] 注入 xiuxing：首页装饰挂载");
const injected = await cdp.evaluate(buildInjectionScript(payload, "xiuxing"), { timeoutMs: 30000 });
check("注入返回 coskin:ok", injected === "coskin:ok", String(injected));
check("板子已出现（首拍即有，不用等轮询）", await waitFor(`document.querySelector(".cs-hero-plate")`, 3000));
let g = await cdp.evaluate(GEO);
check("卡片样式作用域已开（html[data-cs-codex]）", g.codexScope === "1", String(g.codexScope));
check("卡片行已标记 data-cs-cards", g.cardsMark === "1", String(g.cardsMark));
check("板子是锚容器的首个子元素", g.plateFirstChild === true);
check("板子 z-index = -1（垫在内容之下）", g.plateZ === "-1", g.plateZ);
check("锚容器已自成层叠上下文（position + isolation）", g.anchorPos === "relative" && g.anchorIso === "isolate", `${g.anchorPos}/${g.anchorIso}`);
check("探针报告 heroPlate", (await cdp.evaluate(PROBE_SCRIPT))?.heroPlate === true);

console.log("\n[2] 板子几何：板顶钉在工作区上界 +50，包住图标与卡片");
check("板顶 = 顶栏底 + 50（用户指定）", near(g.plate.top - g.header.bottom, 50, 2), `实测 ${Math.round(g.plate.top - g.header.bottom)}`);
check("图标顶距板顶 = 34（CONTENT_PAD）", near(g.icon.top - g.plate.top, 34, 3), `实测 ${Math.round(g.icon.top - g.plate.top)}`);
check("板子把图标整个包住（不再只盖半截）", g.plate.top <= g.icon.top && g.plate.bottom >= g.icon.bottom);
check("板子把标题包住", g.plate.top <= g.title.top && g.plate.bottom >= g.title.bottom);
check("板底盖过卡片行 + 留白", g.plate.bottom >= g.sug.bottom + 18, `${Math.round(g.plate.bottom)} vs ${Math.round(g.sug.bottom)}`);
// 板子有 1px 描边，外框比设定宽度多 2px——留 3px 容差，别把描边算成几何失控
check("板宽 = 主区宽 - 88", near(g.plate.width, g.main.width - 88, 3), `${Math.round(g.plate.width)} vs ${Math.round(g.main.width - 88)}`);
check("板子在锚容器上水平居中", near((g.plate.left + g.plate.right) / 2, (g.anchor.left + g.anchor.right) / 2, 2));
const ratio = plateRatio(g);
check("板高占工作区 22%~55%（夹子生效）", ratio >= 0.22 && ratio <= 0.55, `实测 ${(ratio * 100).toFixed(1)}%`);
check("板子不霸屏：远低于当年翻车的 64%", ratio < 0.5, `实测 ${(ratio * 100).toFixed(1)}%`);
check("卡片行拿到统一宽与卡片高变量", g.cardsW !== "" && (await cdp.evaluate(`document.getElementById("cards-wrap").style.getPropertyValue("--cs-card-h")`)) !== "");

console.log("\n[3] 内容上移：分块挪、不累加、输入框不被拽走");
check("锚容器记录了上移量且 > 0", g.liftPx > 0, String(g.liftPx));
check("标题块被单独上移（translateY）", /translateY\(-\d+(\.\d+)?px\)/.test(g.titleBoxTf || ""), String(g.titleBoxTf));
check("上移量与标题块 transform 一致", (g.titleBoxTf || "").includes(`-${g.liftPx}px`), `${g.titleBoxTf} vs ${g.liftPx}`);
check("上移后内容顶 = 顶栏底 + 50 + 34", near(g.icon.top - g.header.bottom, 84, 3), `实测 ${Math.round(g.icon.top - g.header.bottom)}`);
// 输入框会被「卡片变高」正常推下去，这不是问题；要防的是它跟着 transform 一起被**拽上去**。
// 所以断言两条：① 它不在任何被上移的子树里；② 它绝不会比官方原位更靠上。
const composerLifted = await cdp.evaluate(`!!document.getElementById("composer").closest("[data-cs-lifted]")`);
check("输入框不在被上移的子树里（分块挪的意义）", composerLifted === false);
check("输入框没被拽上去（只可能被卡片高度正常推下）", g.composer.top >= g0.composer.top - 1,
  `${Math.round(g.composer.top)} vs 基线 ${Math.round(g0.composer.top)}`);
await tick(); await tick();
const g2 = await cdp.evaluate(GEO);
check("连跑两拍后上移量不自累加（3px 阈值防抖）", g2.liftPx === g.liftPx && g2.titleBoxTf === g.titleBoxTf, `${g2.liftPx} vs ${g.liftPx}`);
check("连跑两拍后板顶不漂移", near(g2.plate.top, g.plate.top, 1), `${Math.round(g2.plate.top)} vs ${Math.round(g.plate.top)}`);
check("标题块被提到板子之上（z-index 加在被 transform 的块上）", g2.titleBoxZ === "2" && g2.titleBoxPos !== "static", `${g2.titleBoxZ}/${g2.titleBoxPos}`);

console.log("\n[4] 标题接管：结构优先认标题");
const titleState = await cdp.evaluate(`(() => {
  const t = document.querySelector(".heading-xl");
  const cs = getComputedStyle(t);
  return { titled: t.dataset.csTitled, color: cs.color, shadow: cs.textShadow, weight: cs.fontWeight,
    kids: [...t.querySelectorAll("*")].every((e) => e.dataset.csTitled === "1") };
})()`);
check("新版文案（build in，不含 work on）也被认出来了", titleState.titled === "1", JSON.stringify(titleState));
check("标题染成主题墨色（已离开官方弱灰）", titleState.color !== titleColor0, `${titleState.color} vs ${titleColor0}`);
check("标题带光晕（textShadow 已写）", titleState.shadow && titleState.shadow !== "none", titleState.shadow);
check("标题加粗到 800", titleState.weight === "800", titleState.weight);
check("标题里的项目名子元素也一起染色", titleState.kids === true);

console.log("\n[5] 行书字：按原文认卡");
let cards = await cdp.evaluate(CARDS);
const want = xiuxing.decor.cards.map((c) => c.glyph);
check("四张一级卡拿到 酒/色/财/气", JSON.stringify(cards.slice(0, 4).map((c) => c.glyph)) === JSON.stringify(want),
  JSON.stringify(cards.map((c) => c.glyph)));
check("一级卡原 svg 已隐藏", cards.slice(0, 4).every((c) => c.svgHidden === true));
check("卡片文案换成戒条（含换行）", cards.slice(0, 4).every((c, i) => c.text === xiuxing.decor.cards[i].lines && c.ws === "pre-line"),
  JSON.stringify(cards[0]));
check("一级卡字号 16px", cards.slice(0, 4).every((c) => c.fontSize === "16px"));
check("一级卡是大字（非 cs-glyph-sm）", cards.slice(0, 4).every((c) => c.glyphSm === false));
check("行书字用主题强调色", cards[0].glyphColor && cards[0].glyphColor !== "rgb(0, 0, 0)", String(cards[0].glyphColor));
check("匹配不上的卡保持官方原样（不硬塞字）",
  cards[4].glyph === null && cards[4].text === "Something else entirely" && cards[4].svgHidden === false,
  JSON.stringify(cards[4]));
check("已存原文快照 data-cs-orig", cards.slice(0, 4).every((c) => typeof c.orig === "string" && c.orig.length > 0));
await tick();
cards = await cdp.evaluate(CARDS);
check("文案被换掉后再过一拍，字仍在（认卡靠快照不靠当前文案）",
  JSON.stringify(cards.slice(0, 4).map((c) => c.glyph)) === JSON.stringify(want), JSON.stringify(cards.map((c) => c.glyph)));

console.log("\n[6] 二级条目：同一批按钮槽换成 subCards");
await cdp.evaluate(`window.__mock.setCards(window.__mock.cards.sub); "sub"`);
check("二级条目拿到小字号行书字", await waitFor(`document.querySelector("#sug .cs-glyph.cs-glyph-sm")`, 4000));
const subCards = await cdp.evaluate(CARDS);
check("三条二级条目全部命中", subCards.every((c) => c.glyph !== null), JSON.stringify(subCards.map((c) => c.glyph)));
check("二级条目走 cs-glyph-sm（26px）", subCards.every((c) => c.glyphSm === true) && subCards[0].glyphFont === "26px", subCards[0].glyphFont);
check("二级条目字号 14px", subCards.every((c) => c.fontSize === "14px"));
await cdp.evaluate(`window.__mock.setCards(window.__mock.cards.primary.concat(window.__mock.cards.unmatched)); "back"`);
await waitFor(`document.querySelectorAll("#sug .cs-glyph").length === 4`, 4000);

console.log("\n[7] 模式判别：ChatGPT / Work 不串味");
await cdp.evaluate(`window.__mock.setProduct("ChatGPT"); "chatgpt"`);
check("切到 ChatGPT 后板子撤掉", await waitFor(`!document.querySelector(".cs-hero-plate")`, 4000));
let gc = await cdp.evaluate(GEO);
let cc = await cdp.evaluate(CARDS);
check("卡片样式作用域已关（否则文字行被画成方块卡）", gc.codexScope === undefined, String(gc.codexScope));
check("卡片行标记与宽变量已清", gc.cardsMark === undefined && gc.sugCardsW === "");
check("行书字已撤、官方 svg 复原", cc.every((c) => c.glyph === null && c.svgHidden === false));
check("卡片文案还回官方原文", cc[0].text === "Explore and understand", cc[0].text);
check("上移已撤、标题块 transform 还原成空", gc.liftPx === null && (gc.titleBoxTf === "" || gc.titleBoxTf === null), String(gc.titleBoxTf));
check("锚容器 position/isolation 还原（还原即原样）", gc.anchorPos === "static" && gc.anchorIso === "auto", `${gc.anchorPos}/${gc.anchorIso}`);
check("标题样式还回基线", (await cdp.evaluate(`getComputedStyle(document.querySelector(".heading-xl")).color`)) === titleColor0);
check("品牌行仍然保留（配色与品牌不属于 Codex 专有装饰）", gc.brandDisplay === "flex", String(gc.brandDisplay));
await cdp.evaluate(`window.__mock.setProduct(""); window.__mock.setChatWork(true); "pill"`);
await tick();
check("认不出产品名时，成对 Chat/Work 药丸也判为非 Codex",
  (await cdp.evaluate(`!document.querySelector(".cs-hero-plate") && document.documentElement.dataset.csCodex === undefined`)) === true);
await cdp.evaluate(`window.__mock.setChatWork(false); "nopill"`);
check("两条判据都认不出来时保持装饰（宁可不拦，不误伤 Codex 首页）",
  await waitFor(`document.querySelector(".cs-hero-plate") && document.documentElement.dataset.csCodex === "1"`, 4000));
await cdp.evaluate(`window.__mock.setProduct("Codex"); "codex"`);
await tick();
check("产品名回到 Codex，装饰照常", (await cdp.evaluate(`!!document.querySelector(".cs-hero-plate")`)) === true);

console.log("\n[8] 品牌行：按实测顶栏控件让位，不压按钮");
g = await cdp.evaluate(GEO);
check("品牌行可见且靠左", g.brandDisplay === "flex" && g.brand.left < g.main.width / 2, String(g.brandDisplay));
check("品牌行左缘 ≥ 顶栏最右控件 + 16", g.brand.left >= g.hdrCtrlRight + 16, `${Math.round(g.brand.left)} vs ${Math.round(g.hdrCtrlRight)}+16`);
const overlap = await cdp.evaluate(`(() => {
  const b = document.getElementById("coskin-brand").getBoundingClientRect();
  return [...document.querySelectorAll("header.app-header-tint button, header.app-header-tint a")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom; })
    .map((el) => el.id);
})()`);
check("品牌行与顶栏按钮零重叠", overlap.length === 0, JSON.stringify(overlap));
await cdp.evaluate(`window.__mock.collapseSidebar(true); "collapse"`);
await tick();
const gCol = await cdp.evaluate(GEO);
check("收起侧栏后主区确实变宽了（场景成立）", gCol.main.width > g.main.width, `${Math.round(gCol.main.width)} vs ${Math.round(g.main.width)}`);
check("收起侧栏后品牌行仍让开顶栏控件（真机报的重叠 bug）", gCol.brand.left >= gCol.hdrCtrlRight + 16,
  `${Math.round(gCol.brand.left)} vs ${Math.round(gCol.hdrCtrlRight)}+16`);
const overlap2 = await cdp.evaluate(`(() => {
  const b = document.getElementById("coskin-brand").getBoundingClientRect();
  return [...document.querySelectorAll("header.app-header-tint button, header.app-header-tint a")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom; }).length;
})()`);
check("收起侧栏后仍零重叠", overlap2 === 0, String(overlap2));
await cdp.evaluate(`window.__mock.collapseSidebar(false); "expand"`);
await tick();

console.log("\n[9] 原图档：零遮挡");
await cdp.evaluate(`document.querySelector('[data-coskin-vis="raw"]').click(); "raw"`);
check("原图档不挂板子", await waitFor(`!document.querySelector(".cs-hero-plate")`, 4000));
const gRaw = await cdp.evaluate(GEO);
check("原图档不动内容位置（上移已撤）", gRaw.liftPx === null && (gRaw.titleBoxTf === "" || gRaw.titleBoxTf === null), String(gRaw.titleBoxTf));
check("原图档仍保留行书字与卡片标记", gRaw.cardsMark === "1" && (await cdp.evaluate(`document.querySelectorAll("#sug .cs-glyph").length`)) === 4);
check("原图档给卡片行一个紧凑宽（戒条两行不折行）", /^\d+px$/.test(gRaw.sugCardsW), gRaw.sugCardsW);
check("紧凑宽窄于横幅档的整行宽", parseFloat(gRaw.sugCardsW) < g.main.width - 88, `${gRaw.sugCardsW} vs ${Math.round(g.main.width - 88)}`);
await cdp.evaluate(`document.querySelector('[data-coskin-vis="ambient"]').click(); "ambient"`);
check("切回氛围档板子回来", await waitFor(`document.querySelector(".cs-hero-plate")`, 4000));

console.log("\n[10] 板子质感四档");
const plateStyle = `(() => { const p = document.querySelector(".cs-hero-plate"); const cs = getComputedStyle(p);
  return { bgImage: p.style.backgroundImage, shadow: p.style.boxShadow, blur: cs.backdropFilter || cs.webkitBackdropFilter,
    titleZ: getComputedStyle(document.getElementById("title-wrap")).zIndex }; })()`;
for (const [fx, wantRaise, wantFrost] of [["flat", false, false], ["raise", true, false], ["frost", false, true], ["both", true, true]]) {
  await cdp.evaluate(`document.querySelector('[data-coskin-plate="${fx}"]').click(); "${fx}"`);
  const ps = await cdp.evaluate(plateStyle);
  const hasRaise = ps.bgImage.includes("linear-gradient") && ps.shadow.includes("inset");
  const hasFrost = (ps.blur || "").includes("blur");
  check(`「${fx}」立体层 ${wantRaise ? "有" : "无"}`, hasRaise === wantRaise, JSON.stringify(ps.bgImage.slice(0, 40)));
  check(`「${fx}」磨砂层 ${wantFrost ? "有" : "无"}`, hasFrost === wantFrost, String(ps.blur));
  check(`「${fx}」标题始终压在板子之上（磨砂不糊标题）`, ps.titleZ === "2", ps.titleZ);
}
await cdp.evaluate(`document.querySelector('[data-coskin-plate="raise"]').click(); "raise"`);

console.log("\n[11] 窗口尺寸变化：板子重新贴合");
await setViewport(1180, 760);
await tick();
const gS = await cdp.evaluate(GEO);
check("缩窗后板顶仍 = 顶栏底 + 50", near(gS.plate.top - gS.header.bottom, 50, 2), `实测 ${Math.round(gS.plate.top - gS.header.bottom)}`);
check("缩窗后板宽跟着主区收", near(gS.plate.width, gS.main.width - 88, 3), `${Math.round(gS.plate.width)} vs ${Math.round(gS.main.width - 88)}`);
const ratioS = plateRatio(gS);
check("缩窗后板高仍在 22%~55%", ratioS >= 0.22 && ratioS <= 0.55, `实测 ${(ratioS * 100).toFixed(1)}%`);
await setViewport(1440, 900);
await tick();

console.log("\n[12] 离开首页：装饰全撤、官方元素原样奉还");
await cdp.evaluate(`window.__mock.leaveHome(); "leave"`);
check("离开首页后板子撤掉", await waitFor(`!document.querySelector(".cs-hero-plate")`, 4000));
const gLeave = await cdp.evaluate(GEO);
check("离开首页后作用域标记已清", gLeave.codexScope === undefined);
check("离开首页后上移与内联样式还原", gLeave.liftPx === null && (gLeave.titleBoxTf === "" || gLeave.titleBoxTf === null)
  && gLeave.anchorPos === "static" && gLeave.anchorIso === "auto", `${gLeave.titleBoxTf}/${gLeave.anchorPos}/${gLeave.anchorIso}`);
check("离开首页后标题回到官方配色", (await cdp.evaluate(`getComputedStyle(document.querySelector(".heading-xl")).color`)) === titleColor0);
await cdp.evaluate(`window.__mock.enterHome(); "enter"`);
check("回到首页装饰自动复原", await waitFor(`document.querySelector(".cs-hero-plate") && document.querySelectorAll("#sug .cs-glyph").length === 4`, 4000));

console.log("\n[13] 还原：首页不留一丝痕迹");
const restored = await cdp.evaluate(RESTORE_SCRIPT);
check("还原返回 coskin:restored", restored === "coskin:restored", String(restored));
const gEnd = await cdp.evaluate(GEO);
const cardsEnd = await cdp.evaluate(CARDS);
check("板子 / 品牌行 / 桌宠全部消失", gEnd.plate === null && gEnd.brand === null
  && (await cdp.evaluate(`!document.getElementById("coskin-pet") && !document.getElementById("coskin-ui")`)) === true);
check("行书字清空、官方 svg 复原", cardsEnd.every((c) => c.glyph === null && c.svgHidden === false));
check("卡片文案逐字还回官方原文",
  JSON.stringify(cardsEnd.map((c) => c.text)) === JSON.stringify(cards0.map((c) => c.text)),
  JSON.stringify(cardsEnd.map((c) => c.text)));
check("标题颜色/字重回基线", (await cdp.evaluate(`getComputedStyle(document.querySelector(".heading-xl")).color`)) === titleColor0);
check("锚容器与标题块的内联样式清干净", gEnd.anchorPos === "static" && gEnd.anchorIso === "auto"
  && (gEnd.titleBoxTf === "" || gEnd.titleBoxTf === null) && gEnd.titleBoxZ === "auto",
  `${gEnd.anchorPos}/${gEnd.anchorIso}/${gEnd.titleBoxTf}/${gEnd.titleBoxZ}`);
check("输入框位置从头到尾没被动过", near(gEnd.composer.top, g0.composer.top, 1));
check("所有 data-cs-* 标记归零", (await cdp.evaluate(`(() => {
  const keys = ["csCodex","csCards","csCol","csLifted","csLiftPx","csPrevTf","csPrevPos","csPrevIso","csTitled",
    "csGlyphed","csOrig","csLined","csPrevText","csHid","csCardVars","csPrevZ","csPrevPosZ"];
  const attrs = keys.map((k) => "[data-" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()) + "]").join(",");
  return document.querySelectorAll(attrs).length;
})()`)) === 0);
check("首页残留元素为零（.cs-glyph / .cs-hero-plate / .cs-hero-art）",
  (await cdp.evaluate(`document.querySelectorAll(".cs-glyph, .cs-hero-plate, .cs-hero-art").length`)) === 0);

cdp.close();
console.log(failures.length === 0
  ? `\n首页装饰回归全部通过 ✅（${passed} 条断言）`
  : `\n共 ${failures.length} 项失败：${failures.join("；")}`);
process.exit(failures.length === 0 ? 0 : 1);
