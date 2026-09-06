/**
 * f5-kernel.test.ts — F-5 内核补强红检（2026-09-06 锐评取证复现）：
 *   ① {#if} 换支后旧分支 bindExpr effect 仍存活，对已脱离节点继续写入
 *      （锐评取证 template.ts:590-595/662 —— dispose 被丢弃、重建只清 DOM）。
 *   ② props 挂载期一次性求值，父信号变化不传导子组件
 *      （锐评取证 template.ts:607-608；codegen.test.ts 测试名自认"不随信号后续变化"）。
 * 红检转绿 = F-5 出口判据（ROADMAP P3-6）。诚实纪律：先红后绿，禁止直接写实现。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $state } from "../runtime/core.ts";
import { mountComponent } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { validateFlat } from "../runtime/contract.ts";

function findByTag(node: any, tag: string): any {
  if (node?.tag === tag) return node;
  for (const c of node?.childNodes ?? []) {
    const r = findByTag(c, tag);
    if (r) return r;
  }
  return null;
}

/** 批式 effect 冲刷（与 hmr.test 同款双微任务惯例） */
const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

describe("F-5 红检（锐评取证复现）", () => {
  it("红检①：{#if} 换支后旧分支 effect 不再写已脱离节点", async () => {
    const show = $state(true);
    const msg = $state("old");
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "LeakHost",
      render: () =>
        ({ raw: `{#if show.value}<b>{msg.value}</b>{/if}`, scope: { show, msg } }) as never,
    };
    reg.set("LeakHost", def);
    const container = document.createElement("div");
    mountComponent(def, {}, container, reg, validateFlat);
    await flush();

    const bEl = findByTag(container, "b");
    expect(bEl, "初始分支已渲染 <b>").toBeTruthy();
    const tn = bEl.firstChild;
    expect(tn.textContent).toBe("old");

    show.value = false; // 换支：旧分支子树被清出 DOM
    await flush();
    expect(findByTag(container, "b")).toBeNull();

    msg.value = "leaked"; // 只被旧分支读取的信号继续变化
    await flush();
    expect(tn.textContent).toBe("old"); // 期望：已脱离，不再被写（当前实现写出 "leaked" → 红）
  });

  it("红检②：父信号变化传导子组件（响应式 props）", async () => {
    const title = $state("v1");
    const reg: ComponentRegistry = new Map();
    reg.set("PropsSub", {
      name: "PropsSub",
      schema: { type: "object", reqProps: { title: { type: "string" } }, optProps: {} },
      render: () => ({ raw: `<em>{props.title}</em>`, scope: {} }) as never,
    });
    const host: ComponentDef = {
      name: "PropsHost",
      render: () =>
        ({ raw: `<section><PropsSub title={title.value} /></section>`, scope: { title } }) as never,
    };
    reg.set("PropsHost", host);
    const container = document.createElement("div");
    mountComponent(host, {}, container, reg, validateFlat);
    await flush();

    const em = findByTag(container, "em");
    expect(em.textContent).toBe("v1");

    title.value = "v2";
    await flush();
    expect(em.textContent).toBe("v2"); // 期望：传导更新（当前实现停留 "v1" → 红）
  });

  it("F-5 加固③：keyed each 行移除后，该行 effect 不再写已脱离节点", async () => {
    const items = $state([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    const extra = $state("x");
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "KeyedRows",
      render: () =>
        ({ raw: `{#each items.value as it by it.id}<i>{it.name}-{extra.value}</i>{/each}`, scope: { items, extra } }) as never,
    };
    reg.set("KeyedRows", def);
    const container = document.createElement("div");
    mountComponent(def, {}, container, reg, validateFlat);
    await flush();

    const rowA = findByTag(container, "i");
    expect(rowA.textContent).toBe("A-x");

    items.value = [{ id: "b", name: "B" }]; // 行 a 移除
    await flush();
    expect(rowA.isConnected).toBe(false); // 已脱离文档

    extra.value = "y"; // 只被行内 effect 读取
    await flush();
    expect(rowA.textContent).toBe("A-x"); // 期望：行析构后不再被写（仍为 "A-x"）
    const rowB = findByTag(container, "i");
    expect(rowB.textContent).toBe("B-y"); // 存活行照常响应
  });

  it("F-5 加固④：分支切换级联析构嵌套实例（子组件 effect 一并回收）", async () => {
    const show = $state(true);
    const title = $state("t1");
    const reg: ComponentRegistry = new Map();
    reg.set("PropsSub", {
      name: "PropsSub",
      schema: { type: "object", reqProps: { title: { type: "string" } }, optProps: {} },
      render: () => ({ raw: `<em>{props.title}</em>`, scope: {} }) as never,
    });
    const host: ComponentDef = {
      name: "CascadeHost",
      render: () =>
        ({ raw: `{#if show.value}<PropsSub title={title.value} />{/if}`, scope: { show, title } }) as never,
    };
    reg.set("CascadeHost", host);
    const container = document.createElement("div");
    mountComponent(host, {}, container, reg, validateFlat);
    await flush();

    const em = findByTag(container, "em");
    expect(em.textContent).toBe("t1");

    show.value = false;
    await flush();
    expect(em.isConnected).toBe(false); // 子组件树已随分支移除

    title.value = "t2"; // 子组件的 bindProp 父侧 effect 与子侧 bindExpr effect 均应已析构
    await flush();
    expect(em.textContent).toBe("t1"); // 期望：级联析构后不再被写（仍为 "t1"）
  });
});
