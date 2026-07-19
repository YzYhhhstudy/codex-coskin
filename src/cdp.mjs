// 极简 CDP 客户端：只依赖 Node 22+ 内置的 fetch / WebSocket
const JSON_TIMEOUT_MS = 2000;

export async function cdpAlive(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`CDP /json/list 返回 ${res.status}`);
  return res.json();
}

// Codex Desktop 主窗口是 app://-/index.html；排除 devtools 等非页面目标
export function pageTargets(targets) {
  return targets.filter(
    (t) =>
      t.type === "page" &&
      typeof t.url === "string" &&
      !t.url.startsWith("devtools://") &&
      typeof t.webSocketDebuggerUrl === "string",
  );
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) return; // 事件通知，MVP 不消费
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`${msg.error.message ?? "CDP error"} (${msg.error.code ?? "?"})`));
      else entry.resolve(msg.result);
    });
    ws.addEventListener("close", () => this.#flushAll(new Error("CDP 连接已关闭")));
    ws.addEventListener("error", () => this.#flushAll(new Error("CDP 连接出错")));
  }

  #flushAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  static connect(wsUrl, { timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error(`连接 CDP 超时：${wsUrl}`));
      }, timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`无法连接 CDP：${wsUrl}`));
      });
    });
  }

  send(method, params = {}, { timeoutMs = 20000 } = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // 在页面里执行表达式并取回 JSON 值；表达式抛错时转成 Node 侧异常
  async evaluate(expression, { awaitPromise = false, timeoutMs = 30000 } = {}) {
    const result = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise },
      { timeoutMs },
    );
    if (result.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "页面内执行失败";
      throw new Error(detail.split("\n")[0]);
    }
    return result.result?.value;
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

// 对每个疑似页面目标做探测/操作，返回逐目标结果
export async function withPageTargets(port, fn) {
  const targets = pageTargets(await listTargets(port));
  const results = [];
  for (const target of targets) {
    let cdp = null;
    try {
      cdp = await Cdp.connect(target.webSocketDebuggerUrl);
      results.push({ target, ok: true, value: await fn(cdp, target) });
    } catch (error) {
      results.push({ target, ok: false, error });
    } finally {
      cdp?.close();
    }
  }
  return results;
}
