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
  parseTemplate,
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

/* ================= F-4 覆盖扩张（第二批：对象/数组字面量 / 错位闭合显式拒绝 / 字面量花括号） ================= */

describe("F-4 覆盖扩张第二批 golden DOM parity", () => {
  it("对象字面量插值 {{a: n.value, k: 'x'}}（stringify JSON 渲染 + 更新跟随）", async () => {
    const raw = `<p>{{a: n.value, k: "x"}}</p>`;
    const r = await parity("ParityObjLit", raw, () => {
      const n = $state(1);
      return { scope: { n }, steps: [async () => { n.value = 7; }] };
    });
    // shim serialize 对文本节点再包一层 JSON.stringify ⇒ 引号以 \" 转义形态出现
    expect(r.frames[0]).toContain('{\\"a\\":1,\\"k\\":\\"x\\"}');
    expect(r.frames[1]).toContain('{\\"a\\":7,\\"k\\":\\"x\\"}');
  });

  it("数组字面量 / {a} 简写（普通作用域值）/ ({...}).x 后缀链", async () => {
    const raw = `<div>{[1, n.value, n.value * 2]}|{{w}}|{({a: n.value}).a}</div>`;
    const r = await parity("ParityArrLit", raw, () => {
      const n = $state(3);
      const w = "plain"; // 简写 {w} 取作用域字面值——信号对象会被 stringify 泄漏内部字段，此处用普通值
      return { scope: { n, w }, steps: [async () => { n.value = 5; }] };
    });
    expect(r.frames[0]).toContain('"[1,3,6]"');
    expect(r.frames[0]).toContain('{\\"w\\":\\"plain\\"}');
    expect(r.frames[1]).toContain('"[1,5,10]"');
    expect(r.frames[1]).toContain('"5"');
  });

  it("对象字面量经组件 props 挂载期一次性求值（F-2 mount 语义：不随信号后续变化）", async () => {
    const raw = `<section><Sub dataCfg={{lvl: n.value}} /></section>`;
    const registry = new Map<string, ComponentDef>();
    registry.set("Sub", {
      name: "Sub",
      render: () => ({ raw: `<em>{props.dataCfg.lvl}</em>`, scope: {} }) as never,
    });
    const r = await parity(
      "ParityObjProp",
      raw,
      () => {
        const n = $state(2);
        return { scope: { n }, steps: [] };
      },
      { registry },
    );
    expect(r.frames[0]).toContain('"2"');
  });

  it("字面量花括号原样并入文本（配对失败的 { 不再静默丢弃；{ } 空体同为字面量）", async () => {
    const raw = `<p>a { b 与 {{ 及 { } 尾</p>`;
    const r = await parity("ParityLiteralBraces", raw, () => {
      const n = $state(1);
      return { scope: { n }, steps: [] };
    });
    expect(r.frames[0]).toContain('"a { b 与 {{ 及 { } 尾"');
  });

  it("解析非法的配对表达式仍走 bindExpr 求值期 ATR-301 错误卡（P0-8 前置报错语义保持）", async () => {
    const raw = `<p>{n.value +}</p>`;
    const r = await parity("ParityBadExpr", raw, () => {
      const n = $state(1);
      return { scope: { n }, steps: [] };
    });
    expect(r.frames[0]).toContain("⚠");
    expect(r.frames[0]).toContain("ATR-301");
  });

  it("对象字面量的键不进静态依赖清单；值引用照常入集", () => {
    const c = compileFunction("DepObjLit", `<i>{{a: x.value, b: [y.value], self: z.value}}</i>`);
    expect([...c.deps.reactive].sort()).toEqual(["x", "y", "z"]);
  });
});

describe("F-4 第二批解析期显式拒绝（错位/游离闭合 → ATR-101）", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["错位闭合（span 配 div）", "<div><span>x</div>", /未闭合/],
    ["游离闭合（顶层无开标签）", "</span>{x}", /多余的闭合标签/],
    ["块内游离闭合", "{#if open.value}</div>{/if}", /多余的闭合标签/],
  ];
  for (const [label, raw, re] of cases) {
    it(`${label} → 构建期抛 ATR-101（不再静默吞掉/截断）`, () => {
      let thrown: { code?: string; message?: string } | undefined;
      try {
        compileFunction(`Reject_${label}`, raw);
      } catch (e) {
        thrown = e as never;
      }
      expect(thrown?.code).toBe("ATR-101");
      expect(thrown?.message).toMatch(re);
    });
  }

  it("合法嵌套同名/异名标签不受影响（回归守卫）", () => {
    const ast = parseTemplate(`<div><section><span>x</span></section><div>y</div></div>`);
    expect(ast).toHaveLength(1);
    expect((ast[0] as { children: unknown[] }).children).toHaveLength(2);
  });
});

/* ================= F-4 codegen 覆盖扩张（第一批：else-if 链 / void 元素 / 解析期显式拒绝） ================= */

describe("F-4 覆盖扩张第一批 golden DOM parity", () => {
  it("{:else if} 链（多分支首中即停，分支互斥）", async () => {
    const raw =
      `<div>{#if s.value === 1}<b>one</b>{:else if s.value === 2}<i>two</i>` +
      `{:else if s.value === 3}<u>three</u>{:else}<s>other</s>{/if}</div>`;
    const r = await parity("ParityElseIf", raw, () => {
      const s = $state(1);
      return {
        scope: { s },
        steps: [
          async () => { s.value = 2; },
          async () => { s.value = 3; },
          async () => { s.value = 99; }, // 全不命中 → {:else}
          async () => { s.value = 1; }, // 回到首分支
        ],
      };
    });
    expect(r.frames[0]).toContain('"one"');
    expect(r.frames[1]).toContain('"two"');
    expect(r.frames[2]).toContain('"three"');
    expect(r.frames[3]).toContain('"other"');
    expect(r.frames[4]).toContain('"one"');
    // 锚点清空语义：每帧只有命中分支的文本
    expect(r.frames[1]).not.toContain('"one"');
    expect(r.frames[3]).not.toContain('"three"');
  });

  it("void 元素（<img>/<input>/<br>）不吞后续兄弟节点 + void 上的动态 attr", async () => {
    const raw =
      `<div class="wrap"><img src={u.value} alt="logo"><input type="text" value={t.value}><br>` +
      `<p>after {t.value}</p></div>`;
    const r = await parity("ParityVoid", raw, () => {
      const u = $state("/a.png");
      const t = $state("hi");
      return {
        scope: { u, t },
        steps: [
          async () => { u.value = "/b.png"; },
          async () => { t.value = "yo"; },
        ],
      };
    });
    // 回归（吞兄弟节点缺陷）：after 文本与 img 同级渲染，而非成为 img 的子节点后消失
    expect(r.frames[0]).toContain('"after "');
    expect(r.frames[0]).toContain('"hi"');
    expect(r.frames[1]).toContain('src="/b.png"');
    expect(r.frames[2]).toContain('"yo"');
    expect(r.frames[2]).toContain('value="yo"');
    expect(r.frames[2]).toContain('alt="logo"');
  });

  it("{:else} 不再把 } 漏进分支文本（pos 偏移回归）", async () => {
    const raw = `<p>{#if open.value}ON{:else}OFF{/if}</p>`;
    const r = await parity("ParityElseBrace", raw, () => {
      const open = $state(false);
      return { scope: { open }, steps: [async () => { open.value = true; }] };
    });
    expect(r.frames[0]).toContain('"OFF"');
    expect(r.frames[0]).not.toContain('"}');
    expect(r.frames[1]).toContain('"ON"');
  });

  it("else-if 链的静态依赖清单：各分支 test 与全部插值的根标识符入集（超集语义）", () => {
    const raw = `<div>{#if a.value}<b>{x.value}</b>{:else if b.value}<i>{y.value}</i>{:else}<u>{z.value}</u>{/if}</div>`;
    const c = compileFunction("DepElseIf", raw);
    expect([...c.deps.reactive].sort()).toEqual(["a", "b", "x", "y", "z"]);
  });
});

describe("F-4 解析期显式拒绝（ATR-101）", () => {
  const cases: Array<[string, string]> = [
    ["{#if 未闭合", "{#if open.value}<i>x</i>"],
    ["{#each 未闭合", "{#each list.value as x}<i>{x}</i>"],
    ["元素未闭合", "<div><p>x</p>"],
  ];
  for (const [label, raw] of cases) {
    it(`${label} → 编译路径构建期抛 ATR-101（四段式）`, () => {
      let thrown: { code?: string; message?: string; fix?: string } | undefined;
      try {
        compileFunction(`Reject_${label}`, raw);
      } catch (e) {
        thrown = e as never;
      }
      expect(thrown?.code).toBe("ATR-101");
      expect(thrown?.message).toMatch(/未闭合/);
      expect(typeof thrown?.fix).toBe("string");
      expect(thrown!.fix!.length).toBeGreaterThan(0);
    });
  }

  it("解释器路径：mountComponent 错误边界渲染可行动错误卡（不白屏）", () => {
    const container = makeContainer();
    mountComponent(
      { name: "RejectMount", render: () => ({ raw: "{#each list.value as x}<i>{x}</i>", scope: {} }) as never },
      {},
      container,
      new Map(),
      okValidate as never,
    );
    const s = serialize(container);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-101");
    expect(s).toContain("{/each}");
  });
});

