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

console.log("[2] 面板 UI：每个主题右侧有导出箭头 + 有上传按钮");
const ui = await cdp.evaluate(`(() => ({
  dl: document.querySelectorAll("#coskin-ui .coskin-dl").length,
  themes: document.querySelectorAll("#coskin-ui [data-coskin-theme]:not([data-coskin-theme='__native__'])").length,
  hasImport: [...document.querySelectorAll("#coskin-ui .coskin-item")].some((b) => b.textContent.includes(".coskin 主题文件")),
}))()`);
check("导出箭头数 = 主题数", ui.dl === ui.themes && ui.dl >= 1, JSON.stringify(ui));
check("有「上传 .coskin 主题文件」按钮", ui.hasImport === true);

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

cdp.close();
if (failures.length) { console.error(`\n${failures.length} 项失败：${failures.join("；")}`); process.exit(1); }
console.log("\n面板导出/导入往返全部通过 ✅ 前后两个主题逐字段一致。");
