// 分享闭环回归：export → import 往返，梯度主题与图片主题各一遍（零 CDP，纯 Node）
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "src", "coskin.mjs");
const failures = [];
const check = (label, cond, detail = "") => {
  console.log(`  ${cond ? "✅" : "❌"} ${label} ${cond ? "" : detail}`);
  if (!cond) failures.push(label);
};
const cleanup = [];

// 1) 渐变主题往返（xuanzhi：带 cards/subCards/quotes 的全量 decor）
console.log("[1] 渐变主题 export → import");
const out1 = join(ROOT, "output", "rt-xuanzhi.coskin.json");
await run("node", [CLI, "export", "xuanzhi", "--out", out1]);
const share1 = JSON.parse(await readFile(out1, "utf8"));
check("导出格式头正确", share1.format === "coskin-theme" && share1.theme.palette.accent === "#b3402a");
check("decor 全量随行（cards+subCards+quotes）", share1.theme.decor.cards.length === 4 && share1.theme.decor.subCards.length === 1 && share1.theme.decor.quotes.length >= 3);
const imp1 = await run("node", [CLI, "import", out1]);
const id1 = (imp1.stdout.match(/id: (c-[a-z0-9-]+)/) ?? [])[1];
check("导入成功并得到新 id", !!id1, imp1.stdout);
cleanup.push(join(ROOT, "themes", "custom", id1));
const t1 = JSON.parse(await readFile(join(ROOT, "themes", "custom", id1, "theme.json"), "utf8"));
check("往返后 palette/decor/背景渐变一致", t1.palette.ink === "#2f2a24" && t1.decor.cards[0].glyph === "笔" && t1.background.css.includes("repeating-linear-gradient"));

// 2) 图片主题往返：造一个带 1px PNG 的临时主题
console.log("[2] 图片主题 export → import（壁纸字节一致）");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const srcDir = join(ROOT, "themes", "custom", "c-rt-src");
await mkdir(srcDir, { recursive: true });
await writeFile(join(srcDir, "bg.png"), PNG);
await writeFile(join(srcDir, "theme.json"), JSON.stringify({
  schemaVersion: 2, id: "c-rt-src", name: "往返测试", appearance: "dark",
  palette: { accent: "#7c6cff", secondary: "#22d3ee", surfaceTint: "#12142b" },
  backgroundFile: "bg.png",
}, null, 2));
cleanup.push(srcDir);
const out2 = join(ROOT, "output", "rt-image.coskin.json");
await run("node", [CLI, "export", "c-rt-src", "--out", out2]);
const imp2 = await run("node", [CLI, "import", out2]);
const id2 = (imp2.stdout.match(/id: (c-[a-z0-9-]+)/) ?? [])[1];
check("图片主题导入成功且 id 去重（不覆盖原目录）", !!id2 && id2 !== "c-rt-src", String(id2));
cleanup.push(join(ROOT, "themes", "custom", id2));
const back = await readFile(join(ROOT, "themes", "custom", id2, "bg.png"));
check("壁纸字节逐位一致", back.equals(PNG));

// 3) 非法文件拒收
console.log("[3] 非法文件拒收");
const bad = join(ROOT, "output", "rt-bad.json");
await writeFile(bad, JSON.stringify({ format: "not-coskin" }));
const badRun = await run("node", [CLI, "import", bad]).catch((e) => e);
check("非 coskin 文件被拒绝", badRun.code === 1 && String(badRun.stderr).includes("不是 CoSkin"), String(badRun.stderr).slice(0, 60));

for (const p of cleanup) await rm(p, { recursive: true, force: true });
await rm(out1, { force: true }); await rm(out2, { force: true }); await rm(bad, { force: true });

if (failures.length) { console.error(`\n${failures.length} 项失败`); process.exit(1); }
console.log("\n分享闭环往返全部通过 ✅");
