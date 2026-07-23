#!/usr/bin/env node
// 自包含 mock 回归的启动器：自己起静态服务 + 起无头 Chrome + 跑断言，跑完全清理。
//
// 用法：node test/run-mock.mjs           跑全部套件（core + home）
//      node test/run-mock.mjs core      只跑核心机制
//      node test/run-mock.mjs home      只跑首页装饰
//      CHROME=/path/to/chrome node test/run-mock.mjs      指定浏览器
//
// 为什么要它：mock 页以前只躺在临时目录里，被系统清掉就跑不了回归了（真的发生过）。
// 现在页面进了仓库、启动也自包含——任何人 clone 下来都能一条命令跑完。
//
// 安全边界：只连自己拉起来的无头 Chrome（临时 profile、独立调试端口），
// 绝不碰用户正在用的 Codex（那边是 9341），跑完 kill 进程 + 删临时目录。

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { cdpAlive } from "../src/cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_DIR = join(HERE, "mock");

// 每个套件一套页面 + 断言 + 独立端口（端口错开，方便并排排查时同时开两个）
const SUITES = {
  core: { page: "core.html", verify: "core-verify.mjs", port: 9666, title: "核心机制" },
  home: { page: "home.html", verify: "home-verify.mjs", port: 9667, title: "首页装饰" },
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
for (const name of wanted) {
  if (!SUITES[name]) {
    console.error(`❌ 未知套件「${name}」。可选：${Object.keys(SUITES).join(" / ")}`);
    process.exit(1);
  }
}
const running = wanted.length ? wanted : Object.keys(SUITES);

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" };

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cands = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
       "/Applications/Chromium.app/Contents/MacOS/Chromium",
       "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : process.platform === "win32"
      ? [join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
         join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
         join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe")]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return cands.find((p) => { try { return existsSync(p); } catch { return false; } }) || null;
}

const chrome = findChrome();
if (!chrome) {
  console.error("❌ 没找到 Chrome/Chromium/Edge。装一个，或用 CHROME=/path/to/chrome 指定。");
  process.exit(1);
}

async function runSuite(name) {
  const suite = SUITES[name];
  const cdpPort = Number(process.env[`COSKIN_TEST_PORT_${name.toUpperCase()}`] || suite.port);
  console.log(`\n══════ ${name}（${suite.title}）══════`);

  // ① 静态服务（只服务 test/mock/，端口交给系统分配）
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || suite.page;
    const file = resolve(MOCK_DIR, rel);
    if (!file.startsWith(MOCK_DIR)) { res.writeHead(403).end("forbidden"); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/${suite.page}`;
  console.log(`[run-mock] mock 页: ${pageUrl}`);

  // ② 无头 Chrome（临时 profile，和用户日常浏览器完全隔离）
  const profile = await mkdtemp(join(tmpdir(), `coskin-test-${name}-`));
  const child = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${cdpPort}`, "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`, pageUrl,
  ], { stdio: "ignore", detached: false });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return; cleaned = true;
    try { child.kill("SIGKILL"); } catch {}
    try { server.close(); } catch {}
    try { await rm(profile, { recursive: true, force: true }); } catch {}
  };
  const onExit = () => { try { child.kill("SIGKILL"); } catch {} };
  process.on("exit", onExit);

  try {
    // ③ 等 CDP 起来
    const deadline = Date.now() + 20000;
    while (!(await cdpAlive(cdpPort))) {
      if (Date.now() > deadline) { console.error(`❌ 端口 ${cdpPort} 上没等到 CDP。`); return 1; }
      await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`[run-mock] CDP 就绪（:${cdpPort}），开始跑断言…\n`);

    // ④ 跑断言，透传退出码
    const verify = spawn(process.execPath, [join(HERE, suite.verify), "--port", String(cdpPort)], { stdio: "inherit" });
    return (await new Promise((r) => verify.on("exit", r))) ?? 1;
  } finally {
    await cleanup();
    process.off("exit", onExit);
  }
}

let failed = 0;
for (const name of running) {
  const code = await runSuite(name);
  if (code !== 0) failed++;
}
if (running.length > 1) {
  console.log(failed === 0
    ? `\n══════ 全部 ${running.length} 个套件通过 ✅ ══════`
    : `\n══════ ${failed}/${running.length} 个套件失败 ❌ ══════`);
}
process.exit(failed === 0 ? 0 : 1);
