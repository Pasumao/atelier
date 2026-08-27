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
    headers: { "content-type": "application/json" },
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

/** main.ts 在挂载完成后调用一次：建立哨兵依赖并做初次上报 */
export function installStateBridge(): void {
  if (typeof window === "undefined") return;
  // 哨兵效应：读取全部 $state 登记 deps；任一变更 → flush 重跑 → 节流跟推
  $effect(() => {
    for (const s of store._signals) void s.get();
    push();
  });
}
