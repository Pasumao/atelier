/**
 * r1b-runtime.test.ts — R1 收口批 B 支（runtime/codegen 同源）行为钉。
 * 覆盖（2026-09-30 全仓架构评审 §3 P1 #15/#9 + §4.4 R-D4 两件，架构师裁定归 B 支）：
 *   P1 #15 recordRuntimeError 裸 `window`——非浏览器环境错误记录器自身抛 ReferenceError 吞掉
 *          原错误；且与 core.ts 调度兜底的 `__ATELIER_LAST_ERROR__` 双写点宿主不一致。
 *   P1 #9  effect 泄漏两处：① mount 中途抛错半成品 effects 随栈帧丢失；② 实例析构只回收
 *          inst.effects，运行期换支/加行 effects 挂 branchCleanup/rowCleanups 不随实例销毁
 *          （HMR swap 后当前分支 effects 仍向脱离节点写入）。修法 = node 级 cleanup 收集 +
 *          公开 unmount() + mount 失败路径回收，一次解决三症状。
 *   R-D4a  ATR-352：插值/属性值直接收到信号对象（忘写 .value 典型笔误）静默渲染信号内部
 *          字段 JSON——dev 一次性警示、prod 剥离（ATR-328 同款形态）；渲染语义逐字不变。
 *   R-D4b  ATR-353：keyed each 重复 key 静默折叠行（appendChild 移动语义）——dev 一次性
 *          警示、prod 剥离；折叠语义逐字不变；解释器/编译双路径同源。
 * 纪律：先红后绿（红检证据记入提交信息），禁止先写实现。
 */
import "./dom-shim.ts";
import { afterAll, describe, expect, it } from "vitest";
import { $state, store } from "../runtime/core.ts";
import { hmrRemountAll, mountComponent } from "../runtime/template.ts";
import * as tpl from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { compileFunction } from "../compiler/codegen.mjs";
import { registerCompiled } from "../runtime/template.ts";
import { attachToDocument, findByTag, makeContainer } from "./dom-shim.ts";

type AnyNode = any;

type Validate = (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown };
const okValidate = (() => ({ ok: true })) as unknown as Validate;

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

const defOf = (name: string, raw: string, scope: Record<string, unknown>): ComponentDef => ({
  name,
  render: () => ({ raw, scope }) as never,
});

function mountOnce(name: string, raw: string, scope: Record<string, unknown>): AnyNode {
  const container = makeContainer();
  mountComponent(defOf(name, raw, scope), {}, container, new Map() as ComponentRegistry, okValidate);
  return container;
}

const G = globalThis as unknown as Record<string, unknown>;
const setLast = (v: unknown): void => {
  G.__ATELIER_LAST_ERROR__ = v;
};
const getLast = (): { code?: string } | undefined =>
  G.__ATELIER_LAST_ERROR__ as { code?: string } | undefined;
const setProd = (v: boolean): void => {
  G.__ATELIER_PROD__ = v;
};
afterAll(() => {
  setProd(false);
  setLast(undefined);
});

/* ================= P1 #15：recordRuntimeError 裸 window ================= */

describe("P1 #15：非浏览器环境错误记录不吞错（recordRuntimeError globalThis 化）", () => {
  it("无 window 环境：渲染错误记录不抛 ReferenceError、原错误（ATR-301）不吞、写点 = globalThis", () => {
    const savedWindow = G.window;
    delete G.window;
    setLast(undefined);
    try {
      const def: ComponentDef = {
        name: "NoWindowErr",
        render: () => ({ raw: `<p>{broken.x +}</p>`, scope: {} }) as never,
      };
      const container = makeContainer();
      // 修复前：bindExpr catch → recordRuntimeError 裸引用 window → ReferenceError 穿透组件级
      // 错误边界第二次 record 再抛 → mountComponent 整体抛 ReferenceError（原错误被吞）
      expect(() => mountComponent(def, {}, container, new Map(), okValidate)).not.toThrow();
      // expr.ts 抛的是普通 Error（message 携带 ATR-301，无 code 字段）——按 message 断言原错误不吞
      const last = getLast() as { code?: string; message?: string } | undefined;
      expect(String(last?.message ?? last?.code ?? ""), "原错误 ATR-301 被记录（不吞错）").toContain("ATR-301");
      expect("__ATELIER_LAST_ERROR__" in G, "宿主对象统一为 globalThis（与 core.ts 调度兜底同源）").toBe(true);
    } finally {
      if (savedWindow !== undefined) G.window = savedWindow;
      setLast(undefined);
    }
  });
});

/* ================= P1 #9：effect 泄漏两处 + 公开 unmount() ================= */

describe("P1 #9①：mount 中途抛错——半成品 effect 已回收", () => {
  it("bindProp 求值失败使 mount 失败后，先前兄弟节点创建的插值 effect 已 dispose（订阅清零）", () => {
    const n = $state(5);
    const reg: ComponentRegistry = new Map();
    reg.set("Sub", { name: "Sub", render: () => ({ raw: `<i/>`, scope: {} }) as never });
    const def: ComponentDef = {
      name: "MountFailProbe",
      render: () => ({ raw: `<p>{n.value}</p><Sub bad={n.x +} />`, scope: { n } }) as never,
    };
    // dev：`n.x +` 在 bindProp 求值期抛 ATR-301 → mountComponent 组件级错误边界接住（不抛穿）。
    // 修复前：<p> 的 bindExpr effect 已同步订阅 n（首跑即订阅），随 collectedEffects 局部变量
    // 与栈帧一起丢失——上游 n._subs 永久 +1（泄漏）。
    mountComponent(def, {}, makeContainer(), reg, okValidate);
    expect(n._subs.size, "半成品 effect 已 dispose（上游订阅清零）").toBe(0);
  });
});

describe("P1 #9②：实例析构回收运行期分支/行级 cleanup", () => {
  it("HMR swap 后当前分支 effect 不再写脱离节点（修复前 branchCleanup 滞留 = 僵尸写入）", async () => {
    const show = $state(true);
    const msg = $state("v1");
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "BranchZombie",
      render: () => ({ raw: `{#if show.value}<b>{msg.value}</b>{:else}<i>-</i>{/if}`, scope: { show, msg } }) as never,
    };
    reg.set("BranchZombie", def);
    const container = attachToDocument(makeContainer());
    mountComponent(def, {}, container, reg, okValidate);
    await flush();
    const b = findByTag(container, "b")[0];
    expect(b.textContent).toBe("v1");
    show.value = false;
    await flush(); // 换支出空：旧分支 cleanup 正常跑（F-5 既有语义）
    show.value = true;
    await flush(); // 重进分支：重建的 effect 只挂 branchCleanup（flush 期 __effectSink 已复位，不进实例 effects）
    hmrRemountAll(); // 实例析构：disposeInstance
    await flush();
    expect(b.isConnected, "旧树已随交换摘除").toBe(false);
    msg.value = "leaked";
    await flush();
    expect(b.textContent, "析构后当前分支 effect 不再写脱离节点").toBe("v1");
  });

  it("HMR swap 后 keyed each 运行期新建行的 effect 不再写脱离行（rowCleanups 随实例析构）", async () => {
    const items = $state([{ id: "a", name: "A" }]);
    const extra = $state("x");
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "RowZombie",
      render: () =>
        ({ raw: `{#each items.value as it by it.id}<i>{it.name}-{extra.value}</i>{/each}`, scope: { items, extra } }) as never,
    };
    reg.set("RowZombie", def);
    const container = attachToDocument(makeContainer());
    mountComponent(def, {}, container, reg, okValidate);
    await flush();
    items.value = [{ id: "c", name: "C" }]; // flush 期换行：旧行析构、新行 c 的 effect 只挂 rowCleanups
    await flush();
    const rowC = findByTag(container, "i")[0];
    expect(rowC.textContent).toBe("C-x");
    hmrRemountAll();
    await flush();
    expect(rowC.isConnected, "旧树已随交换摘除").toBe(false);
    extra.value = "y";
    await flush();
    expect(rowC.textContent, "析构后运行期行 effect 不再写脱离节点").toBe("C-x");
  });
});

describe("P1 #9③：unmount() 公开导出（SPA 卸载面）", () => {
  it("container 维度卸载：effects dispose + 摘树 + 信号注销；未命中返回 false（幂等）", async () => {
    expect(typeof tpl.unmount, "unmount 公开导出（修复前不存在 → 红）").toBe("function");
    let nRef!: ReturnType<typeof $state<number>>;
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "UnmountProbe",
      render: () => {
        const n = $state(9);
        nRef = n;
        return { raw: `<p>{n.value}</p>`, scope: { n } } as never;
      },
    };
    reg.set("UnmountProbe", def);
    const container = attachToDocument(makeContainer());
    mountComponent(def, {}, container, reg, okValidate);
    await flush();
    expect(findByTag(container, "p")[0], "实例树在位").toBeTruthy();
    const signalsBefore = store._signals.size;
    expect(tpl.unmount(container), "命中返回 true").toBe(true);
    expect(container.childNodes.length, "实例树已摘除").toBe(0);
    expect(nRef._subs.size, "实例 effects 已 dispose（订阅清零）").toBe(0);
    expect(store._signals.size, "实例信号已注销").toBeLessThan(signalsBefore);
    expect(tpl.unmount(container), "重复卸载幂等：未命中 false").toBe(false);
  });
});

/* ================= R-D4a：ATR-352 忘写 .value 静默渲染信号 JSON ================= */

describe("R-D4a：ATR-352 插值直接渲染信号对象（dev 一次性警示 / prod 剥离）", () => {
  it("dev：警示 ATR-352 一次性（同信号重渲不刷屏）；渲染语义逐字不变（仍 JSON）", async () => {
    setLast(undefined);
    const n = $state(7);
    const t = $state(0);
    const c = mountOnce("SigLeak", `<p>{n}|{t.value}</p>`, { n, t });
    await flush();
    expect(findByTag(c, "p")[0].textContent).toContain('"value":7'); // 语义逐字不变（不静默 ≠ 改语义）
    expect(getLast()?.code, "忘写 .value 的信号对象渲染 → ATR-352（修复前静默）").toBe("ATR-352");
    setLast(undefined);
    t.value = 1; // 触发 effect 重跑：同一信号对象再次 stringify
    await flush();
    expect(getLast()?.code, "一次性：同信号对象不刷屏").toBeUndefined();
  });

  it("不同信号各自警示一次；prod 剥离零警示", async () => {
    setLast(undefined);
    const a = $state(1);
    mountOnce("SigLeakA", `<p>{a}</p>`, { a });
    await flush();
    expect(getLast()?.code).toBe("ATR-352");
    setLast(undefined);
    setProd(true);
    try {
      const b = $state(2);
      const c = mountOnce("SigLeakProd", `<p>{b}</p>`, { b });
      await flush();
      expect(findByTag(c, "p")[0].textContent).toContain('"value":2');
      expect(getLast()?.code, "prod 剥离：不警示").toBeUndefined();
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });
});

/* ================= R-D4b：ATR-353 keyed each 重复 key 静默折叠行 ================= */

describe("R-D4b：ATR-353 keyed each 重复 key（dev 一次性警示 / prod 剥离 / 双路径同源）", () => {
  const DUP_RAW = `<div>{#each rows.value as r by r.id}<b>{r.name}</b>{/each}</div>`;

  it("解释器路径：重复 key 警示 ATR-353 一次性；折叠语义逐字不变", async () => {
    setLast(undefined);
    const rows = $state([{ id: "1", name: "A" }, { id: "1", name: "B" }, { id: "2", name: "C" }]);
    const c = mountOnce("DupKey", DUP_RAW, { rows });
    await flush();
    expect(findByTag(c, "b").length, "折叠语义逐字不变（警示不改渲染）").toBe(2);
    expect(getLast()?.code, "重复 key → ATR-353（修复前静默折叠）").toBe("ATR-353");
    setLast(undefined);
    rows.value = [...rows.value, { id: "1", name: "D" }]; // 重跑仍含重复 key
    await flush();
    expect(getLast()?.code, "一次性：同块不随重跑刷屏").toBeUndefined();
  });

  it("编译路径同样警示（rt 发射同源，修复前只有解释器警示）", async () => {
    setLast(undefined);
    const rows = $state([{ id: "1", name: "A" }, { id: "1", name: "B" }]);
    registerCompiled(compileFunction("DupKeyCompiled", DUP_RAW));
    const container = makeContainer();
    mountComponent(defOf("DupKeyCompiled", DUP_RAW, { rows }), {}, container, new Map(), okValidate);
    await flush();
    expect(findByTag(container, "b").length).toBe(1);
    expect(getLast()?.code, "编译路径 ATR-353 同源").toBe("ATR-353");
    setLast(undefined);
  });

  it("prod 剥离：零警示、折叠语义不变", async () => {
    setProd(true);
    setLast(undefined);
    try {
      const rows = $state([{ id: "1", name: "A" }, { id: "1", name: "B" }]);
      const c = mountOnce("DupKeyProd", DUP_RAW, { rows });
      await flush();
      expect(findByTag(c, "b").length).toBe(1);
      expect(getLast()?.code, "prod 剥离：不警示").toBeUndefined();
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });
});
