/**
 * Atelier prototype — 三态原语（决策 5 雏形）。
 * streamValue：流式值（取代手写 setInterval 打字机，决策 9 语义）。
 * optimisticList：乐观更新 + 自动回滚（pending → committed / revert）。
 * FS-DESIGN §8.3（错误面贯通）：streamValue 补 error 语义位（失败不断流）；
 * optimisticList 的 revert 可携带触发它的 AtrError（供 toast 展示 fix）。
 */
import { $state } from "./core.ts";

/**
 * AtrError 结构最小形态（§8.3）——与 contract.ts / template.ts 的严格四段式 AtrError
 * 同物异名：code/fix 放宽为可选、context 放宽为 unknown。刻意不在本文件 import 严格
 * 类型（零依赖红线保持：本文件仍只 import core.ts，类型是纯本地形状）：live error 帧
 * 与 catch 异常到达 UI 时可能是残缺帧（往往只有 message），把契约校验面的必填性强加给
 * 流错误面会把残缺错误挡在类型外，与「错误即导航」相悖；严格 AtrError 结构上可赋给本
 * 形态（子类型方向单向畅通），网络侧残缺帧同样可赋。
 */
export type StreamError = { code?: string; message: string; context?: unknown; fix?: string };

export type StreamValue<T> = {
  values: T[];
  value: T | undefined;
  done: boolean;
  /** §8.3 错误语义位：初始 null；错误帧到达覆盖旧值（新帧胜出）；push/finish 均不清它——失败不断流；可赋 null 显式复位 */
  error: StreamError | null;
  push(v: T): void;
  finish(): void;
};

export function streamValue<T>(): StreamValue<T> {
  const list = $state<T[]>([]);
  const fin = $state(false);
  const err = $state<StreamError | null>(null);
  return {
    get values() {
      return list.value;
    },
    get value() {
      const a = list.value;
      return a.length > 0 ? a[a.length - 1] : undefined;
    },
    get done() {
      return fin.value;
    },
    get error() {
      return err.value;
    },
    set error(e: StreamError | null) {
      err.value = e; // 赋值通道（§8.3）：新帧覆盖旧帧；不触碰 list/fin——失败不断流
    },
    push(v: T) {
      list.value = [...list.value, v];
    },
    finish() {
      fin.value = true;
    },
  };
}

export type OptimisticItem<T> = { it: T; status: "pending" | "committed" };

/** §8.3 revert 错误台账条目：仅 revert(id, err) 显式携带 err 时记入（err 缺省不记） */
export type RevertErrorEntry = { id: string; error: StreamError };

export function optimisticList<T extends { id: string }>() {
  const items = $state<OptimisticItem<T>[]>([]);
  const rollbacked = $state<string[]>([]);
  const revertErrors = $state<RevertErrorEntry[]>([]);
  return {
    get values() {
      return items.value;
    },
    get rollbacked() {
      return rollbacked.value;
    },
    /**
     * §8.3 错误台账（新增 getter，既有 rollbacked 形状不破）：条目数组形态 = 追加序
     * 与 rollbacked 完全同构（同门槛记入、同替换式写入语义）；查某 id 的错误即
     * revertErrors.find((e) => e.id === id)。诚实例外：无 err 的 revert 只进
     * rollbacked 不进台账，故两数组长度不必相等——revertErrors 只含真实带错误的回滚。
     */
    get revertErrors() {
      return revertErrors.value;
    },
    optimisticAdd(it: T) {
      items.value = [...items.value, { it, status: "pending" }];
    },
    commit(id: string) {
      items.value = items.value.map((x) => (x.it.id === id ? { ...x, status: "committed" as const } : x));
    },
    revert(id: string, err?: StreamError) {
      if (items.value.some((x) => x.it.id === id)) {
        items.value = items.value.filter((x) => x.it.id !== id);
        rollbacked.value = [...rollbacked.value, id];
        if (err) revertErrors.value = [...revertErrors.value, { id, error: err }]; // §8.3：供 toast 展示 fix
      }
    },
  };
}
