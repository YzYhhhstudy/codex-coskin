// macOS 版：Codex Desktop = /Applications/ChatGPT.app（bundle id com.openai.codex）。
// 只做优雅退出（osascript quit），绝不 kill -9。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { cdpAlive } from "./cdp.mjs";
import { DEFAULT_PORT, sleep, waitForCdp, waitForPage } from "./launcher-shared.mjs";

const run = promisify(execFile);
const BUNDLE_ID = "com.openai.codex";

export function findApp() {
  const explicit = process.env.COSKIN_APP;
  const candidates = explicit
    ? [explicit]
    : ["/Applications/ChatGPT.app", join(homedir(), "Applications", "ChatGPT.app")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "Contents", "MacOS"))) return candidate;
  }
  throw new Error(
    `没找到 Codex Desktop（ChatGPT.app）。找过：${candidates.join("、")}。` +
      `可以用环境变量 COSKIN_APP 指定 .app 路径。`,
  );
}

// 注意：旧版“ChatGPT Classic.app”的二进制也叫 ChatGPT，必须用完整 app 路径前缀区分
export async function mainProcessLines(appPath) {
  const prefix = join(appPath, "Contents", "MacOS") + "/";
  const { stdout } = await run("ps", ["ax", "-o", "pid=,command="]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      const command = line.replace(/^\d+\s+/, "");
      return command.startsWith(prefix);
    });
}

export async function appState(appPath, port) {
  const lines = await mainProcessLines(appPath);
  const running = lines.length > 0;
  const hasDebugFlag = lines.some((line) => line.includes("--remote-debugging-port"));
  const alive = await cdpAlive(port);
  return { running, hasDebugFlag, cdpAlive: alive };
}

async function quitApp(appPath, log) {
  try {
    await run("osascript", ["-e", `tell application id "${BUNDLE_ID}" to quit`]);
  } catch {
    const name = appPath.split("/").pop().replace(/\.app$/, "");
    await run("osascript", ["-e", `tell application "${name}" to quit`]);
  }
  const deadline = Date.now() + 60000;
  let nudged = false;
  while (Date.now() < deadline) {
    if ((await mainProcessLines(appPath)).length === 0) return;
    if (!nudged && Date.now() > deadline - 52000) {
      log("Codex 没有响应退出请求 —— 如果它弹了确认框请点确认，或手动 ⌘Q 退出，我最多再等 50 秒…");
      nudged = true;
    }
    await sleep(500);
  }
  throw new Error("Codex 一直没退出。请手动完全退出它（⌘Q）后再试一次。");
}

export async function ensureSkinnable(port = DEFAULT_PORT, { log = () => {}, confirmRestart = null } = {}) {
  const appPath = findApp();
  const state = await appState(appPath, port);
  if (state.cdpAlive) return { appPath, relaunched: false };

  if (state.running) {
    const approved = confirmRestart ? await confirmRestart() : false;
    if (!approved) {
      throw new Error(
        "Codex 正在运行。为了不打断你，我不会自动重启它。" +
          "等你方便时在菜单里选择同意重启，或自己 ⌘Q 完全退出 Codex 后再试。",
      );
    }
    log("Codex 正在以普通模式运行，先请它优雅退出…");
    await quitApp(appPath, log);
    await sleep(1000);
  }
  log("以本机调试模式启动 Codex（仅监听 127.0.0.1）…");
  await run("open", [
    "-a",
    appPath,
    "--args",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ]);
  await waitForCdp(port, 40000);
  await waitForPage(port, 30000);
  await sleep(1500);
  return { appPath, relaunched: true };
}
