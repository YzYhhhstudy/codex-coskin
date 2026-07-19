// Windows 版：Codex Desktop = ChatGPT 应用（独立安装版 .exe 或 Microsoft Store/MSIX 版）。
// 只做优雅关闭（CloseMainWindow，等价点右上角 ×），绝不强杀（不 Stop-Process -Force）。
//
// ⚠️ 尚未在真实 Windows 上验证。独立安装版路径按常见安装位实现；
// Store/MSIX 版无法可靠透传调试参数，检测到会给出明确指引而非静默失败。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { cdpAlive } from "./cdp.mjs";
import { DEFAULT_PORT, sleep, waitForCdp, waitForPage } from "./launcher-shared.mjs";

const run = promisify(execFile);
const PS = "powershell.exe";
const psq = (s) => String(s).replace(/'/g, "''"); // PowerShell 单引号转义

async function ps(script) {
  const { stdout } = await run(PS, ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
  });
  return stdout.trim();
}

export async function findApp() {
  const explicit = process.env.COSKIN_APP;
  if (explicit) {
    if (existsSync(explicit)) return explicit;
    throw new Error(`COSKIN_APP 指向的文件不存在：${explicit}`);
  }
  const local = process.env.LOCALAPPDATA || "";
  const pf = process.env.PROGRAMFILES || "";
  const candidates = [
    join(local, "Programs", "ChatGPT", "ChatGPT.exe"),
    join(local, "ChatGPT", "ChatGPT.exe"),
    join(pf, "ChatGPT", "ChatGPT.exe"),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  // Store/MSIX 兜底：查出 AUMID（PackageFamilyName!AppId）
  try {
    const aumid = await ps(
      "$p = Get-AppxPackage *OpenAI* -ErrorAction SilentlyContinue | Select-Object -First 1; " +
        "if ($p) { $id = (Get-AppxPackageManifest $p).Package.Applications.Application.Id | Select-Object -First 1; " +
        "if ($id) { $p.PackageFamilyName + '!' + $id } }",
    );
    if (aumid) return "msix:" + aumid;
  } catch {}
  throw new Error(
    "没找到 Codex Desktop（ChatGPT）。找过独立安装版常见路径与 Microsoft Store 版。" +
      "可用环境变量 COSKIN_APP 指定 ChatGPT.exe 的完整路径。",
  );
}

// 进程识别：独立版按可执行路径精确匹配；MSIX 版按进程名 ChatGPT.exe
export async function processLines(app) {
  const query = app.startsWith("msix:")
    ? "Get-CimInstance Win32_Process -Filter \"Name='ChatGPT.exe'\""
    : `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${psq(app)}' }`;
  const out = await ps(
    `${query} | ForEach-Object { $_.ProcessId.ToString() + ' ' + [string]$_.CommandLine }`,
  );
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

export async function appState(app, port) {
  const lines = await processLines(app);
  const running = lines.length > 0;
  const hasDebugFlag = lines.some((line) => line.includes("--remote-debugging-port"));
  const alive = await cdpAlive(port);
  return { running, hasDebugFlag, cdpAlive: alive };
}

async function quitApp(app, log) {
  // CloseMainWindow() 是优雅关闭请求（等价点 ×），不是强杀
  await ps(
    "Get-Process ChatGPT -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }",
  ).catch(() => {});
  const deadline = Date.now() + 60000;
  let nudged = false;
  while (Date.now() < deadline) {
    if ((await processLines(app)).length === 0) return;
    if (!nudged && Date.now() > deadline - 52000) {
      log("Codex 没有响应关闭请求 —— 如果它弹了确认框请点确认，或手动关闭它，我最多再等 50 秒…");
      nudged = true;
    }
    await sleep(500);
  }
  throw new Error("Codex 一直没退出。请手动完全关闭它后再试一次。");
}

export async function ensureSkinnable(port = DEFAULT_PORT, { log = () => {}, confirmRestart = null } = {}) {
  const app = await findApp();
  const state = await appState(app, port);
  if (state.cdpAlive) return { appPath: app, relaunched: false };

  if (app.startsWith("msix:")) {
    throw new Error(
      "检测到 Microsoft Store 版 ChatGPT。Store/MSIX 版目前无法可靠地带本机调试参数启动，" +
        "CoSkin 暂不支持。请改用 ChatGPT 独立安装版，或用环境变量 COSKIN_APP 指定独立版 ChatGPT.exe 后重试。",
    );
  }

  if (state.running) {
    const approved = confirmRestart ? await confirmRestart() : false;
    if (!approved) {
      throw new Error(
        "Codex 正在运行。为了不打断你，我不会自动重启它。" +
          "等你方便时在菜单里选择同意重启，或自己完全关闭 Codex 后再试。",
      );
    }
    log("Codex 正在以普通模式运行，先请它优雅关闭…");
    await quitApp(app, log);
    await sleep(1200);
  }

  log("以本机调试模式启动 Codex（仅监听 127.0.0.1）…");
  const argList = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ].map((a) => `'${a}'`).join(",");
  await ps(`Start-Process -FilePath '${psq(app)}' -ArgumentList ${argList}`);
  await waitForCdp(port, 40000);
  await waitForPage(port, 30000);
  await sleep(1500);
  return { appPath: app, relaunched: true };
}
