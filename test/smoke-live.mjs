#!/usr/bin/env node
// 真机烟雾测试：连上**正在运行的 Codex**，只读地检查「我们对真机 DOM 的假设」还成不成立。
//
//   node test/smoke-live.mjs            连默认调试端口 9341
//   node test/smoke-live.mjs --port N   指定端口
//
// 它补的是 mock 回归补不了的那一段：mock 只能锁住「我们的假设」，锁不住「真机变了」。
// Codex 一升级改了类名/结构，mock 照样全绿、真机却崩——这里就是提前发现那件事的地方。
//
// ⚠️ 严格只读：全程只有 querySelector / getComputedStyle / getBoundingClientRect。
// 不换肤、不改样式、不动焦点、不重启任何东西。使用者可以一边用一边跑。

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Cdp, cdpAlive, listTargets, pageTargets } from "../src/cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 注意 indexOf 找不到时返回 -1，+1 就成了 argv[0]（node 的路径）——必须先判在不在
const argv = process.argv;
const pi = argv.indexOf("--port");
const port = Number(pi >= 0 ? argv[pi + 1] : 0) || 9341;

let hard = 0, soft = 0, ok = 0;
const P = (s) => console.log(s);
const yes = (label, detail = "") => { ok++; P(`  ✅ ${label}${detail ? "  " + detail : ""}`); };
const warn = (label, detail = "") => { soft++; P(`  ⚠️  ${label}${detail ? "  " + detail : ""}`); };
const bad = (label, detail = "") => { hard++; P(`  ❌ ${label}${detail ? "  " + detail : ""}`); };

if (!(await cdpAlive(port))) {
  console.error(`调试端口 ${port} 不通。`);
  console.error("说明 Codex 不是通过 CoSkin 启动的（官方原样启动不开调试端口，这是正常且安全的）。");
  console.error("要跑这个检查，先用 CoSkin 启动一次 Codex 再来。");
  process.exit(2);
}
const targets = pageTargets(await listTargets(port));
if (!targets.length) { console.error("端口通，但没找到页面目标。"); process.exit(2); }
const cdp = await Cdp.connect(targets[0].webSocketDebuggerUrl);

// 一次性把要看的东西全捞回来，少打扰几次
const SNAP = `(() => {
  const q = (s) => { try { return document.querySelector(s); } catch { return null; } };
  const qa = (s) => { try { return [...document.querySelectorAll(s)]; } catch { return []; } };
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const sug = q('[class*="home-suggestions"]');
  const main = q("main.main-surface");
  const title = main ? (main.querySelector('[class*="heading-xl"]') || main.querySelector('[class*="group/title"]')) : null;
  const titleBox = title ? title.parentElement : null;
  const label = q('[class*="font-openai-sans"][class*="font-semibold"]');
  const pills = qa("button").map((b) => (b.textContent || "").trim()).filter((t) => t === "Chat" || t === "Work");

  let icon = null;
  if (titleBox && title) {
    const tr = title.getBoundingClientRect();
    for (const e of titleBox.querySelectorAll("svg,img")) {
      const ir = e.getBoundingClientRect();
      if (ir.height > 10 && ir.height < 160 && ir.bottom <= tr.top + 8) { if (!icon || ir.top < icon.getBoundingClientRect().top) icon = e; }
    }
  }
  // 顶栏里被品牌行用来「让位」的可点控件
  let ctrlRight = 0, ctrlCount = 0;
  const hdr = q("header.app-header-tint");
  for (const el of (hdr || document).querySelectorAll("button,a,[role=button]")) {
    const b = el.getBoundingClientRect();
    if (b.height > 8 && b.width > 0 && b.top < 52 && b.left < 640) { ctrlCount++; if (b.right > ctrlRight) ctrlRight = b.right; }
  }

  return {
    shellClass: document.documentElement.className,
    appearance: /electron-(dark|light)/.exec(document.documentElement.className)?.[1] ?? null,
    has: {
      main: !!main, header: !!hdr, sidebar: !!q("aside.app-shell-left-panel"),
      wrapper: !!q("[data-vscode-context]"), composer: !!q(".composer-surface-chrome"),
      threadScroll: !!q(".thread-scroll-container"),
      sug: !!sug, title: !!title, titleBox: !!titleBox, icon: !!icon,
      anchor: !!(sug && sug.parentElement),
      menu: !!q("[role=menu]"), diffAdd: !!q(".diff-add"), term: !!q(".term"),
      btnPrimary: !!q(".btn-primary"), cmEditor: !!q(".cm-editor"),
    },
    titleClass: title ? title.className : null,
    titleText: title ? (title.textContent || "").trim().slice(0, 80) : null,
    productLabel: label ? (label.textContent || "").trim() : null,
    productLabelTag: label ? label.tagName.toLowerCase() : null,
    productLabelClickable: label ? !!label.closest("button,a,[role=button]") : null,
    pills,
    tokenVars: {
      fg: cssVar("--color-token-foreground"),
      sidebar: cssVar("--color-token-side-bar-background"),
      diff: cssVar("--color-token-git-decoration-added-resource-foreground"),
      menu: cssVar("--vscode-menu-background"),
      editor: cssVar("--vscode-editor-background"),
      btn: cssVar("--color-background-button-primary"),
    },
    // 卡片原文：CoSkin 换过文案时用它记的原文快照，否则用当前文案
    cards: sug ? [...sug.querySelectorAll("button")].map((b) => ({
      text: (b.dataset.csOrig ?? b.textContent ?? "").trim().slice(0, 60),
      replaced: b.dataset.csOrig !== undefined,
      hasSvg: !!b.querySelector("svg"),
    })) : [],
    // CoSkin 现况（只汇报，不改）
    coskin: {
      active: window.__coskinActive ?? null,
      ui: !!document.getElementById("coskin-ui"),
      pet: !!document.getElementById("coskin-pet"),
      brand: !!document.getElementById("coskin-brand"),
      plate: !!document.querySelector(".cs-hero-plate"),
      glyphs: document.querySelectorAll(".cs-glyph").length,
      codexScope: document.documentElement.dataset.csCodex ?? null,
      liftPx: (() => { const a = sug && sug.parentElement; return a && a.dataset.csLiftPx !== undefined ? Number(a.dataset.csLiftPx) : null; })(),
    },
    geo: {
      header: r(hdr), main: r(main), sug: r(sug), title: r(title), icon: r(icon),
      plate: r(document.querySelector(".cs-hero-plate")),
      brand: r(document.getElementById("coskin-brand")),
      ctrlRight, ctrlCount, innerHeight: window.innerHeight,
    },
  };
})()`;

const s = await cdp.evaluate(SNAP);

P("\n═══ 真机烟雾测试（只读）═══");
P(`\n当前状态：外观 ${s.appearance ?? "?"} ｜ CoSkin ${s.coskin.active ? "已应用「" + s.coskin.active + "」" : "未应用"}` +
  ` ｜ 面板 ${s.coskin.ui ? "在" : "无"} ｜ 桌宠 ${s.coskin.pet ? "在" : "无"}`);
const onHome = s.has.sug;
P(`视图：${onHome ? "首页（卡片行可见）" : "非首页（会话中）——首页相关的检查会跳过"}`);

P("\n[1] 结构锚点（注入的地基，缺一个都会明显坏）");
const HARD = [
  ["main.main-surface（主区）", s.has.main],
  ["header.app-header-tint（顶栏）", s.has.header],
  ["aside.app-shell-left-panel（侧栏）", s.has.sidebar],
  ["[data-vscode-context]（会话包装层，必须透明）", s.has.wrapper],
];
for (const [name, present] of HARD) present ? yes(name) : bad(name, "选择器已失效");
s.has.composer ? yes(".composer-surface-chrome（输入框）") : warn(".composer-surface-chrome（输入框）", "本次视图不可见");
s.appearance ? yes(`外观类 electron-${s.appearance}（外观同步靠它）`) : bad("外观类 electron-dark/light", s.shellClass.slice(0, 60));

P("\n[2] 首页装饰依赖的形状");
if (!onHome) {
  warn("首页未打开，本节全部跳过", "想测这段就切回 Codex 首页再跑一次");
} else {
  yes('[class*="home-suggestions"]（卡片行）');
  s.has.anchor ? yes("锚容器 = 卡片行的父级（板子挂在这）") : bad("锚容器缺失");
  s.has.title
    ? yes("标题结构类名仍在", `${JSON.stringify(String(s.titleClass).slice(0, 40))}`)
    : bad('标题结构类名 heading-xl / group-title 都没命中', "findTitle 会退回文案兜底，几何有失控风险");
  if (s.has.title) P(`      标题文案：${JSON.stringify(s.titleText)}`);
  s.has.icon ? yes("标题上方有官方图标（板顶要包住它）") : warn("标题上方没量到图标", "可能是本次布局没有，板顶会只按标题算");
  s.has.titleBox ? yes("标题块（title.parentElement）可用于单独上移") : bad("标题块缺失");
}

P("\n[3] 模式判别（Codex ↔ ChatGPT 不串味）");
if (s.productLabel === null) {
  warn("产品名标签没找到", "会退到 Chat/Work 兜底判据");
} else if (s.productLabel === "Codex" || s.productLabel === "ChatGPT") {
  yes("产品名标签可读", `「${s.productLabel}」`);
} else {
  bad("产品名标签读到了意外的值", `「${s.productLabel}」——判据会两条都落空，退回「保持装饰」`);
}
const pairs = s.pills.includes("Chat") && s.pills.includes("Work");
P(`      兜底判据：Chat/Work 药丸 ${pairs ? "成对出现（判为 ChatGPT 模式）" : "未成对（判为 Codex 模式）"}`);
if (s.productLabel === "Codex" && pairs) warn("两条判据打架", "产品名说 Codex，药丸说 ChatGPT——以产品名为准，先不慌，但值得盯");

P("\n[4] 配色接管靠的 token 变量");
for (const [k, name] of [["fg", "--color-token-foreground"], ["sidebar", "--color-token-side-bar-background"],
  ["diff", "--color-token-git-decoration-added-resource-foreground"], ["menu", "--vscode-menu-background"],
  ["editor", "--vscode-editor-background"], ["btn", "--color-background-button-primary"]]) {
  s.tokenVars[k] ? yes(name, `= ${s.tokenVars[k]}`) : bad(name, "未定义——这一族颜色接管会失效");
}

P("\n[5] 卡片认字：主题的 match 还能命中真机原文吗");
if (!onHome) {
  warn("首页未打开，跳过");
} else if (!s.cards.length) {
  warn("卡片行里没有 button", "结构可能变了");
} else {
  const files = (await readdir(join(ROOT, "themes"))).filter((f) => f.endsWith(".json"));
  const rules = [];
  for (const f of files) {
    const t = JSON.parse(await readFile(join(ROOT, "themes", f), "utf8"));
    for (const kind of ["cards", "subCards"]) {
      for (const c of (t.decor?.[kind] ?? [])) for (const m of [].concat(c.match || [])) rules.push({ theme: t.id, m: String(m), glyph: c.glyph });
    }
  }
  let hit = 0;
  for (const c of s.cards) {
    const low = c.text.toLowerCase();
    const r = rules.find((x) => low.includes(x.m.toLowerCase()));
    if (r) { hit++; P(`  ✅ ${JSON.stringify(c.text)} → 「${r.glyph}」(${r.theme})${c.replaced ? "  [已换文案，用的原文快照]" : ""}`); }
    else P(`  ·  ${JSON.stringify(c.text)} → 无匹配（保持官方原样）`);
  }
  if (hit === 0) bad("一张卡都匹配不上", "Codex 大概改了首页卡片文案，行书字已经全哑了——要更新 themes/*.json 的 match");
  else { ok++; P(`  ✅ ${hit}/${s.cards.length} 张卡命中主题规则`); }
}

P("\n[6] 品牌行让位（只在 CoSkin 已应用时能测）");
if (!s.coskin.brand || !s.geo.brand) {
  warn("品牌行不在（CoSkin 未应用）", "跳过");
} else {
  P(`      顶栏可点控件 ${s.geo.ctrlCount} 个，最右边缘 ${Math.round(s.geo.ctrlRight)}`);
  s.geo.brand.left >= s.geo.ctrlRight + 15
    ? yes("品牌行让开了顶栏控件", `左缘 ${Math.round(s.geo.brand.left)}`)
    : bad("品牌行压住顶栏控件", `左缘 ${Math.round(s.geo.brand.left)} < ${Math.round(s.geo.ctrlRight)}+16`);
  // 真机独有：产品名标签是纯文本时不参与让位测量，可能被压住
  if (s.productLabel && s.productLabelClickable === false)
    warn(`产品名「${s.productLabel}」是不可点的 ${s.productLabelTag}`, "不参与让位测量，理论上可能被品牌文字压住——肉眼确认一下");
}

P("\n[7] 板子几何（只在首页 + 已应用 + 非原图档时能测）");
if (!s.coskin.plate || !s.geo.plate || !s.geo.header) {
  warn("板子不在（未应用 / 非首页 / 原图档）", "跳过");
} else {
  const g = s.geo, gap = g.plate.top - g.header.bottom;
  Math.abs(gap - 50) <= 4 ? yes("板顶 = 顶栏底 + 50", `实测 ${Math.round(gap)}`) : bad("板顶偏离设定", `实测 ${Math.round(gap)}，应为 50`);
  if (g.icon) (g.plate.top <= g.icon.top + 1 && g.plate.bottom >= g.icon.bottom)
    ? yes("板子完整包住官方图标") : bad("图标露在板外", `图标 ${Math.round(g.icon.top)}–${Math.round(g.icon.bottom)}，板 ${Math.round(g.plate.top)}–${Math.round(g.plate.bottom)}`);
  if (g.sug) (g.plate.bottom >= g.sug.bottom + 10)
    ? yes("板底盖过卡片行") : bad("卡片行露在板外", `卡片底 ${Math.round(g.sug.bottom)}，板底 ${Math.round(g.plate.bottom)}`);
  const ratio = (g.plate.height - 2) / (g.innerHeight - g.header.bottom);
  (ratio >= 0.22 && ratio <= 0.55) ? yes("板高在 22%~55%", `实测 ${(ratio * 100).toFixed(1)}%`)
    : bad("板高超出夹子区间", `实测 ${(ratio * 100).toFixed(1)}%`);
  if (s.coskin.liftPx !== null) yes("内容上移已记账", `${s.coskin.liftPx}px（还原时按此精确恢复）`);
}

cdp.close();
P("");
if (hard === 0) {
  P(`真机契约完好 ✅（${ok} 项通过${soft ? `，${soft} 项因当前视图跳过` : ""}）`);
  P("含义：我们对真机 DOM 的假设仍然成立，mock 回归绿灯是可信的。");
} else {
  P(`❌ ${hard} 项真机契约已失效${soft ? `（另有 ${soft} 项跳过）` : ""}`);
  P("含义：Codex 改了界面，mock 回归即使全绿也不代表真机没坏——按上面的提示改 src/css.mjs 的选择器。");
}
process.exit(hard === 0 ? 0 : 1);
