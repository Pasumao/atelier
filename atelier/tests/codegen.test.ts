/**
 * codegen.test.ts — P0-2③ 验收：编译产物与解释器 golden DOM diff 逐帧一致。
 *
 * 协议：同一模板 raw，两条路径各挂载一次（fresh 信号）——
 *   A 路径：未注册编译产物 → mountComponent 走解释器（parseTemplate + renderNodes）
 *   B 路径：registerCompiled(compileFunction(raw)) → mountComponent 走编译快路径（零 tokenize）
 * 初始序列化 + 每个变更步（信号写入/事件派发）flush 后序列化，两条 DOM 串逐帧全等。
 * shim DOM 语义见 tests/dom-shim.ts（appendChild 移动 / fragment 清空是 reconcile 对拍的关键）。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { $state, __withTracking } from "../runtime/core.ts";
import {
  compiledTemplateCount,
  mountComponent,
  registerCompiled,
  tokenState,
  type ComponentDef,
} from "../runtime/template.ts";
import { compileFunction, compileModuleSource } from "../compiler/codegen.mjs";
import { evalExpr, exprRootIdents } from "../runtime/expr.ts";
import { findByTag, makeContainer, serialize } from "./dom-shim.ts";

type CaseResult = { frames: string[] };

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

const okValidate = (): { ok: boolean } => ({ ok: true });

/** 同一用例跑两条路径，返回各自帧序列（初始 + 每步变更后） */
async function parity(
  name: string,
  raw: string,
  build: (container: any) => { scope: Record<string, unknown>; steps: Array<() => Promise<void> | void> },
  opts: { registry?: Map<string, ComponentDef>; validate?: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown } } = {},
): Promise<CaseResult> {
  const run = async (compiled: boolean): Promise<string[]> => {
    const container = makeContainer();
    const { scope, steps } = build(container);
    if (compiled) registerCompiled(compileFunction(name, raw));
    const def: ComponentDef = { name, render: () => ({ raw, scope }) as never };
    mountComponent(def, { name: "Atelier" }, container, opts.registry ?? new Map(), opts.validate ?? (okValidate as never));
    const frames = [serialize(container)];
    for (const step of steps) {
      await step();
      await flush();
      frames.push(serialize(container));
    }
    return frames;
  };
  const a = await run(false); // 解释器路径
  let b: string[];
  try {
    b = await run(true); // 编译快路径（按 raw 命中）
  } catch (e) {
    throw new Error(`compiled path threw: ${(e as Error)?.stack ?? e}`);
  }
  expect(b.length).toBe(a.length);
  for (let i = 0; i < a.length; i++) {
    expect(b[i], `frame #${i}`).toBe(a[i]);
  }
  return { frames: a };
}

describe("P0-2③ codegen golden DOM parity", () => {
  it("文本/插值/动静态属性/事件/{#if}{:else}", async () => {
    const raw = `<div class="card"><h1>Hello {props.name}</h1><p class="text-muted">count {n.value}</p>` +
      `{#if open.value}<button on:click={toggle}>Close</button>{:else}<span class="text-muted">closed</span>{/if}` +
      `<span data-k={n.value}>k</span></div>`;
    const r = await parity("ParityBasic", raw, (container) => {
      const n = $state(0);
      const open = $state(false);
      const toggle = () => {
        open.value = false;
        n.value += 1;
      };
      return {
        scope: { n, open, toggle },
        steps: [
          async () => {
            open.value = true; // → if 分支出现 button
          },
          async () => {
            const btn = findByTag(container, "button")[0];
            btn?.dispatchEvent({ type: "click" }); // toggle：n++ 且 open 收合
          },
          async () => {
            n.value = 42; // 纯值更新：两处插值 + 动态 attr 同步
          },
        ],
      };
    });
    expect(r.frames[0]).toContain('"closed"');
    expect(r.frames.at(-1)).toContain('"42"');
  });

  it("{#each} 无 key（全清重建）", async () => {
    const raw = `<ul>{#each items.value as it, i}<li>{i}: {it}</li>{/each}</ul>`;
    const r = await parity("ParityEach", raw, () => {
      const items = $state<string[]>(["a", "b"]);
      return {
        scope: { items },
        steps: [
          async () => {
            items.value = [...items.value, "c"];
          },
          async () => {
            items.value = items.value.slice(1); // 头部删除：无 key 全清重建
          },
        ],
      };
    });
    expect(r.frames.at(-1)?.split("<li>").length! - 1).toBe(2);
    expect(r.frames.at(-1)).toContain('"b"');
    expect(r.frames.at(-1)).toContain('"c"');
    expect(r.frames.at(-1)).not.toContain('"a"');
  });

  it("{#each by key}（reorder 复用子树）", async () => {
    const raw = `<div>{#each rows.value as r by r.id}<b data-id={r.id}>{r.name}</b>{/each}</div>`;
    const r = await parity("ParityKeyed", raw, () => {
      const rows = $state([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ]);
      return {
        scope: { rows },
        steps: [
          async () => {
            rows.value = [...rows.value].reverse(); // 全序翻转：appendChild 移动语义
          },
          async () => {
            rows.value = [rows.value[0], { id: "d", name: "D" }]; // 删 2 项 + 增 1 项
          },
        ],
      };
    });
    expect(r.frames.at(-1)).toContain('data-id="c"');
    expect(r.frames.at(-1)).toContain('"D"');
    expect(r.frames.at(-1)).not.toContain('"B"');
  });

  it("嵌套组件挂载 + 未注册回退 + 契约违规错误卡", async () => {
    const raw = `<section><SubCard title={t.value} level="2" /><Ghost /><SubBad title="x" /></section>`;
    const registry = new Map<string, ComponentDef>();
    registry.set("SubCard", {
      name: "SubCard",
      render: () => ({ raw: `<em>{props.title}·{props.level}</em>`, scope: {} }) as never,
    });
    registry.set("SubBad", {
      name: "SubBad",
      render: () => ({ raw: `<em>bad</em>`, scope: {} }) as never,
      schema: { fail: true }, // validate 按 schema.fail 分流 → ATR-201 错误卡
    });
    const validate = (schema: unknown): { ok: boolean; error?: { code: string; message: string; fix: string } } =>
      (schema as { fail?: boolean })?.fail
        ? { ok: false, error: { code: "ATR-201", message: "缺少 props.level", fix: "补上 level" } }
        : { ok: true };
    const r = await parity(
      "ParityNested",
      raw,
      () => {
        const t = $state("标题");
        return { scope: { t }, steps: [async () => { t.value = "标题2"; }] };
      },
      { registry, validate: validate as never },
    );
    expect(r.frames.at(-1)).toContain("ATR-4xx: 组件未注册：Ghost");
    expect(r.frames.at(-1)).toContain("ATR-201");
  });

  it("<style scoped> 注入（token 校验通过路径）+ root scope class", async () => {
    tokenState.vars.add("--atelier-color-accent");
    const raw = `<style scoped>.accent { color: var(--atelier-color-accent); }</style><p class="accent">{t.value}</p>`;
    const r = await parity("ParityStyle", raw, () => {
      const t = $state("styled");
      return { scope: { t }, steps: [async () => { t.value = "styled2"; }] };
    });
    expect(r.frames.at(-1)).toMatch(/atr-scope-\d+/); // scope class 同时挂上两条路径的 root
  });

  it("表达式求值失败 → ATR 错误卡（bindExpr catch 语义）", async () => {
    const raw = `<p>{n.value +}</p>`; // 解析期必抛（ATR-301 表达式意外结束）
    const r = await parity("ParityErr", raw, () => {
      const n = $state(1);
      return { scope: { n }, steps: [async () => { n.value = 2; }] };
    });
    expect(r.frames.at(-1)).toContain("⚠");
    expect(r.frames.at(-1)).toContain("ATR-301");
  });
});

describe("P0-2③ 编译管线本身", () => {
  it("零 tokenize 证据：raw 是解析器毒饵，命中编译产物时解释器输出不出现", () => {
    // "<div>{{" 若被解释器解析会得到 <div></div>（{{ 无法构成表达式）；
    // 编译产物 program 直接给出标记文本——DOM 出现标记 ⇒ parseTemplate 未参与该组件渲染。
    const bait = "<div>{{";
    registerCompiled({
      name: "Bait",
      raw: bait,
      styles: [],
      program: (ctx) => {
        void ctx;
        const f = document.createDocumentFragment();
        f.appendChild(document.createTextNode("COMPILED-PATH"));
        return f;
      },
    });
    const container = makeContainer();
    mountComponent({ name: "Bait", render: () => ({ raw: bait, scope: {} }) as never }, {}, container, new Map(), okValidate as never);
    expect(serialize(container)).toContain("COMPILED-PATH");
    // 解释器路径会产出内层空 div（{{ 解析不出表达式）；命中编译产物 ⇒ 不存在
    expect(serialize(container)).not.toContain("<div></div>");
  });

  it("compileModuleSource 产出可被 node --check 的合法 ESM", () => {
    const src = compileModuleSource("SyntaxProbe", [
      `<div>{#if o.value}<i>{n.value}</i>{:else}<u>{#each list.value as x by x.id}{x.name}{/each}</u>{/if}</div>`,
    ]);
    expect(src).toContain("export const compiledList");
    const file = path.join(os.tmpdir(), `atelier-codegen-${Date.now()}.mjs`);
    fs.writeFileSync(file, src, "utf8");
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    fs.rmSync(file, { force: true });
    expect(r.status).toBe(0);
  });

  it("registerCompiled 幂等 + compiledTemplateCount 计数", () => {
    const c = compileFunction("CountProbe", `<i>{n.value}</i>`);
    const before = compiledTemplateCount();
    registerCompiled(c); // 首次：+1
    expect(compiledTemplateCount()).toBe(before + 1);
    registerCompiled(c); // 同 raw 重注册：Map 覆盖，计数不变（幂等）
    registerCompiled({ compiled: c }); // 模块形态（{compiled}）等价
    expect(compiledTemplateCount()).toBe(before + 1);
  });
});

/* ================= F-2 静态依赖图（决策 3 第一期） ================= */

describe("F-2 static deps manifest (superset semantics)", () => {
  it("清单分桶：reactive / mount / events，each 子作用域变量被滤除", () => {
    const raw =
      `<div><p>{n.value}</p><span data-k={open.value}>` +
      `{#each items.value as it, idx}<b>{it.name}</b><i>{idx} {label.value}</i>{/each}</span>` +
      `{#if flag.value}on{:else}off{/if}` +
      `<button on:click={bump}>b</button><Child p={n.value} q="static"/></div>`;
    const c = compileFunction("DepManifest", raw);
    expect([...c.deps.reactive].sort()).toEqual(["flag", "items", "label", "n", "open"]);
    expect(c.deps.events).toEqual(["bump"]);
    expect(c.deps.mount).toEqual(["n"]); // 子组件 props 为挂载期一次性求值
    expect(c.deps.reactive).not.toContain("it"); // 子作用域变量不是外层依赖
    expect(c.deps.reactive).not.toContain("idx");
    // 模块形态同样携带清单
    const src = compileModuleSource("DepManifest", [raw]);
    expect(src).toContain('reactive: [');
    expect(src).toContain('"label"');
  });

  /** 差分底座：以 __withTracking 捕获真实追踪集，映射回信号名 */
  function makeWorld() {
    const a = $state(6);
    const b = $state(7);
    const c = $state(8);
    const flag = $state(true);
    const list = $state([10, 20, 30]);
    const i = $state(1);
    const cfg = { on: 1, off: 0 }; // 非信号作用域根：读它的属性不触发追踪
    const scope = { a, b, c, flag, list, i, cfg };
    const nameOf = new Map<SignalLike, string>([
      [a as SignalLike, "a"],
      [b as SignalLike, "b"],
      [c as SignalLike, "c"],
      [flag as SignalLike, "flag"],
      [list as SignalLike, "list"],
      [i as SignalLike, "i"],
    ]);
    return { scope, nameOf };
  }
  type SignalLike = { _subs: Set<unknown> };

  function runtimeDeps(scope: Record<string, unknown>, nameOf: Map<SignalLike, string>, src: string): string[] {
    const { deps } = __withTracking(() => evalExpr(src, scope));
    return [...deps].map((s) => nameOf.get(s as SignalLike)!).filter(Boolean);
  }

  it("超集不变式（含三元/&&/||/?? 短路）：运行时追踪集 ⊆ 静态引用集，200 样本", () => {
    // deterministic PRNG（与 expr.test.ts fuzz 同风格）
    let seed = 20260830;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
    const sigLeaf = () => pick(["a", "b", "c", "flag", "list", "i"]) + ".value";
    const plainLeaf = () => pick(["cfg.on", "cfg.off"]); // 静态入集、运行时不追踪
    const leaf = () => (rnd() < 0.75 ? sigLeaf() : plainLeaf());
    const idxLeaf = () => `list.value[i.value]`;
    function genExpr(depth: number): string {
      if (depth <= 0) return rnd() < 0.85 ? leaf() : idxLeaf();
      const kind = rnd();
      const L = genExpr(depth - 1);
      const R = genExpr(depth - 1);
      if (kind < 0.35) return `(${L} ${pick(["+", "-", "*", "/"])} ${R})`; // 二元
      if (kind < 0.5) return `(${L} ${pick([">", "<", ">=", "<=", "===", "!=="])} ${R})`;
      if (kind < 0.62) return `(${L} ? (${R}) : (${L}))`; // 三元：静态并入两支，运行时只追一支
      if (kind < 0.74) return `((${L}) ${pick(["&&", "||", "??"])} (${R}))`; // 短路
      if (kind < 0.87) return `(${L})`;
      return `(!(${L}))`;
    }
    const { scope, nameOf } = makeWorld();
    for (let n = 0; n < 200; n++) {
      const src = genExpr(3);
      const tracked = runtimeDeps(scope, nameOf, src);
      const statics = new Set(exprRootIdents(src));
      for (const name of tracked) {
        expect(statics.has(name), `sample #${n} "${src}": 运行时追踪了 "${name}" 但静态引用集未含`).toBe(true);
      }
    }
  });

  it("无短路 + 全信号访问的表达式：静态集 === 运行时集（等号成立的边界）", () => {
    let seed = 4260830;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const { scope, nameOf } = makeWorld();
    for (let n = 0; n < 100; n++) {
      const leaves = ["a.value", "b.value", "c.value", "flag.value", "list.value", "i.value"];
      const L = pick2(leaves, rnd);
      let src = L;
      for (let k = 0; k < 2; k++) {
        src = `(${src} ${pick2(["+", "-", "*", ">", "<", "==="], rnd)} ${pick2(leaves, rnd)})`;
      }
      const tracked = runtimeDeps(scope, nameOf, src).sort();
      expect(tracked, src).toEqual(exprRootIdents(src).sort());
    }
  });
});

function pick2<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}
