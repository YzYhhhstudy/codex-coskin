// 平台无关的等待逻辑：等调试端口、等主窗口页面。
import { cdpAlive, listTargets, pageTargets } from "./cdp.mjs";

export const DEFAULT_PORT = 9341;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpAlive(port)) return;
    await sleep(500);
  }
  throw new Error(`Codex 启动了，但 ${timeoutMs / 1000} 秒内没等到调试端口 ${port}。`);
}

export async function waitForPage(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (pageTargets(await listTargets(port)).length > 0) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("调试端口通了，但没等到 Codex 主窗口页面。");
}
