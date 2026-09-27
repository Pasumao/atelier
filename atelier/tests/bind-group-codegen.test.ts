/**
 * bind-group-codegen.test.ts — 决策 25 v1.2 codegen emitAttrs bind:group 同位同构发射（m10 批 B）。
 * 纪律：先红后绿；「发射形态/产物断言」本分支内自洽转绿，「行为 parity/错误路径」为设计内红
 * （引用 rt.bindGroup 而 runtime 分支 A 未合并时 __compiledRT 无此员 → 挂载 TypeError → 红，
 * 随 A 合并转绿——bind 批 B 先例）。
 *
 * 红检口径（实现前实测，2026-09-27）：现行 emitAttrs 把 bind:group 落进 bind: 通用支路发射
 * rt.bindTwoWay——
 *   · 形态锚定用例：产物源码无 rt.bindGroup( → 红；
 *   · 行为用例：__compiledRT.bindGroup 不存在 → 挂载 TypeError → 设计内红。
 * collect 断言（bind: 通用支路已收 reactive 桶）为既有不变量钉，绿属预期。
 *
 * 契约（决策 25 v1.2，统筹者冻结）：发射行 = rt.bindGroup(el, name, expr, SV, tag) 五参全形态，
 * attr 全名进发射（m9 on: 整名发射教训）；collect(st, "reactive", a.value) 与 bind: 同桶
 * （bindGroup 下行 effect 订阅目标信号 ⇒ 超集不变式同款论证）。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $state } from "../runtime/core.ts";
import {
  mountComponent,
  parseTemplate,
  registerCompiled,
  type ComponentDef,
  type ComponentRegistry,
} from "../runtime/template.ts";
import { compileFunction, compileModuleSource, programSource } from "../compiler/codegen.mjs";
import { findByTag, makeContainer, serialize } from "./dom-shim.ts";

type AnyNode = any;

type Validate = (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown };
const okValidate = (() => ({ ok: true })) as unknown as Validate;

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

const GROUP_RAW = `<input type="radio" name="plan" value="pro" bind:group={plan}>`;

describe("m10 批 B：bind:group 发射形态锚定（本分支内自洽）", () => {
  it("bind:group 发射 rt.bindGroup 全参形态（attr 全名进发射——m9 on: 整名教训）", () => {
    const src = programSource(parseTemplate(GROUP_RAW));
    expect(src).toContain("rt.bindGroup(");
    expect(src).toContain('"bind:group"');
    expect(src).not.toContain("rt.bindTwoWay(");
  });

  it("bind:value 仍发射 rt.bindTwoWay，两支路互不串扰", () => {
    const src = programSource(parseTemplate(`<input bind:value={text}>`));
    expect(src).toContain("rt.bindTwoWay(");
    expect(src).not.toContain("rt.bindGroup(");
  });

  it("collect 断言：bind:group 目标进静态 reactive 桶（超集不变式——bindGroup 下行 effect 订阅目标信号）", () => {
    const src = compileModuleSource("BindGroupDeps", [GROUP_RAW]);
    expect(src).toContain('reactive: [');
    expect(src).toContain('"plan"');
  });
});

describe("m10 批 B：bind:group golden DOM parity（设计内红——随 A 合并转绿）", () => {
  /** codegen.test.ts parity harness 同款：同一模板 raw 两条路径各挂载一次（fresh 信号），逐帧全等 */
  async function parity(
    name: string,
    raw: string,
    build: (container: AnyNode) => { scope: Record<string, unknown>; steps: Array<() => Promise<void> | void> },
  ): Promise<[string[], string[]]> {
    const run = async (compiled: boolean): Promise<string[]> => {
      const container = makeContainer();
      const { scope, steps } = build(container);
      if (compiled) registerCompiled(compileFunction(name, raw));
      const def: ComponentDef = { name, render: () => ({ raw, scope }) as never };
      mountComponent(def, {}, container, new Map() as ComponentRegistry, okValidate);
      const frames = [serialize(container)];
      for (const step of steps) {
        await step();
        await flush();
        frames.push(serialize(container));
      }
      return frames;
    };
    const a = await run(false); // 解释器路径
    const b = await run(true); // 编译快路径（零 tokenize）
    return [a, b];
  }

  it("radio group roundtrip 双路径同帧对拍（初始同步/change 回写/信号外写组互斥）", async () => {
    const [a, b] = await parity("BindGroupParity", `<input type="radio" value="pro" bind:group={plan}>`, (container) => {
      const plan = $state("basic");
      return {
        scope: { plan },
        steps: [
          async () => {
            const input = findByTag(container, "input")[0];
            input.checked = true;
            input.dispatchEvent({ type: "change" });
          },
          async () => {
            plan.value = "enterprise";
          },
        ],
      };
    });
    expect(b).toEqual(a);
  });

  it("编译路径错误面：$derived 目标 → 组件级错误边界呈现 ATR-305（code/message 与解释器同源同文）", async () => {
    // 解释器路径：precheck 元素级错误卡（元素级替换）
    const d = $derived(() => "ro");
    const c1 = makeContainer();
    const def1: ComponentDef = {
      name: "BindGroupDerivedI",
      render: () => ({ raw: `<input type="radio" value="a" bind:group={d}>`, scope: { d } }) as never,
    };
    mountComponent(def1, {}, c1, new Map() as ComponentRegistry, okValidate);
    const s1 = serialize(c1);
    expect(s1).toContain("atr-error-card");
    expect(s1).toContain("ATR-305");
    expect(findByTag(c1, "input").length, "解释器：错误卡替换整个元素").toBe(0);

    // 编译路径：bindGroup dev 抛出 → mountComponent 组件级错误边界（bind 批先例：双路 DOM 粒度不同、
    // code/message/fix 同源同文——bindGroup 校验单点即解释器同函数）
    const d2 = $derived(() => "ro");
    const c2 = makeContainer();
    registerCompiled(compileFunction("BindGroupDerivedC", `<input type="radio" value="a" bind:group={d2}>`));
    const def2: ComponentDef = {
      name: "BindGroupDerivedC",
      render: () => ({ raw: `<input type="radio" value="a" bind:group={d2}>`, scope: { d2 } }) as never,
    };
    mountComponent(def2, {}, c2, new Map() as ComponentRegistry, okValidate);
    const s2 = serialize(c2);
    expect(s2).toContain("ATR-305", "编译路径：组件级错误边界呈现同一 code（粒度差异见 bind 批先例）");
    expect(s2).toContain("派生信号只读", "同源同文：message 来自同一校验单点");
  });
});
