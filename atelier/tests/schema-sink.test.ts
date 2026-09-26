/**
 * schema-sink.test.ts — 决策 26 runtime 提取 schema sink（批 B）：
 *   · registerExtractedSchemas 注册 → component() 无显式 schema 时按 defName 兜底取用
 *     （opts.name 与 fn.name 两形态各一例）
 *   · 显式 opts.schema 恒胜（sink 同名条目不覆盖——ContractProbe 现状形态逐字对齐）
 *   · 重复注册同名不同值 → 后者胜（HMR 模块重求值刷新语义）
 *   · 无条目 → def.schema undefined + mount 校验跳过不报错（「无 schema 不校验」诚实语义
 *     钉死 = 决策 26 边界①：编译产物流未注入时静默无校验，validateProps no-op）
 *   · 端到端：纯 JSON 提取产物形态 {type:"object",reqProps:{...}} → 真实校验链——
 *     合法实例照常渲染，缺 reqProps 实例出 ATR-201 错误卡
 */
import "./dom-shim.ts";
import { beforeEach, describe, expect, it } from "vitest";
import { $state } from "../runtime/core.ts";
import { html, mountComponent } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { validateFlat } from "../runtime/contract.ts";
import { __resetExtractedSchemas, component, registerExtractedSchemas } from "../runtime/component.ts";
import * as runtimeBarrel from "../runtime/index.ts";

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

function findByTag(node: any, tag: string): any {
  if (node?.tag === tag) return node;
  for (const c of node?.childNodes ?? []) {
    const r = findByTag(c, tag);
    if (r) return r;
  }
  return null;
}

beforeEach(() => {
  __resetExtractedSchemas(); // 用例互不污染（test-only 内部出口，生产面不提供 clear）
});

describe("决策 26 sink：注册与兜底取用", () => {
  it("sink 注册 → opts.name 形态兜底取用（同引用）", () => {
    const schema = { type: "object", reqProps: { title: { type: "string" } }, optProps: {} };
    registerExtractedSchemas({ SinkOptName: schema });
    const def = component((_props: Record<string, unknown>) => html`<em>x</em>`, { name: "SinkOptName" });
    expect(def.name).toBe("SinkOptName");
    expect(def.schema).toBe(schema);
  });

  it("sink 注册 → fn.name 形态兜底取用（同引用）", () => {
    const schema = { type: "object", reqProps: { must: { type: "string" } }, optProps: {} };
    registerExtractedSchemas({ SinkNamedFn: schema });
    const def = component(function SinkNamedFn(_props: Record<string, unknown>) {
      return html`<em>x</em>`;
    });
    expect(def.name).toBe("SinkNamedFn"); // 名字解析现序不变：opts.name 缺省回落 fn.name
    expect(def.schema).toBe(schema);
  });

  it("显式 opts.schema 恒胜——sink 同名有条目也不覆盖（ContractProbe 现状形态）", () => {
    const extracted = {
      type: "object",
      reqProps: { title: { type: "string" }, level: { type: "number" } },
      optProps: { note: { type: "string" } },
    };
    const handwritten = {
      type: "object",
      reqProps: { title: { type: "string" }, level: { type: "number" } },
      optProps: { note: { type: "string" } },
    };
    registerExtractedSchemas({ SinkExplicitWin: extracted });
    const def = component(function SinkExplicitWin(_props: Record<string, unknown>) {
      return html`<em>x</em>`;
    }, { name: "SinkExplicitWin", schema: handwritten });
    expect(def.schema).toBe(handwritten); // 显式胜：向后兼容承诺（决策 26 ③）
    expect(def.schema).not.toBe(extracted);
  });

  it("重复 registerExtractedSchemas 同名不同值 → 后者胜（HMR 模块重求值刷新语义）", () => {
    const v1 = { type: "object", reqProps: { a: { type: "string" } }, optProps: {} };
    const v2 = { type: "object", reqProps: { a: { type: "string" }, b: { type: "number" } }, optProps: {} };
    registerExtractedSchemas({ SinkHmr: v1 });
    registerExtractedSchemas({ SinkHmr: v2 });
    const def = component((_props: Record<string, unknown>) => html`<em>x</em>`, { name: "SinkHmr" });
    expect(def.schema).toBe(v2);
  });

  it("桶出口纯加法：registerExtractedSchemas 经 index.ts 同源可达；__resetExtractedSchemas 不出桶", () => {
    expect(runtimeBarrel.registerExtractedSchemas).toBe(registerExtractedSchemas);
    expect((runtimeBarrel as unknown as Record<string, unknown>).__resetExtractedSchemas).toBeUndefined();
  });
});

describe("决策 26 边界①：诚实语义钉死（无 schema = 校验 no-op）", () => {
  it("sink 未注 → def.schema undefined", () => {
    const def = component((_props: Record<string, unknown>) => html`<em>x</em>`, { name: "SinkAbsent" });
    expect(def.schema).toBeUndefined();
  });

  it("无 schema 且 sink 未注 → mount 校验跳过不报错（validateProps no-op）", async () => {
    const reg: ComponentRegistry = new Map();
    const sub = component(function SinkNoSchema(props: { whatever?: string }) {
      return html`<em>{props.whatever}</em>`.locals({ props });
    });
    reg.set("SinkNoSchema", sub);
    const host: ComponentDef = {
      name: "SinkNoSchemaHost",
      render: () => ({ raw: `<section><SinkNoSchema whatever="v" /></section>`, scope: {} }) as never,
    };
    reg.set("SinkNoSchemaHost", host);
    const container = document.createElement("div");
    mountComponent(host, {}, container, reg, validateFlat);
    await flush();
    expect(container.textContent).not.toContain("ATR-201");
    const em = findByTag(container, "em");
    expect(em, "无 schema 组件照常渲染").toBeTruthy();
    expect(em.textContent).toBe("v");
  });
});

describe("端到端：sink 提取 schema 进入真实校验链", () => {
  // 提取产物形态（compiler/extract-schema.mjs 产物同构）：纯 JSON，ContractProbe 同款面
  const extracted = {
    type: "object",
    reqProps: { title: { type: "string" }, level: { type: "number" } },
    optProps: { note: { type: "string" } },
  };

  function buildHost(raw: string, scope: Record<string, unknown>): { host: ComponentDef; reg: ComponentRegistry } {
    const reg: ComponentRegistry = new Map();
    const sub = component(function SinkProbe(props: { title: string; level: number; note?: string }) {
      return html`<em>{props.title}:{props.level}</em>`.locals({ props });
    });
    reg.set("SinkProbe", sub); // def.schema 兜底自 sink（无显式 opts.schema）
    const host: ComponentDef = {
      name: "SinkProbeHost",
      render: () => ({ raw, scope }) as never,
    };
    reg.set("SinkProbeHost", host);
    return { host, reg };
  }

  it("合法 props 实例照常渲染（sink schema 校验通过）", async () => {
    registerExtractedSchemas({ SinkProbe: extracted });
    const lvl = $state(1);
    const { host, reg } = buildHost(`<section><SinkProbe title="hi" level={lvl.value} /></section>`, { lvl });
    const container = document.createElement("div");
    mountComponent(host, {}, container, reg, validateFlat);
    await flush();
    expect(container.textContent).not.toContain("ATR-201");
    const em = findByTag(container, "em");
    expect(em, "合法 props 走通 sink 契约校验并渲染").toBeTruthy();
    expect(em.textContent).toBe("hi:1");
  });

  it("缺 reqProps 实例出 ATR-201 错误卡（校验链真实消费 sink 条目）", async () => {
    registerExtractedSchemas({ SinkProbe: extracted });
    const lvl = $state(1);
    const { host, reg } = buildHost(`<section><SinkProbe level={lvl.value} /></section>`, { lvl }); // 缺 title
    const container = document.createElement("div");
    mountComponent(host, {}, container, reg, validateFlat);
    await flush();
    expect(container.textContent).toContain("ATR-201");
    expect(container.textContent).toContain("缺少必填属性 title（string）");
    expect(findByTag(container, "em")).toBeNull(); // 错误卡替换组件渲染，不白屏
  });
});
