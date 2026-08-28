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
