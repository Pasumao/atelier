/**
 * bridge.ts — Atelier dev 状态桥（决策 7「状态可检视性」雏形；research/05 维度 8）。
 *
 * 页面侧将当前 $state 信号图序列化并推送到 dev 面（POST /__atelier/bridge/state），
 * MCP 工具 `state.snapshot` 从该缓存读取——零依赖纯 HTTP，不需要浏览器调试协议。
 *
 * v0.1 机制（无内核侵入）：一个哨兵 $effect 读取 store._signals 全集，
 * 因此任一信号的写入都会在同一个 flush 批次重跑本 effect；节流后在微任务外推最新快照。
 * rollback()/timeTravel() 经 notify → 同一通路自动跟推（回滚可观测）。
 *
 * 完整版差异：双向通道（dev→页面下发 rollback/time_travel）、增量 patch 流、
 * 信号 debugName 与依赖图导出、编译期静态图直连。
 * 已知边界：仅覆盖安装时点已存在的信号（动态挂载的新组件信号需重装 bridge）。
 */
import { $effect, store } from "./core";

let pushing = false;
let queued = false;

function safeValue(v: unknown): unknown {
  try {
    JSON.stringify(v);
    return v;
  } catch {
    return String(v); // 循环引用/DOM 节点等不可序列化值的降级表示
  }
}

function serialize(): Record<string, unknown> {
  const signals = [...store._signals].map((s, i) => ({
    key: `sig-${i}`,
    value: safeValue(s.get()),
  }));
  return {
    at: Date.now(),
    href: typeof location !== "undefined" ? location.href : "(ssr)",
    checkpointCount: store._checkpoints.length,
    timeline: store.list(),
    signalCount: signals.length,
    signals,
  };
}

function push(): void {
  if (typeof window === "undefined") return;
  if (pushing) {
    queued = true;
    return;
  }
  pushing = true;
  fetch("/__atelier/bridge/state", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-atelier-token": (window as never as { __ATELIER_TOKEN__?: string }).__ATELIER_TOKEN__ ?? "",
    },
    body: JSON.stringify(serialize()),
  })
    .catch(() => {}) // dev 面不可达绝不影响应用本身
    .finally(() => {
      pushing = false;
      if (queued) {
        queued = false;
        window.setTimeout(push, 300);
      }
    });
}

/** 页面侧命令执行器：dev 面经 SSE 下发 {op,args}，这里调 runtime 并 ack 回执 */
async function execCommand(c: { id: string; op: string; args?: Record<string, unknown> }): Promise<void> {
  const payload: { id: string; ok: boolean; result?: unknown; error?: string } = { id: c.id, ok: true };
  try {
    switch (c.op) {
      case "checkpoint.list":
        payload.result = store.list();
        break;
      case "checkpoint.rollback":
        payload.result = store.rollback();
        break;
      case "state.time_travel": {
        const id = String((c.args as { id?: string })?.id ?? "");
        if (!store.timeTravel(id)) throw new Error(`ATR-404-like: no such checkpoint "${id}" (see timeline)`);
        payload.result = { traveledTo: id };
        break;
      }
      default:
        payload.ok = false;
        payload.error = `ATR-4xx-dev: unknown downlink op "${c.op}"`;
    }
  } catch (e) {
    payload.ok = false;
    payload.error = e instanceof Error ? e.message : String(e);
  }
  await fetch("/__atelier/bridge/ack", {
    method: "POST",
    headers: { "content-type": "application/json", "x-atelier-token": (window as never as { __ATELIER_TOKEN__: string }).__ATELIER_TOKEN__ ?? "" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

/** main.ts 在挂载完成后调用一次：建立哨兵依赖做初次上报，并订阅下行命令流 */
export function installStateBridge(): void {
  if (typeof window === "undefined") return;
  // 哨兵效应：读取全部 $state 登记 deps；任一变更 → flush 重跑 → 节流跟推
  $effect(() => {
    for (const s of store._signals) void s.get();
    push();
  });
  // 下行命令（P0-1）：EventSource 无法自定义 header，token 由 transformIndexHtml 注入走 query
  const token = (window as never as { __ATELIER_TOKEN__?: string }).__ATELIER_TOKEN__ ?? "";
  const es = new EventSource(`/__atelier/bridge/commands?token=${encodeURIComponent(token)}`);
  es.onmessage = (ev) => {
    try {
      void execCommand(JSON.parse(ev.data));
    } catch { /* malformed command line — ignore */ }
  };
}
