/**
 * Atelier prototype — 信号内核（决策 2 雏形）
 * 语义：显式信号 + 依赖追踪 + 微任务批处理调度。
 * 模板表达式读取信号时自动登记依赖（track）；信号写入后批处理通知（flush 于 microtask）。
 * 完整版差异：依赖图/派生值由编译器从调用图改写为静态图（本原型为运行时追踪）。
 */

export type Signal<T = unknown> = {
  value: T;
  readonly get: () => T;
  set: (v: T) => void;
  /** @internal 订阅者（flush 时被调用） */
  _subs: Set<() => void>;
};

let tracking: Set<Signal> | null = null; // 当前求值上下文（effect/表达式求值期间）
const pending = new Set<() => void>(); // 微任务批处理队列
let flushing = false;

function scheduleFlush(): void {
  if (flushing) return;
  queueMicrotask(() => {
    flushing = true;
    const fns = [...pending];
    pending.clear();
    for (const fn of fns) {
      try {
        fn();
      } catch (e) {
        // P2-1 调度健壮性：单个订阅失败不得中断同批其他订阅（错误同时暴露给工具面）
        (globalThis as { __ATELIER_LAST_ERROR__?: unknown }).__ATELIER_LAST_ERROR__ = e;
        console.error("[atelier] effect error:", e);
      }
    }
    flushing = false;
    if (pending.size > 0) scheduleFlush();
  });
}

function track(sig: Signal): void {
  tracking?.add(sig);
}

function notify(sig: Signal): void {
  for (const fn of sig._subs) pending.add(fn);
  scheduleFlush();
}

function withTrack<R>(fn: () => R): { result: R; deps: Set<Signal> } {
  const deps = new Set<Signal>();
  const prev = tracking;
  tracking = deps;
  try {
    return { result: fn(), deps };
  } finally {
    tracking = prev;
  }
}

export function $state<T>(init: T): Signal<T> {
  let v = init;
  const sig: Signal<T> = {
    _subs: new Set(),
    get value() {
      track(sig as Signal);
      return v;
    },
    set value(nv: T) {
      if (Object.is(nv, v)) return;
      v = nv;
      notify(sig as Signal);
    },
    get: () => v,
    set: (nv: T) => {
      sig.value = nv;
    },
  };
  store._signals.add(sig);
  return sig;
}

export function $derived<T>(fn: () => T): Signal<T> {
  let cached!: T;
  let dirty = true;
  const subs = new Set<() => void>();
  const upSubs = new Map<Signal, () => void>();

  const invalidate = () => {
    dirty = true;
    for (const f of subs) pending.add(f);
    scheduleFlush();
  };

  const compute = (): T => {
    if (!dirty) return cached;
    for (const [s, u] of upSubs) s._subs.delete(u);
    upSubs.clear();
    dirty = false;
    const { result, deps } = withTrack(fn);
    cached = result;
    for (const s of deps) {
      if (!upSubs.has(s)) {
        const u = () => invalidate();
        upSubs.set(s, u);
        s._subs.add(u);
      }
    }
    return cached;
  };

  const sig: Signal<T> = {
    _subs: subs,
    get value() {
      track(sig as Signal);
      return compute();
    },
    get: () => sig.value,
    set: () => {
      throw new Error("ATR-305: 派生信号只读（$derived 由依赖计算）");
    },
  };
  // 派生信号不进入事务快照（其值由上游 $state 推导，恢复上游后自动重算）
  return sig;
}

export function $effect(fn: () => void): () => void {
  let deps = new Set<Signal>();
  let alive = true;

  const run = () => {
    if (!alive) return;
    for (const s of deps) s._subs.delete(run);
    deps = new Set<Signal>();
    const prev = tracking;
    tracking = deps;
    try {
      fn();
    } finally {
      tracking = prev;
    }
    for (const s of deps) s._subs.add(run);
  };

  run();
  return () => {
    alive = false;
    for (const s of deps) s._subs.delete(run);
  };
}

/**
 * 事务层最小实现（决策 5 雏形）：注册信号的全量快照 checkpoint。
 * 完整版：增量 patch 事件日志 + 命名合并 + 依赖图可查询（本原型为全量快照）。
 */
export const store = {
  _signals: new Set<Signal>(),
  _checkpoints: [] as { id: string; name: string; at: number; snap: Map<Signal, unknown> }[],
  _seq: 0,

  commit(name: string): string {
    const id = `cp-${++this._seq}`;
    const snap = new Map<Signal, unknown>();
    for (const s of this._signals) snap.set(s, s.value);
    this._checkpoints.push({ id, name, at: Date.now(), snap });
    return id;
  },
  /** 回退到最近一个 checkpoint 并移除它（对应"上一命名 checkpoint"语义） */
  rollback(): string | null {
    const cp = this._checkpoints.pop();
    if (!cp) return null;
    this._restore(cp.snap);
    return cp.id;
  },
  timeTravel(id: string): boolean {
    const idx = this._checkpoints.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    this._restore(this._checkpoints[idx].snap);
    return true;
  },
  _restore(snap: Map<Signal, unknown>) {
    for (const [s, v] of snap) s.set(v as never);
  },
  list(): { id: string; name: string; at: number }[] {
    return this._checkpoints.map((c) => ({ id: c.id, name: c.name, at: c.at }));
  },
};
