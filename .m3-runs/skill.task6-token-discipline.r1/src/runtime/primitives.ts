/**
 * Atelier prototype — 三态原语（决策 5 雏形）。
 * streamValue：流式值（取代手写 setInterval 打字机，决策 9 语义）。
 * optimisticList：乐观更新 + 自动回滚（pending → committed / revert）。
 */
import { $state } from "./core.ts";

export type StreamValue<T> = {
  values: T[];
  value: T | undefined;
  done: boolean;
  push(v: T): void;
  finish(): void;
};

export function streamValue<T>(): StreamValue<T> {
  const list = $state<T[]>([]);
  const fin = $state(false);
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
    push(v: T) {
      list.value = [...list.value, v];
    },
    finish() {
      fin.value = true;
    },
  };
}

export type OptimisticItem<T> = { it: T; status: "pending" | "committed" };

export function optimisticList<T extends { id: string }>() {
  const items = $state<OptimisticItem<T>[]>([]);
  const rollbacked = $state<string[]>([]);
  return {
    get values() {
      return items.value;
    },
    get rollbacked() {
      return rollbacked.value;
    },
    optimisticAdd(it: T) {
      items.value = [...items.value, { it, status: "pending" }];
    },
    commit(id: string) {
      items.value = items.value.map((x) => (x.it.id === id ? { ...x, status: "committed" as const } : x));
    },
    revert(id: string) {
      if (items.value.some((x) => x.it.id === id)) {
        items.value = items.value.filter((x) => x.it.id !== id);
        rollbacked.value = [...rollbacked.value, id];
      }
    },
  };
}
