import { describe, it, expect } from "vitest";
import { $state, $derived, $effect, store } from "../runtime/core";

const settled = () => new Promise<void>((r) => setTimeout(r, 0));

describe("signal core", () => {
  it("$state: initial read / write / read-through", () => {
    const s = $state(1);
    expect(s.value).toBe(1);
    s.value = 42;
    expect(s.value).toBe(42);
    expect(s.get()).toBe(42);
  });

  it("batch flush settles on microtask and dedupes", async () => {
    const a = $state(0);
    let runs = 0;
    $effect(() => {
      void a.value;
      runs++;
    });
    await settled();
    expect(runs).toBe(1);
    a.value = 1;
    a.value = 2; // same tick batch → single flush per订阅 (both writes notify before microtask)
    a.value = 3;
    await settled();
    expect(runs).toBe(2);
  });

  it("$derived recomputes lazily and is read-only (ATR-305)", () => {
    const base = $state(2);
    const dbl = $derived(() => base.value * 2);
    expect(dbl.value).toBe(4);
    base.value = 5;
    expect(dbl.value).toBe(10);
    expect(() => {
      (dbl as unknown as { value: number }).value = 99;
    }).toThrowError(/ATR-305/);
  });

  it("$derived staleness repro (sync-read after upstream write)", async () => {
    const b = $state(2);
    const d = $derived(() => b.value * 3);
    expect(d.value).toBe(6);
    b.value = 7;
    console.log("immediate sync read:", d.value, "(stale if not 21)");
    await settled();
    console.log("after settled:", d.value);
    expect(d.value).toBe(21);
  });

  it("$effect cleanup stops tracking", async () => {
    const n = $state(0);
    let seen = 0;
    const stop = $effect(() => {
      seen = n.value;
    });
    await settled();
    stop();
    n.value = 100;
    await settled();
    expect(seen).toBe(0);
  });
});

describe("transaction store", () => {
  function freshScope() {
    // signals register themselves into the singleton store; use unique values per test
    return { a: $state(1), b: $state("x") };
  }

  it("commit snapshots; rollback restores and pops", () => {
    const a = $state(1);
    store.commit("base");
    a.value = 999;
    const r = store.rollback();
    expect(a.value).toBe(1);
    expect(typeof r).toBe("string");
  });

  it("timeTravel keeps history intact", () => {
    const v = $state("v1");
    store.commit("t1");
    v.value = "v2";
    store.commit("t2");
    const list = store.list();
    const t1 = list[list.length - 2];
    const ok = store.timeTravel(t1.id);
    expect(ok).toBe(true);
    expect(v.value).toBe("v1");
    expect(store.list().length).toBe(list.length); // history preserved
  });

  it("list exposes the human-visible timeline", () => {
    const rows = store.list();
    for (const r of rows) {
      expect(r.id).toMatch(/^cp-\d+$/);
      expect(typeof r.name).toBe("string");
      expect(typeof r.at).toBe("number");
    }
  });
});

describe("transaction store v0.3 (decision 5 — merge / journal / graph)", () => {
  it("named merge: same-name commit at stack top is idempotent — rollback undoes the whole round", () => {
    const a = $state("m0");
    store.commit("merge-round");
    a.value = "m1";
    const again = store.commit("merge-round"); // 同名合并 → 同 id，不新增条目
    const rows = store.list().filter((r) => r.name === "merge-round");
    expect(rows.length).toBe(1);
    expect(again).toBe(rows[0].id);
    a.value = "m2";
    store.rollback(); // 轮级回滚：直接回到本轮 commit 之前
    expect(a.value).toBe("m0");
  });

  it("named merge only applies at stack top — interleaved names create new checkpoints", () => {
    const a = $state("i0");
    store.commit("roundA");
    a.value = "i1";
    store.commit("roundB");
    const before = store.list().length;
    store.commit("roundA"); // roundA 不在栈顶 → 新 checkpoint，不合并
    expect(store.list().length).toBe(before + 1);
  });

  it("journal records every mutation (from/to/sig), log() reads recent entries", () => {
    const a = $state("j0");
    const before = store.log().length;
    a.value = "j1";
    a.value = "j2";
    const log = store.log();
    expect(log.length).toBe(before + 2);
    expect(log.at(-1)!.from).toBe("j1");
    expect(log.at(-1)!.to).toBe("j2");
    expect(log.at(-1)!.sig).toBe(a);
  });

  it("journal can be disabled and is bounded by journalLimit", () => {
    const prevLimit = store.journalLimit;
    store.journalLimit = 4;
    const a = $state("k0");
    for (let i = 1; i <= 7; i++) a.value = `k${i}`;
    expect(store.log().length).toBe(4);
    expect(store.log().at(-1)!.to).toBe("k7"); // 最旧的被挤出
    store.journal = false;
    a.value = "k-off";
    expect(store.log().some((e) => e.to === "k-off")).toBe(false);
    store.journal = true;
    store.journalLimit = prevLimit;
  });

  it("graph: live effects are queryable with dep ids; dispose removes the entry", () => {
    const a = $state("g0");
    const stop = $effect(() => {
      void a.value;
    });
    const g = store.graph();
    const eff = g.effects.at(-1)!;
    expect(eff.deps.length).toBeGreaterThanOrEqual(1); // 读过的信号成为依赖边
    stop();
    expect(store.graph().effects.some((e) => e.id === eff.id)).toBe(false);
  });

  it("graph: derived signals appear in deps with kind marker (not in _signals)", () => {
    const base = $state("d-base");
    const dbl = $derived(() => base.value.length);
    const stop = $effect(() => {
      void dbl.value;
    });
    const g = store.graph();
    const eff = g.effects.at(-1)!;
    const derivedIds = eff.deps.filter((id) => !g.signals.some((s) => s.id === id));
    expect(derivedIds.length).toBeGreaterThanOrEqual(1); // derived 不在 _signals，但作为依赖边出现
    stop();
  });
});
