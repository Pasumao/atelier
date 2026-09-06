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
 *
 * v0.3 事务层（决策 5 完整版第一期）：命名合并（同名栈顶幂等锚定 = 轮级回滚）、
 *   增量 patch 事件日志（journal，有界环形可关）、依赖图可查询（store.graph()，
 *   effect dispose 即注销、信号 id 走 WeakMap，查询不驻留对象）。
 */

export type Subscription = { run: () => void; batched?: boolean };

export type Signal<T = unknown> = {
  value: T;
  readonly get: () => T;
  set: (v: T) => void;
  /** @internal 订阅者集合 */
  _subs: Set<Subscription>;
  /** @internal 依赖图节点种类（store.graph() 查询用） */
  _kind: "state" | "derived";
  /** 仅 $derived：退订上游并置脏（泄漏修复——死派生不再驻留上游 _subs；再读时重算重订） */
  dispose?: () => void;
};

let tracking: Set<Signal> | null = null;
const pending = new Set<() => void>();
let flushing = false;

/** v0.3 依赖图登记：effect 记录（dispose 时移除，不驻留死节点）+ 信号稳定 id（WeakMap，不阻止回收） */
const __effects = new Set<{ id: number; deps: Set<Signal> }>();
let __effectSeq = 0;
const __sigIds = new WeakMap<Signal, number>();
let __sigSeq = 0;

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

/** P0-5 HMR：创建沉降。mount 期间 runtime 置入收集器，把新建 $state 归属到挂载实例；
 *  栈式恢复（嵌套 mount 各自接管），平时为 null 零开销。 */
export const __creationSink: { fn: ((s: Signal<unknown>) => void) | null } = { fn: null };

/** P1-4 HMR：effect 创建沉降。mount 期间 runtime 置入收集器，把新建 effect 的 dispose 归属到
 *  挂载实例，供热交换时逐个注销（关闭"旧 effects 不 dispose"的 dev-only 有界泄漏）。
 *  栈式恢复同 __creationSink；平时为 null 零开销。 */
export const __effectSink: { fn: ((dispose: () => void) => void) | null } = { fn: null };

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

/** @internal 测试/工具钩子：在显式追踪上下文里执行 fn，返回结果与追踪到的信号集合（F-2 静态/动态依赖对拍用） */
export function __withTracking<R>(fn: () => R): { result: R; deps: Set<Signal> } {
  return withTrack(fn);
}

export function $state<T>(init: T, options?: { equals?: (a: T, b: T) => boolean }): Signal<T> {
  // P2-2⑤：TC39 Signal.State（signal-polyfill）语义对齐出口——`equals` 选项决定写入是否视为变更
  // （等值写入 = no-op，与 polyfill 的 ignores-write 语义一致）。诚实边界：对齐仅限 State 的
  // equals；Signal.Computed/Watcher/notEqual 等内核暂无对应物（$derived/$effect 为自有调度语义）。
  const eq = options?.equals ?? Object.is;
  let v = init;
  const sig: Signal<T> = {
    _subs: new Set(),
    _kind: "state",
    get value() {
      track(sig as Signal);
      return v;
    },
    set value(nv: T) {
      if (eq(nv, v)) return;
      const prev = v;
      v = nv;
      store.journalPush(sig as Signal, prev, nv); // v0.3 增量事件日志：每变更自动入账
      notify(sig as Signal);
    },
    get: () => v,
    set: (nv: T) => {
      sig.value = nv;
    },
  };
  store._signals.add(sig);
  if (__creationSink.fn) __creationSink.fn(sig as Signal<unknown>);
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
    let result: T;
    let deps: Set<Signal>;
    try {
      ({ result, deps } = withTrack(fn));
    } catch (e) {
      // 缓存毒化修复（红检见 tests/core.test.ts）：计算失败保持脏——下次读取重算并重抛，
      // 绝不把「上一次成功值」当新值静默返回（修复前 dirty 已置 false，抛错后永远返回旧缓存）。
      dirty = true;
      throw e;
    }
    dirty = false;
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
    _kind: "derived",
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
  // 慢性泄漏修复：派生信号的上游订阅此前无任何注销途径（组件拆卸后死 derived 的 upSubs
  // 永远挂在上游 _subs 上）。dispose = 退订上游 + 置脏（再读时重算重订，与 $state 被
  // dispose 后仍可读的语义一致）。同时经 __effectSink 归属 mount 实例，随 disposeInstance 注销。
  const disposeDerived = () => {
    for (const [s, e] of upSubs) s._subs.delete(e);
    upSubs.clear();
    dirty = true;
  };
  if (__effectSink.fn) __effectSink.fn(disposeDerived);
  return Object.assign(sig, { dispose: disposeDerived });
}

export function $effect(fn: () => void): () => void {
  const record = { id: ++__effectSeq, deps: new Set<Signal>() };
  __effects.add(record);
  let alive = true;

  const sub: Subscription = {
    batched: true,
    run: () => {
      if (!alive) return;
      for (const d of record.deps) d._subs.delete(sub);
      record.deps = new Set<Signal>();
      const prev = tracking;
      tracking = record.deps;
      try {
        fn();
      } finally {
        tracking = prev;
      }
      for (const s of record.deps) s._subs.add(sub);
    },
  };

  sub.run();
  const dispose = () => {
    alive = false;
    for (const d of record.deps) d._subs.delete(sub);
    __effects.delete(record); // v0.3：注销依赖图登记，不驻留死节点
  };
  if (__effectSink.fn) __effectSink.fn(dispose); // P1-4：mount 期间创建的 effect 归属实例，HMR 交换时逐个注销
  return dispose;
}

/**
 * F-2 二期（决策 3）：静态预订阅 effect——依赖在创建时由调用方精确给出，运行期不再追踪。
 * 契约（调用方必须保证）：运行时追踪集 ⊆ deps。⊆ 即语义等价：deps 中未被实际读取的信号
 * 只是良性超订阅（多触发一次重算，输出不变）。fn 全程在**无追踪上下文**求值——
 * 首跑可能嵌套在外层 effect 的追踪期（分支重建），置 null 保证不污染外层依赖。
 * 与 $effect 同款 dispose/HMR sink 语义（__effectSink 归属实例）。
 */
export function $effectStatic(fn: () => void, deps: Iterable<Signal>): () => void {
  const record = { id: ++__effectSeq, deps: new Set(deps) };
  __effects.add(record);
  let alive = true;
  const sub: Subscription = {
    batched: true,
    run: () => {
      if (!alive) return;
      const prev = tracking;
      tracking = null;
      try {
        fn();
      } finally {
        tracking = prev;
      }
    },
  };
  for (const d of record.deps) d._subs.add(sub);
  sub.run();
  const dispose = () => {
    alive = false;
    for (const d of record.deps) d._subs.delete(sub);
    __effects.delete(record);
  };
  if (__effectSink.fn) __effectSink.fn(dispose);
  return dispose;
}

/**
 * 事务层 v0.3（决策 5）：全量快照为正确性锚点 + 增量 patch 事件日志 + 命名合并 + 依赖图可查询。
 *
 * - **命名合并**：同名 commit 且位于栈顶 → 幂等锚定（保留**最早**快照作整轮回滚点）。
 *   "AI 一轮 N 次变更 = 1 个可命名 checkpoint，rollback 粒度对人类是一次操作"——
 *   也就是说 round 内第二次 commit 不新增条目，rollback() 直接回到本轮开始前。
 * - **增量事件日志**：每个 $state 写入自动入账（from/to/sig），有界环形（journalLimit，默认 500），
 *   `store.journal = false` 可整体关闭。日志只追加、不受 rollback/timeTravel 改写（审计语义）。
 * - **依赖图**：`store.graph()` 即席查询 states（含 kind）与 effects 的依赖边；
 *   effect dispose 即从登记移除，信号 id 走 WeakMap——查询不驻留对象。
 *
 * 快照语义（重要）：commit 按引用记录信号值，rollback 经 Object.is 判等跳过未变信号。
 * 原地修改数组/对象（如 items.value.push(x)）的内容 rollback 恢复不了——必须整体替换引用
 * （items.value = [...items.value, x]）。该约束由应用模板守卫测试 tests/state-discipline.test.ts 静态拦截。
 */
export const store = {
  _signals: new Set<Signal>(),
  _checkpoints: [] as { id: string; name: string; at: number; snap: Map<Signal, unknown> }[],
  _seq: 0,
  /** v0.3 事件日志开关（默认开，写入路径多一次入账调用，热路径可关） */
  journal: true,
  journalLimit: 500,
  _journal: [] as { seq: number; at: number; sig: Signal; from: unknown; to: unknown }[],
  _journalSeq: 0,

  journalPush(sig: Signal, from: unknown, to: unknown): void {
    if (!this.journal) return;
    while (this._journal.length >= this.journalLimit) this._journal.shift(); // 裁到限额内（含 limit 调小的情形）
    this._journal.push({ seq: ++this._journalSeq, at: Date.now(), sig, from, to });
  },

  commit(name: string): string {
    // v0.3 命名合并：同名人栈顶 → 幂等锚定，保留最早快照 = 整轮回滚点
    const top = this._checkpoints[this._checkpoints.length - 1];
    if (top && top.name === name) return top.id;
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
  /** v0.3 最近 n 条变更事件（时间升序；sig 为信号引用，可定位到具体状态） */
  log(n = 50): { seq: number; at: number; sig: Signal; from: unknown; to: unknown }[] {
    return this._journal.slice(-n);
  },
  /** v0.3 依赖图即席查询：全部 $state（kind 标记）+ 每个存活 effect 的依赖边。
   * 默认 id = WeakMap 稳定键（跨调用可 diff）；可注入 keyOf 换键——dev 桥用 sig-N
   * 与 state.snapshot 的 signals 键对齐（P2-1 接线）。 */
  graph(keyOf?: (s: Signal) => string | number): {
    signals: { id: string | number; kind: "state" | "derived" }[];
    effects: { id: number; deps: (string | number)[] }[];
  } {
    const idOf = (s: Signal): number => {
      let id = __sigIds.get(s);
      if (id === undefined) {
        id = ++__sigSeq;
        __sigIds.set(s, id);
      }
      return id;
    };
    const key = keyOf ?? idOf;
    return {
      signals: [...this._signals].map((s) => ({ id: key(s), kind: s._kind })),
      effects: [...__effects].map((e) => ({ id: e.id, deps: [...e.deps].map(key) })),
    };
  },
};
