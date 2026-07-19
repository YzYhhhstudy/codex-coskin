// 面板导出/导入往返：把「正是修行时」（满配 decor + 壁纸）经悬浮窗按钮导出为 .coskin，
// 再经悬浮窗按钮导入，验证前后两个主题逐字段一致（除自动去重的 id 外）。
// 用法：node test/panel-share-roundtrip.mjs --port 9555
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, cdpAlive, listTargets, pageTargets } from "../src/cdp.mjs";
import { buildInjectionScript, PROBE_SCRIPT } from "../src/css.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number((process.argv[process.argv.indexOf("--port") + 1]) || 9555);
const failures = [];
const check = (label, cond, detail = "") => { console.log(`  ${cond ? "✅" : "❌"} ${label} ${cond ? "" : detail}`); if (!cond) failures.push(label); };

const deadline = Date.now() + 15000;
while (!(await cdpAlive(port))) { if (Date.now() > deadline) { console.error("无 CDP"); process.exit(1); } await new Promise((r) => setTimeout(r, 400)); }
const target = pageTargets(await listTargets(port)).find((t) => t.url.includes("mock"));
const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
await cdp.evaluate(`localStorage.clear(); "clean"`);

// 用「正是修行时」的满配 decor（取自内置 xiuxing）+ 一张小测试壁纸，构造面板主题条目
const xiuxing = JSON.parse(await readFile(join(ROOT, "themes", "xiuxing.json"), "utf8"));
// 一张合法的小 PNG（2x2），当作壁纸测往返字节一致
const WP = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP8z8Dwn4EIwDioFAB4ggL/1w5towAAAABJRU5ErkJggg==";
const srcEntry = {
  id: "xiuxing-src", name: "正是修行时", accent: xiuxing.palette.accent,
  appearance: xiuxing.appearance, spec: { palette: xiuxing.palette }, decor: xiuxing.decor,
  bg: `url("data:image/png;base64,${WP}") center center / cover no-repeat fixed`,
};

console.log("[1] 注入含壁纸+满配 decor 的主题，面板挂载");
const ok = await cdp.evaluate(buildInjectionScript([srcEntry], "xiuxing-src"), { timeoutMs: 30000 });
check("注入成功", ok === "coskin:ok", String(ok));
const probe = await cdp.evaluate(PROBE_SCRIPT);
check("当前主题 = xiuxing-src", probe?.active === "xiuxing-src", JSON.stringify(probe));

console.log("[2] 面板 UI：默认收起列表 + 固定选择器/导出/删除 + 上传");
const ui = await cdp.evaluate(`(() => ({
  listHidden: getComputedStyle(document.querySelector("#coskin-ui .coskin-list")).display === "none",
  hasExport: !!document.querySelector("#coskin-ui .coskin-act"),
  hasDel: !!document.querySelector("#coskin-ui .coskin-act-del"),
  label: (document.querySelector("#coskin-ui .coskin-act-label") || {}).textContent,
  caret: (document.querySelector("#coskin-ui .coskin-caret") || {}).textContent,
  hasImport: [...document.querySelectorAll("#coskin-ui .coskin-item")].some((b) => b.textContent.includes(".coskin 主题文件")),
}))()`);
check("主题列表默认收起", ui.listHidden === true && ui.caret === "▸", JSON.stringify(ui));
check("选择器显示当前主题名 + 有导出/删除", ui.hasExport && ui.hasDel && ui.label === "正是修行时", JSON.stringify(ui));
check("有「上传 .coskin 主题文件」按钮", ui.hasImport === true);
const expand = await cdp.evaluate(`(() => { document.querySelector("#coskin-ui .coskin-sel").click(); return { open: getComputedStyle(document.querySelector("#coskin-ui .coskin-list")).display !== "none", caret: document.querySelector("#coskin-ui .coskin-caret").textContent }; })()`);
check("点主题名展开列表（caret 变 ▾）", expand.open === true && expand.caret === "▾", JSON.stringify(expand));
await cdp.evaluate(`document.querySelector("#coskin-ui .coskin-sel").click()`); // 收回

console.log("[2b] 语言跟随 Codex：切到英文重注入，UI 变英文");
await cdp.evaluate(`document.documentElement.lang = "en"; "en"`);
await cdp.evaluate(buildInjectionScript([srcEntry], "xiuxing-src"), { timeoutMs: 30000 });
const en = await cdp.evaluate(`(() => ({
  header: document.querySelector("#coskin-ui .coskin-head").textContent,
  imp: [...document.querySelectorAll("#coskin-ui .coskin-item")].some((b) => b.textContent.includes("Import .coskin")),
  bg: [...document.querySelectorAll("#coskin-ui .coskin-ctl-label")].map((x) => x.textContent),
}))()`);
check("英文模式：header/上传/控件标签为英文", en.header.includes("Skins") && en.imp && en.bg.includes("Backdrop"), JSON.stringify(en));
await cdp.evaluate(`document.documentElement.lang = "zh-CN"; "zh"`);
await cdp.evaluate(buildInjectionScript([srcEntry], "xiuxing-src"), { timeoutMs: 30000 });

console.log("[3] 导出（悬浮窗 ⇩ 走的同一函数）→ 导入（悬浮窗上传走的同一函数）→ 再导出");
const s1 = await cdp.evaluate(`window.__coskinBuildShare("xiuxing-src")`);
check("导出得到 .coskin 文本", typeof s1 === "string" && s1.includes("coskin-theme"));
const newId = await cdp.evaluate(`window.__coskinApplyShare(${JSON.stringify(s1)})`);
check("导入生成去重新 id", typeof newId === "string" && newId !== "xiuxing-src", String(newId));
const after = await cdp.evaluate(PROBE_SCRIPT);
check("导入后自动应用新主题", after?.active === newId, JSON.stringify(after));
const s2 = await cdp.evaluate(`window.__coskinBuildShare(${JSON.stringify(newId)})`);

console.log("[4] 逐字段比对：两份 .coskin 除 theme.id 外完全一致");
const a = JSON.parse(s1), b = JSON.parse(s2);
check("appearance 一致", a.theme.appearance === b.theme.appearance, `${a.theme.appearance} vs ${b.theme.appearance}`);
check("palette 一致", JSON.stringify(a.theme.palette) === JSON.stringify(b.theme.palette));
check("decor 一致（横幅/卡片字/16 条戒条/桌宠台词全量）", JSON.stringify(a.theme.decor) === JSON.stringify(b.theme.decor));
check("壁纸字节一致", JSON.stringify(a.wallpaper) === JSON.stringify(b.wallpaper) && !!a.wallpaper?.dataBase64);
delete a.theme.id; delete b.theme.id;
check("除 id 外整体逐字节一致", JSON.stringify(a) === JSON.stringify(b));

console.log("[5] 重新注入后导入的主题仍在（localStorage 持久化）");
await cdp.evaluate(buildInjectionScript([srcEntry], "xiuxing-src"), { timeoutMs: 30000 });
const persisted = await cdp.evaluate(`!!document.querySelector('[data-coskin-theme="${newId}"]')`);
check("重注入后导入主题从 localStorage 恢复", persisted === true);

console.log("[6] 删除：导入主题=真删除；重注入后不再出现");
const delImp = await cdp.evaluate(`(() => { window.__coskinSetTheme("${newId}"); return JSON.stringify(window.__coskinDeleteTheme("${newId}")); })()`);
check("删除导入主题返回 removed", JSON.parse(delImp).kind === "removed", delImp);
check("删除后从列表消失", (await cdp.evaluate(`!document.querySelector('[data-coskin-theme="${newId}"]')`)) === true);
await cdp.evaluate(buildInjectionScript([srcEntry], "xiuxing-src"), { timeoutMs: 30000 });
check("重注入后导入主题不再回来（真删除）", (await cdp.evaluate(`!document.querySelector('[data-coskin-theme="${newId}"]')`)) === true);

console.log("[7] 删除：内置主题=软隐藏；重注入后仍不显示（可在 localStorage 恢复）");
const delBuiltin = await cdp.evaluate(`(() => { window.__coskinSetTheme("xiuxing-src"); return JSON.stringify(window.__coskinDeleteTheme("xiuxing-src")); })()`);
check("删除内置主题返回 hidden", JSON.parse(delBuiltin).kind === "hidden", delBuiltin);
await cdp.evaluate(buildInjectionScript([srcEntry], "xiuxing-src"), { timeoutMs: 30000 });
check("重注入后被隐藏的内置主题不显示", (await cdp.evaluate(`!document.querySelector('[data-coskin-theme="xiuxing-src"]')`)) === true);
check("隐藏记录在 coskin.hidden.v1", (await cdp.evaluate(`(JSON.parse(localStorage.getItem("coskin.hidden.v1")||"[]")).includes("xiuxing-src")`)) === true);

cdp.close();
if (failures.length) { console.error(`\n${failures.length} 项失败：${failures.join("；")}`); process.exit(1); }
console.log("\n面板导出/导入往返全部通过 ✅ 前后两个主题逐字段一致。");
