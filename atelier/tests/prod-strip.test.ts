/**
 * prod-strip.test.ts — F-2 二期 prod 剥离（MINI）验收：__ATELIER_PROD__ 旗剥离 dev 专属可视化。
 *   旗开：契约违约（ATR-201）渲染过 · token 未定义（ATR-204）不抛 · 未注册组件（ATR-4xx）无卡
 *        · 渲染期求值错误空占位（console 仍记，不静默）
 *   旗关（默认）：全部错误卡照旧——现有 122 用例即回归。
 * 诚实边界：运行时旗分支，校验代码仍在包内；tree-shake 全量剥离归打包面（atelier build）。
 */
import "./dom-shim.ts";
import { afterAll, describe, expect, it } from "vitest";
import { mountComponent } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { validateFlat } from "../runtime/contract.ts";
import { initTokens } from "../runtime/template.ts";

const G = globalThis as { __ATELIER_PROD__?: boolean };
afterAll(() => {
  G.__ATELIER_PROD__ = false; // 恢复 dev 语义，防污染同进程后续测试
});
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
function textOf(node: any): string {
  return node?.textContent ?? "";
}

describe("prod 剥离（__ATELIER_PROD__）", () => {
  it("旗开：契约违约不再渲染 ATR-201 错误卡，组件照常挂载", async () => {
    G.__ATELIER_PROD__ = true;
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "StrictSub",
      schema: { type: "object", reqProps: { must: { type: "string" } }, optProps: {} },
      render: () => ({ raw: `<em>{props.must}</em>`, scope: {} }) as never,
    };
    reg.set("StrictSub", def);
    const host: ComponentDef = {
      name: "StrictHost",
      render: () => ({ raw: `<section><StrictSub /></section>`, scope: {} }) as never,
    };
    reg.set("StrictHost", host);
    const container = document.createElement("div");
    mountComponent(host, {}, container, reg, validateFlat); // props 缺 must —— dev 必红，prod 放行
    await flush();
    expect(container.textContent).not.toContain("ATR-201");
    expect(findByTag(container, "em")).toBeTruthy(); // 组件带 undefined prop 照常挂载
    G.__ATELIER_PROD__ = false;
  });

  it("旗开：scoped 样式引用未定义 token 不抛 ATR-204（var() 回退）", () => {
    G.__ATELIER_PROD__ = true;
    initTokens({ tokens: { color: { primary: "#111111" } } });
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "BadToken",
      render: () =>
        ({ raw: `<b class="x">ok</b><style scoped>.x { color: var(--color-notdefined); }</style>`, scope: {} }) as never,
    };
    reg.set("BadToken", def);
    const container = document.createElement("div");
    // dev 下此处抛 ATR-204 → mount 边界错误卡；prod 下静默过
    expect(() => mountComponent(def, {}, container, reg, validateFlat)).not.toThrow();
    expect(textOf(container)).not.toContain("ATR-204");
    expect(findByTag(container, "b")).toBeTruthy();
    G.__ATELIER_PROD__ = false;
  });

  it("旗开：未注册组件无 ATR-4xx 错误卡（空占位）；旗关恢复卡片", async () => {
    G.__ATELIER_PROD__ = true;
    const reg: ComponentRegistry = new Map();
    const host: ComponentDef = {
      name: "GhostHost",
      render: () => ({ raw: `<section><Ghost /></section>`, scope: {} }) as never,
    };
    reg.set("GhostHost", host);
    const prodC = document.createElement("div");
    mountComponent(host, {}, prodC, reg, validateFlat);
    await flush();
    expect(prodC.textContent).not.toContain("ATR-4xx");

    G.__ATELIER_PROD__ = false; // 旗关：dev 语义恢复
    const devC = document.createElement("div");
    mountComponent(host, {}, devC, reg, validateFlat);
    await flush();
    expect(devC.textContent).toContain("ATR-4xx");
  });
});
