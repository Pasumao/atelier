/**
 * bridge.test.ts — P2-1（F-1 收尾）接线验收：graph/journal 的 JSON 视图。
 * 判据：①JSON.stringify 无循环引用（Signal 引用不得漏进载荷）；②键空间与 snapshot.signals
 * 的 sig-N 对齐；③journal 按时间升序、sig 键可解析、limit 裁剪生效。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $effect, $state } from "../runtime/core.ts";
import { graphJson, journalJson } from "../runtime/bridge.ts";

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

describe("bridge graph/journal JSON views (P2-1)", () => {
  it("graphJson：sig-N 键 + kind + effect 依赖边，整体 JSON 可序列化", async () => {
    const n = $state(1);
    const flag = $state(true);
    let effectRan = 0;
    $effect(() => {
      void n.value;
      void flag.value;
      effectRan++;
    });
    await flush();
    const g = graphJson();
    const keys = g.signals.map((s) => s.key);
    expect(keys).toContain("sig-0");
    expect(g.signals.every((s) => s.kind === "state" || s.kind === "derived")).toBe(true);
    expect(effectRan).toBeGreaterThan(0);
    // effect 边：引用的键都在 signals 键空间内（sig-N 对齐，无裸 WeakMap 数字混入）
    const keySet = new Set(keys);
    for (const e of g.effects) {
      for (const d of e.deps) expect(keySet.has(d), `edge ${d} not in signal keys`).toBe(true);
    }
    expect(() => JSON.stringify(g)).not.toThrow();
  });

  it("journalJson：sig 键可解析、from/to 为 JSON 安全值、limit 裁剪", async () => {
    const a = $state("a0");
    const b = $state("b0");
    a.value = "a1";
    b.value = "b1";
    a.value = "a2";
    await flush();
    const all = journalJson(500);
    expect(all.length).toBeGreaterThanOrEqual(3);
    // 升序
    for (let i = 1; i < all.length; i++) expect(all[i].seq).toBeGreaterThan(all[i - 1].seq);
    // sig 键在键空间内
    const keySet = new Set(graphJson().signals.map((s) => s.key));
    for (const e of all) {
      expect(keySet.has(e.sig), `${e.sig} in keys`).toBe(true);
      expect(() => JSON.stringify(e)).not.toThrow();
    }
    // 最近一条是 a 的 a2
    expect(all.at(-1)!.to).toBe("a2");
    // limit 裁剪：只取最近 2 条
    expect(journalJson(2)).toHaveLength(2);
  });

  it("journal 与 graph 在信号集合变化后仍对齐（新信号 → 键顺延）", async () => {
    const before = graphJson().signals.length;
    const fresh = $state(9);
    fresh.value = 10;
    await flush();
    const g = graphJson();
    expect(g.signals.length).toBe(before + 1);
    const j = journalJson(10);
    expect(j.at(-1)!.to).toBe(10);
    const keySet = new Set(g.signals.map((s) => s.key));
    expect(keySet.has(j.at(-1)!.sig)).toBe(true);
  });
});
