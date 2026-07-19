// 平台分派入口：按 process.platform 选 macOS / Windows 实现。
// 对外接口（findApp / appState / ensureSkinnable / DEFAULT_PORT）两平台一致。
// findApp 在 Windows 上是异步（要查进程/AppX），调用方应统一 `await findApp()`——
// await 一个同步返回的字符串（macOS）也安全。
import * as mac from "./launcher-mac.mjs";
import * as win from "./launcher-win.mjs";
export { DEFAULT_PORT } from "./launcher-shared.mjs";

function impl() {
  if (process.platform === "darwin") return mac;
  if (process.platform === "win32") return win;
  throw new Error(
    `CoSkin 暂不支持该平台：${process.platform}（目前支持 macOS 与 Windows；Codex Desktop 也只有这两个平台）。`,
  );
}

export function findApp(...args) {
  return impl().findApp(...args);
}
export function appState(...args) {
  return impl().appState(...args);
}
export function ensureSkinnable(...args) {
  return impl().ensureSkinnable(...args);
}
