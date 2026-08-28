/**
 * Atelier prototype — 信号内核（决策 2，v0.2 订阅模型重构）
 *
 * 语义：显式信号 + 运行时依赖追踪 + 微任务批处理调度。
 *
 * v0.2 订阅模型（由 vitest staleness-repro 驱动的修正）：
 *   每个 Subscription 携带 batched 标志，由统一的 deliver() 分发：
 *     · batched=true  （$effect）→ run 入微任务队列（同 tick 多写去重、跨组件稳定次序）
 *     · batched=false （$derived 失效）→ 同步执行
 *   于是「上游写入后、微任务前直读 derived」必得新值（对齐 Solid/Vue computed
 *   同步失效语义）；真正的 DOM/effect 重跑仍享受批处理。
 *
 * 完整版差异：依赖图由编译器静态化（本原型为运行时追踪）。
 */

export type Subscription = { run: () => void; batched?: boolean };

export type Signal<T = unknown> = {
  value: T;
  readonly get: () => T;
  set: (v: T) => void;
  /** @internal 订阅者集合 */
  _subs: Set<Subscription>;
};

let tracking: Set<Signal> | null = null;
const pending = new Set<() => void>();
let flushing = false;

/** 统一分发：批量订阅入队延迟执行；失效类订阅立即同步执行 */
function deliver(sub: Subscription): void {
  if (sub.batched) pending.add(sub.run);
  else sub.run();
}

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
        // P2-1 调度健壮性：单个订阅失败不得中断同批其他订阅
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
  const subs = [...sig._subs];
  for (const sub of subs) deliver(sub);
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
  const subs = new Set<Subscription>(); // 下游订阅者（与 sig._subs 同一引用）

  /** 上游变化到来时：同步标脏一次，并把失效沿下游按各自策略继续分发 */
  function onUpstreamChange(): void {
    if (dirty) return;
    dirty = true;
    const out = [...subs];
    for (const sub of out) deliver(sub);
    scheduleFlush();
  }

  const compute = (): T => {
    if (!dirty) return cached;
    for (const [s, e] of upSubs) s._subs.delete(e);
    upSubs.clear();
    dirty = false;
    const { result, deps } = withTrack(fn);
    cached = result;
    for (const s of deps) {
      const entry: Subscription = { batched: false, run: onUpstreamChange };
      upSubs.set(s, entry);
      s._subs.add(entry);
    }
    return cached;
  };

  const upSubs = new Map<Signal, Subscription>();

  const sig: Signal<T> = {
    _subs: subs,
    get value() {
      track(sig as Signal);
      return compute();
    },
    set value(_: T) {
      throw new Error("ATR-305: 派生信号只读（$derived 由依赖计算）");
    },
    get: () => sig.value,
    set: () => {
      throw new Error("ATR-305: 派生信号只读（$derived 由依赖计算）");
    },
  };
  return sig;
}

export function $effect(fn: () => void): () => void {
  let deps = new Set<Signal>();
  let alive = true;

  const sub: Subscription = {
    batched: true,
    run: () => {
      if (!alive) return;
      for (const d of deps) d._subs.delete(sub);
      deps = new Set<Signal>();
      const prev = tracking;
      tracking = deps;
      try {
        fn();
      } finally {
        tracking = prev;
      }
      for (const s of deps) s._subs.add(sub);
    },
  };

  sub.run();
  return () => {
    alive = false;
    for (const d of deps) d._subs.delete(sub);
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
