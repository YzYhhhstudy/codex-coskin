#!/usr/bin/env node
// 自包含核心回归的启动器：自己起静态服务 + 起无头 Chrome + 跑 core-verify，跑完全清理。
//
// 用法：node test/run-core.mjs          （零参数，零依赖）
//      CHROME=/path/to/chrome node test/run-core.mjs   （指定浏览器）
//
// 为什么要它：mock 页以前只躺在临时目录里，被系统清掉就跑不了回归了（真的发生过）。
// 现在页面进了仓库、启动也自包含——任何人 clone 下来都能一条命令跑完。

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
const CDP_PORT = Number(process.env.COSKIN_TEST_PORT || 9666);

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

// ① 静态服务（只服务 test/mock/，端口交给系统分配）
const server = createServer(async (req, res) => {
  const name = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "core.html";
  const file = resolve(MOCK_DIR, name);
  if (!file.startsWith(MOCK_DIR)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const httpPort = server.address().port;
const pageUrl = `http://127.0.0.1:${httpPort}/core.html`;
console.log(`[run-core] mock 页: ${pageUrl}`);

// ② 无头 Chrome
const profile = await mkdtemp(join(tmpdir(), "coskin-test-"));
const child = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${CDP_PORT}`, "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${profile}`, pageUrl,
], { stdio: "ignore", detached: false });

let cleaned = false;
const cleanup = async () => {
  if (cleaned) return; cleaned = true;
  try { child.kill("SIGKILL"); } catch {}
  try { server.close(); } catch {}
  try { await rm(profile, { recursive: true, force: true }); } catch {}
};
process.on("exit", () => { try { child.kill("SIGKILL"); } catch {} });
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });

// ③ 等 CDP 起来
const deadline = Date.now() + 20000;
while (!(await cdpAlive(CDP_PORT))) {
  if (Date.now() > deadline) { console.error(`❌ 端口 ${CDP_PORT} 上没等到 CDP。`); await cleanup(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 300));
}
console.log(`[run-core] CDP 就绪（:${CDP_PORT}），开始跑断言…\n`);

// ④ 跑断言，透传退出码
const verify = spawn(process.execPath, [join(HERE, "core-verify.mjs"), "--port", String(CDP_PORT)], { stdio: "inherit" });
const code = await new Promise((r) => verify.on("exit", r));
await cleanup();
process.exit(code ?? 1);
