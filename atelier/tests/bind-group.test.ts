/**
 * bind-group.test.ts — 决策 25 v1.2 属性级指令增量（bind:group radio group 双向绑定）。
 * 纪律：先红后绿（红检证据记入提交信息），禁止先写实现。
 *
 * 红检口径（实现前实测，2026-09-27）：现行解释器把 bind:group={sig} 落进 dynamic 单向支路
 * （bindExpr → setAttribute("bind:group", 信号名)）——
 *   · roundtrip 用例：radio 无任何 checked 下行/无 change 上行（el.checked 恒 undefined）→ 红；
 *   · bind:group 被当普通动态 attr 落 setAttribute（指令面失守）→ 红；
 *   · 错误卡用例：无 ATR-327（value 身份键）、无槽位守卫（bind:group × bind:checked 同元素
 *     静默双写 checked）、type 细化面不认 bind:group → 红；
 *   · 直调用例：__compiledRT.bindGroup 尚不存在 → TypeError → 红。
 *
 * 契约（决策 25 v1.2，统筹者冻结）：
 *   · 组语义 = 绑定同一目标信号的全体 bind:group 元素：信号回写驱动每个成员的下行 effect
 *     重判 checked ⇒ 组内互斥；不依赖原生 name 分组（不同 name 绑同一信号仍互斥）。
 *   · 身份键 = 静态 value 属性（缺省/动态/空串 → ATR-327，预检级；运行时 belt 面仅记录不抛）。
 *   · ATR-325 升级为槽位语义：checked 槽（bind:checked / bind:group 共占）、value 槽（bind:value）；
 *     同元素同槽第二次订阅 → ATR-325（同名重复维持既有文案；跨名同槽点名两个 attr）。
 *
 * 边界（诚实标注，沿 bind-directive.test.ts 口径）：
 *   · removeEventListener：dom-shim 未实现——换支用例只断言下行侧（effect dispose 生效）。
 *   · 组内重复 value 身份键 v1 不校验（跨元素面；语义确定性保留：checked = (sig.value === 自身 key)）。
 *   · dom-shim 无 attr→property 反射：身份键一律 getAttribute 读（恰好与契约一致），
 *     checked 走 JS 属性面（bind:checked 既有用例同款）。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $derived, $state } from "../runtime/core.ts";
import { __compiledRT, mountComponent } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { findByTag, makeContainer, serialize } from "./dom-shim.ts";

type AnyNode = any;

type Validate = (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown };
const okValidate = (() => ({ ok: true })) as unknown as Validate;

/** 批式 effect 冲刷（bind-directive 同款双微任务惯例） */
const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

const defOf = (name: string, raw: string, scope: Record<string, unknown>): ComponentDef => ({
  name,
  render: () => ({ raw, scope }) as never,
});

/** 挂载一次并返回容器（mountComponent 自带错误边界，从不抛穿） */
function mountOnce(name: string, raw: string, scope: Record<string, unknown>): AnyNode {
  const container = makeContainer();
  mountComponent(defOf(name, raw, scope), {}, container, new Map() as ComponentRegistry, okValidate);
  return container;
}

const setLast = (v: unknown): void => {
  (globalThis as unknown as Record<string, unknown>).__ATELIER_LAST_ERROR__ = v;
};
const getLast = (): { code?: string } | undefined =>
  (globalThis as unknown as { __ATELIER_LAST_ERROR__?: { code?: string } }).__ATELIER_LAST_ERROR__;
const setProd = (v: boolean): void => {
  (globalThis as unknown as Record<string, unknown>).__ATELIER_PROD__ = v;
};

/** 捕获抛出物的四段式 code（bind-directive 同款：按 code 断言，不按 message 正则） */
const catchCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

const PLAN_TPL = `
      <label><input type="radio" name="plan" value="basic" bind:group={plan}> basic</label>
      <label><input type="radio" name="plan" value="pro" bind:group={plan}> pro</label>
      <label><input type="radio" name="plan" value="enterprise" bind:group={plan}> ent</label>`;

describe("决策 25 v1.2 bind:group 解释器路径（roundtrip）", () => {
  it("radio group roundtrip：初始 checked 同步 + change 回写 + 信号外写组内互斥重判", async () => {
    const plan = $state("pro");
    const c = mountOnce("GroupRoundtrip", PLAN_TPL, { plan });
    await flush();
    const radios = findByTag(c, "input");
    expect(radios.length, "三个 radio 已渲染").toBe(3);
    for (const r of radios) {
      expect(r.getAttribute("bind:group"), "bind: 是指令不是 attr——不落 setAttribute").toBe(null);
    }
    const byVal = (v: string): AnyNode => radios.find((r: AnyNode) => r.getAttribute("value") === v);
    expect(byVal("basic").checked, "初始：非选中项").toBe(false);
    expect(byVal("pro").checked, "初始：信号值项选中").toBe(true);
    expect(byVal("enterprise").checked, "初始：非选中项").toBe(false);

    byVal("basic").checked = true; // 模拟用户点选（真 DOM：点击触发 change）
    byVal("basic").dispatchEvent({ type: "change" });
    await flush();
    expect(plan.value, "上行：change 回写信号 = 选中项身份键").toBe("basic");
    expect(byVal("pro").checked, "组内互斥：原选中项随信号被取消").toBe(false);

    plan.value = "enterprise"; // 程序化更新
    await flush();
    expect(byVal("basic").checked, "下行：信号外写 → 组互斥重判").toBe(false);
    expect(byVal("enterprise").checked, "下行：信号外写 → 新选中项").toBe(true);
  });

  it("组互斥经信号而非原生 name：不同 name 的 radio 绑同一信号仍互斥", async () => {
    const picked = $state("y");
    const c = mountOnce(
      "GroupCrossName",
      `<input type="radio" name="a" value="x" bind:group={picked}><input type="radio" name="b" value="y" bind:group={picked}>`,
      { picked },
    );
    await flush();
    const radios = findByTag(c, "input");
    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked, "初始同步").toBe(true);

    radios[0].checked = true;
    radios[0].dispatchEvent({ type: "change" });
    await flush();
    expect(picked.value).toBe("x");
    expect(radios[1].checked, "原生 name 不同组，互斥仍由信号达成").toBe(false);
  });

  it("{#if} 换支后旧分支 bind:group dispose 生效（改信号不再写脱离节点，F-5 口径）", async () => {
    const show = $state(true);
    const plan = $state("pro");
    const c = mountOnce("GroupIfDispose", `{#if show.value}<input type="radio" value="pro" bind:group={plan}>{/if}`, {
      show,
      plan,
    });
    await flush();
    const input = findByTag(c, "input")[0];
    expect(input.checked, "初始同步").toBe(true);

    show.value = false; // 换支：旧分支子树清出 DOM
    await flush();
    expect(findByTag(c, "input").length, "分支已换").toBe(0);

    plan.value = "other"; // 只被旧分支 bind 读取的信号继续变化
    await flush();
    expect(input.checked, "dispose 生效：脱离节点不再被下行写").toBe(true);
  });

  it("无回环钉死：程序化信号更新 → 下行 checked 重判，bind 监听零触发", async () => {
    const plan = $state("a");
    const c = mountOnce(
      "GroupNoLoop",
      `<input type="radio" value="a" bind:group={plan}><input type="radio" value="b" bind:group={plan}>`,
      { plan },
    );
    await flush();
    const radios = findByTag(c, "input");
    const bindListener = radios[0].listeners.get("change")[0];
    let fired = 0;
    radios[0].listeners.set("change", [
      (e: unknown) => {
        fired++;
        bindListener(e);
      },
    ]);

    plan.value = "b";
    await flush();
    expect(radios[0].checked, "下行照常：a 项被取消").toBe(false);
    expect(radios[1].checked, "下行照常：b 项选中").toBe(true);
    expect(fired, "程序化下行不触发 change 监听（无回环）").toBe(0);
  });
});

describe("决策 25 v1.2 bind:group 校验面（dev 错误卡 / prod 分层）", () => {
  it("radio 缺静态 value 属性 → ATR-327 错误卡（组内身份键缺失）", () => {
    const plan = $state("a");
    const c = mountOnce("GroupNoKey", `<input type="radio" name="plan" bind:group={plan}>`, { plan });
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-327");
    expect(findByTag(c, "input").length, "错误卡替换整个元素").toBe(0);
  });

  it("动态 value={} 与空串 value 同样 ATR-327（身份键必须静态非空）", () => {
    const plan = $state("a");
    const dyn = "x";
    const c1 = mountOnce("GroupDynKey", `<input type="radio" value={dyn} bind:group={plan}>`, { plan, dyn });
    expect(serialize(c1)).toContain("ATR-327");
    const c2 = mountOnce("GroupEmptyKey", `<input type="radio" value="" bind:group={plan}>`, { plan });
    expect(serialize(c2)).toContain("ATR-327");
  });

  it("bind:group × 非 radio（缺静态 type / type=checkbox / 动态 type）→ ATR-324 保守拒绝（细化面 message 随真实组合指认）", () => {
    const plan = $state("a");
    const dynType = "radio";
    const c1 = mountOnce("GroupNoType", `<input bind:group={plan}>`, { plan });
    const s1 = serialize(c1);
    expect(s1).toContain("ATR-324");
    expect(s1).toContain("bind:group 于", "细化面指认（非「未知属性指令」兜底文案——红检收紧点）");
    const c2 = mountOnce("GroupCheckboxType", `<input type="checkbox" bind:group={plan}>`, { plan });
    expect(serialize(c2)).toContain("ATR-324");
    expect(serialize(c2)).toContain("bind:group 于");
    const c3 = mountOnce("GroupDynType", `<input type={dynType} bind:group={plan}>`, { plan, dynType });
    expect(serialize(c3)).toContain("ATR-324");
    expect(serialize(c3)).toContain("bind:group 于");
  });

  it("bind:group 于 div → ATR-324（矩阵面 message 指认）；$derived 目标 → ATR-305；非信号 → ATR-324", () => {
    const plan = $state("a");
    const d = $derived(() => "ro");
    const c1 = mountOnce("GroupDiv", `<div bind:group={plan}></div>`, { plan });
    const s1 = serialize(c1);
    expect(s1).toContain("ATR-324");
    expect(s1).toContain("bind:group 于 <div>", "tag 矩阵面指认（红检收紧点）");
    const c2 = mountOnce("GroupDerived", `<input type="radio" value="a" bind:group={d}>`, { d });
    expect(serialize(c2)).toContain("ATR-305");
    const c3 = mountOnce("GroupNonSignal", `<input type="radio" value="a" bind:group={label}>`, { plan, label: "x" });
    expect(serialize(c3)).toContain("ATR-324");
  });

  it("同元素 bind:group + bind:checked（跨名同槽，双写 checked）→ ATR-325 槽位守卫", () => {
    const plan = $state("a");
    const on = $state(false);
    const c = mountOnce(
      "GroupSlotConflict",
      `<input type="radio" value="a" bind:group={plan} bind:checked={on}>`,
      { plan, on },
    );
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-325");
    expect(findByTag(c, "input").length, "错误卡替换整个元素").toBe(0);
  });

  it("同元素重复 bind:group → ATR-325（同名重复，既有语义）", () => {
    const plan = $state("a");
    const c = mountOnce(
      "GroupDup",
      `<input type="radio" value="a" bind:group={plan} bind:group={plan}>`,
      { plan },
    );
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-325");
  });

  it("prod 下 ATR-327：recordRuntimeError 有记录、元素照常渲染、无错误卡、bind 跳过", async () => {
    setLast(undefined);
    setProd(true);
    try {
      const plan = $state("a");
      const c = mountOnce(
        "GroupProd327",
        `<div><input type="radio" name="plan" bind:group={plan}><span>keep</span></div>`,
        { plan },
      );
      await flush();
      expect(findByTag(c, "input").length, "元素照常渲染").toBe(1);
      expect(findByTag(c, "span").length, "兄弟节点不受影响").toBe(1);
      expect(serialize(c).includes("atr-error-card"), "prod 无错误卡").toBe(false);
      expect(getLast()?.code, "recordRuntimeError 有记录（不静默）").toBe("ATR-327");
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });
});

describe("决策 25 v1.2 bind:group __compiledRT.bindGroup 直调契约（codegen 面）", () => {
  it("__compiledRT 增员：bindGroup 为函数", () => {
    expect(typeof (__compiledRT as Record<string, unknown>).bindGroup, "产物零 import 拿到 bindGroup").toBe("function");
  });

  it("tag 矩阵 / $derived / 非信号 → dev 抛对应 ATR 码；prod 不抛 + record + noop dispose", () => {
    const plan = $state("a");
    const d = $derived(() => "ro");
    const scope = { plan, d, label: "x" };
    expect(catchCode(() => __compiledRT.bindGroup(document.createElement("div"), "bind:group", "plan", scope, "div"))).toBe("ATR-324");
    expect(catchCode(() => __compiledRT.bindGroup(document.createElement("input"), "bind:group", "d", scope, "input"))).toBe("ATR-305");
    expect(catchCode(() => __compiledRT.bindGroup(document.createElement("input"), "bind:group", "label", scope, "input"))).toBe("ATR-324");

    setLast(undefined);
    setProd(true);
    try {
      const el = document.createElement("input");
      el.setAttribute("type", "radio");
      el.setAttribute("value", "a");
      const dispose = __compiledRT.bindGroup(el, "bind:group", "label", scope, "input");
      expect(dispose, "prod 不抛，返回 noop dispose").toBeTypeOf("function");
      expect(getLast()?.code, "prod 记录（不静默）").toBe("ATR-324");
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });

  it("槽位守卫（直调）：bind:checked 后 bind:group → dev 抛 ATR-325 不双订；prod 不抛跳过", () => {
    const plan = $state("a");
    const on = $state(false);
    const scope = { plan, on };
    const el = document.createElement("input");
    el.setAttribute("type", "radio");
    el.setAttribute("value", "a");
    __compiledRT.bindTwoWay(el, "bind:checked", "on", scope, "input");
    expect(el.listeners.get("change")?.length ?? 0).toBe(1);
    expect(catchCode(() => __compiledRT.bindGroup(el, "bind:group", "plan", scope, "input"))).toBe("ATR-325");
    expect(el.listeners.get("change")?.length ?? 0, "不建立第二份 checked 槽订阅").toBe(1);

    setProd(true);
    try {
      const el2 = document.createElement("input");
      el2.setAttribute("type", "radio");
      el2.setAttribute("value", "a");
      __compiledRT.bindTwoWay(el2, "bind:checked", "on", scope, "input");
      expect(__compiledRT.bindGroup(el2, "bind:group", "plan", scope, "input"), "prod 不抛，noop").toBeTypeOf("function");
      expect(el2.listeners.get("change")?.length ?? 0).toBe(1);
      expect(getLast()?.code).toBe("ATR-325");
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });

  it("直调 roundtrip：change 上行回写身份键 + 信号外写下行互斥", async () => {
    const plan = $state("a");
    const scope = { plan };
    const el = document.createElement("input");
    el.setAttribute("type", "radio");
    el.setAttribute("value", "b");
    __compiledRT.bindGroup(el, "bind:group", "plan", scope, "input");
    await flush();
    expect(el.checked, "初始：信号 a ≠ 身份键 b → 未选").toBe(false);

    (el as unknown as { checked: boolean }).checked = true;
    el.dispatchEvent({ type: "change" });
    await flush();
    expect(plan.value, "上行：change 回写 = 身份键").toBe("b");

    plan.value = "a";
    await flush();
    expect(el.checked, "下行：信号外写 → 重判取消").toBe(false);
  });

  it("belt 面：直调于无 value 属性的 radio → effect 首跑 record ATR-327 一次、checked 恒 false、不抛", async () => {
    setLast(undefined);
    const plan = $state("a");
    const scope = { plan };
    const el = document.createElement("input");
    el.setAttribute("type", "radio");
    expect(() => __compiledRT.bindGroup(el, "bind:group", "plan", scope, "input"), "运行时 belt 不抛（effect 上下文不可抛——诚实边界）").not.toThrow();
    await flush();
    expect(getLast()?.code, "belt 记录 ATR-327（编译路径无预检的兜底面）").toBe("ATR-327");
    expect(el.checked, "空身份键永不匹配").toBe(false);

    setLast(undefined); // 清掉首跑记录再验「不重复刷屏」
    plan.value = "b";
    await flush();
    plan.value = "a";
    await flush();
    expect((getLast()?.code ?? undefined), "一次性旗标：信号变化不重复刷屏").toBe(undefined);
  });
});

describe("P1-3 bind:group 身份键读取时序（与 attr 书写顺序解耦）", () => {
  it("红检：bind-first 与 value-first 两种书写初始 checked 一致，且无假 ATR-327", async () => {
    setLast(undefined);
    const selBindFirst = $state("a");
    const selValueFirst = $state("a");
    const c = mountOnce(
      "GroupAttrOrder",
      `<input type="radio" bind:group={selBindFirst} value="a"><input type="radio" value="a" bind:group={selValueFirst}>`,
      { selBindFirst, selValueFirst },
    );
    await flush();
    const radios = findByTag(c, "input");
    expect(radios[0].checked, "bind 在前：初始选中（修复前 effect 首跑同步、value 尚未落 → 假 ATR-327 + checked 恒 false）").toBe(true);
    expect(radios[1].checked, "value 在前：初始选中").toBe(true);
    expect(getLast()?.code, "value 属性存在（只是落定在 bind 之后）——不得记假 ATR-327").toBeUndefined();
  });

  it("bind-first radio 的 roundtrip 不受时序影响：change 上行 + 信号下行互斥", async () => {
    const sel = $state("a");
    const c = mountOnce(
      "GroupBindFirstRoundtrip",
      `<input type="radio" bind:group={sel} value="a"><input type="radio" bind:group={sel} value="b">`,
      { sel },
    );
    await flush();
    const radios = findByTag(c, "input");
    expect(radios[0].checked, "初始选中（bind-first）").toBe(true);
    expect(radios[1].checked).toBe(false);

    radios[1].checked = true;
    radios[1].dispatchEvent({ type: "change" });
    await flush();
    expect(sel.value, "上行：change 回写 = 身份键").toBe("b");
    expect(radios[0].checked, "下行：组内互斥重判").toBe(false);
    expect(radios[1].checked).toBe(true);
  });
});
