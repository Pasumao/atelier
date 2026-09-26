/**
 * codegen-prodflags.test.ts — 决策 27 codegen emitComponent 错误卡双旗守卫（M9 codegen strip）。
 *
 * 背景：prod 批给解释器两处错误卡分支包了 BUILD_PROD || dynProd() 守卫（template.ts 组件未注册
 * fallback 卡 / validateProps 失败卡），define 折叠 + 分支 DCE 使 dev 专属分支出 bundle；但
 * codegen emitComponent 发射的同款两处错误卡无旗控——用编译产物的应用在 prod 构建里仍残留
 * atr-error-card 代码（动态不可达但条件非常量，DCE 不掉）。本批把两处发射改为解释器同款双路
 * （语义逐点同构 template.ts:948-955 / :967）：
 *   · 组件未注册：dev = atr-error-card（文案逐字不变）；prod = recordRuntimeError(ATR-401) + 空 span 占位
 *   · validateProps 失败：if (!(rt.BUILD_PROD || rt.dynProd()) && !v.ok) 错误卡；否则照常挂载
 * 双旗通道 = __compiledRT 增员 BUILD_PROD / dynProd（产物零 import 拿旗，产物不 import runtime）。
 *
 * 诚实边界：单测只钉①守卫形态（发射源码字符串级锚定，防未来改回）②运行时行为（动态旗置/复位
 * prod-strip 同款 + query 换新模块实例模拟 BUILD_PROD init 捕获，prod-flags.test.ts 同款）；
 * 真实 vite build 的 define 折叠 + DCE 归构建管线验证（build-gate 模式）。
 */
import "./dom-shim.ts";
import { afterAll, describe, expect, it } from "vitest";
import {
  mountComponent,
  parseTemplate,
  registerCompiled,
  type ComponentDef,
  type ComponentRegistry,
} from "../runtime/template.ts";
import { compileFunction, programSource } from "../compiler/codegen.mjs";
import { validateFlat } from "../runtime/contract.ts";
import { serialize } from "./dom-shim.ts";

const G = globalThis as {
  __ATELIER_PROD__?: boolean;
  __ATELIER_BUILD_PROD__?: boolean;
  __ATELIER_LAST_ERROR__?: { code?: string; message?: string } | undefined;
};
afterAll(() => {
  G.__ATELIER_PROD__ = false; // prod-strip 同款复位纪律，防污染同进程后续测试
  delete G.__ATELIER_BUILD_PROD__;
  delete G.__ATELIER_LAST_ERROR__;
});

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

/* ---------------- fixtures（codegen.test.ts「嵌套组件挂载」同款：schema.fail 分流 validate） ---------------- */

const GHOST_RAW = `<section><Ghost /></section>`;
const BAD_SCHEMA_RAW = `<section><SubBad title="x" /></section>`;

function hostOf(name: string, raw: string): ComponentDef {
  return { name, render: () => ({ raw, scope: {} }) as never };
}

/** schema 违例 fixture：validate 按 schema.fail 分流 → ATR-201（dev 卡 / prod validateProps 早退放行） */
function badRegistry(): ComponentRegistry {
  const reg: ComponentRegistry = new Map();
  reg.set("SubBad", {
    name: "SubBad",
    render: () => ({ raw: `<em>bad</em>`, scope: {} }) as never,
    schema: { fail: true },
  });
  return reg;
}
const failingValidate = (schema: unknown): { ok: boolean; error?: { code: string; message: string; fix: string } } =>
  (schema as { fail?: boolean })?.fail
    ? { ok: false, error: { code: "ATR-201", message: "缺少 props.level", fix: "补上 level" } }
    : { ok: true };

/** 编译路径挂载：registerCompiled(compileFunction) → mountComponent 按 raw 命中快路径 */
function mountCompiled(
  name: string,
  raw: string,
  opts: { registry?: ComponentRegistry; validate?: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown } } = {},
): HTMLElement {
  const container = document.createElement("div");
  registerCompiled(compileFunction(name, raw));
  mountComponent(hostOf(name, raw), { name: "Atelier" }, container, opts.registry ?? new Map(), (opts.validate ?? validateFlat) as never);
  return container;
}

/* ---------------- 发射形态锚定（字符串级，红检素材；防未来改回无旗控发射） ---------------- */

describe("codegen emitComponent 双旗守卫发射形态（字符串级锚定）", () => {
  it("组件未注册分支：错误卡发射处于 !(rt.BUILD_PROD || rt.dynProd()) 守卫内，prod 支发射 recordRuntimeError(ATR-401) + span 占位", () => {
    const body = programSource(parseTemplate(GHOST_RAW));
    // 守卫形态逐字（决策 27 双旗短路语义，与解释器组件未注册支同构；BUILD_PROD/dynProd 经 rt 注入）
    expect(body).toContain(`if (!(rt.BUILD_PROD || rt.dynProd())) {`);
    // prod 支：recordRuntimeError（message 形态照解释器：组件未注册：<tag>，无卡面前后缀）+ 空 span 占位
    expect(body).toContain(`rt.recordRuntimeError({ code: "ATR-401", message: "组件未注册：" + "Ghost" });`);
    expect(body).toContain(`appendChild(document.createElement("span"));`);
    // dev 支错误卡文案逐字保留（与解释器 fallback 卡同文）
    expect(body).toContain(`"ATR-4xx: 组件未注册：" + "Ghost" + "（检查 import 是否只注册于组件文件）"`);
  });

  it("validateProps 失败分支：守卫 = !(rt.BUILD_PROD || rt.dynProd()) && !v.ok（解释器同构），守卫外挂载照旧", () => {
    const body = programSource(parseTemplate(BAD_SCHEMA_RAW));
    expect(body).toContain(`if (!(rt.BUILD_PROD || rt.dynProd()) && !v.ok) {`);
    expect(body).toContain(`errBox.className = "atr-error-card";`);
    expect(body).toContain(`rt.mountComponent(`);
  });
});

/* ---------------- 行为对拍（双旗两态；①③为 dev 回归守卫，②④⑤为 prod 分支行为钉） ---------------- */

describe("codegen emitComponent 双旗行为（编译路径）", () => {
  it("① dev（无旗）+ 组件未注册 → atr-error-card（文案与解释器逐字一致）", async () => {
    const c = mountCompiled("CgGhostDev", GHOST_RAW);
    await flush();
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-4xx: 组件未注册：Ghost（检查 import 是否只注册于组件文件）");
  });

  it("② prod（动态旗）+ 组件未注册 → recordRuntimeError(ATR-401) + 空 span 占位、无错误卡", async () => {
    G.__ATELIER_PROD__ = true;
    delete G.__ATELIER_LAST_ERROR__;
    try {
      const c = mountCompiled("CgGhostProd", GHOST_RAW);
      await flush();
      const s = serialize(c);
      expect(s).not.toContain("atr-error-card");
      expect(s).not.toContain("ATR-4xx");
      expect(s).toContain("<span></span>"); // 空 span 占位（解释器 prod 支同款）
      // recordRuntimeError 单点证据：P2-1 全局最近错误（code/message 与解释器 prod 支同文）
      expect(G.__ATELIER_LAST_ERROR__?.code).toBe("ATR-401");
      expect(G.__ATELIER_LAST_ERROR__?.message).toBe("组件未注册：Ghost");
    } finally {
      G.__ATELIER_PROD__ = false;
      delete G.__ATELIER_LAST_ERROR__;
    }
  });

  it("③ dev（无旗）+ schema 违例 → ATR-201 错误卡（!v.ok 原语义）", async () => {
    const c = mountCompiled("CgBadDev", BAD_SCHEMA_RAW, { registry: badRegistry(), validate: failingValidate });
    await flush();
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-201");
    expect(s).toContain("缺少 props.level");
  });

  it("④ prod（动态旗）+ schema 违例 → validateProps 早退 ok → 正常挂载、无错误卡", async () => {
    G.__ATELIER_PROD__ = true;
    try {
      const c = mountCompiled("CgBadProd", BAD_SCHEMA_RAW, { registry: badRegistry(), validate: failingValidate });
      await flush();
      const s = serialize(c);
      expect(s).not.toContain("atr-error-card");
      expect(s).not.toContain("ATR-201");
      expect(s).toContain("<em>"); // 子组件照常挂载（prod 放行 = 信任「dev 已强制过」的单源契约）
    } finally {
      G.__ATELIER_PROD__ = false;
    }
  });

  it("⑤ 构建期旗（BUILD_PROD）正控：query 换新模块实例 init 捕获 true → 编译路径仅凭构建期旗走 prod 分支", async () => {
    delete G.__ATELIER_LAST_ERROR__;
    G.__ATELIER_BUILD_PROD__ = true; // define 注入的运行时等价物（prod-flags ② 正控同款）
    try {
      const freshSpec = "../runtime/template.ts?cg-bfp=positive"; // query 换新模块实例（init 重求值）
      const fresh = (await import(freshSpec)) as typeof import("../runtime/template.ts");
      // __ATELIER_PROD__ 恒 false：prod 行为只能来自 fresh 实例 __compiledRT.BUILD_PROD 的 init 捕获
      fresh.registerCompiled(compileFunction("CgGhostBfp", GHOST_RAW));
      const c = document.createElement("div");
      fresh.mountComponent(hostOf("CgGhostBfp", GHOST_RAW), {}, c, new Map(), validateFlat as never);
      await flush();
      const s = serialize(c);
      expect(s).not.toContain("atr-error-card");
      expect(s).toContain("<span></span>");
      expect(G.__ATELIER_LAST_ERROR__?.code).toBe("ATR-401");
      // 撤全局后同实例仍 prod = const 一次性捕获（非现读，prod-flags ② 对照同款）
      delete G.__ATELIER_BUILD_PROD__;
      const c2 = document.createElement("div");
      fresh.mountComponent(hostOf("CgGhostBfp", GHOST_RAW), {}, c2, new Map(), validateFlat as never);
      await flush();
      expect(serialize(c2)).not.toContain("atr-error-card");
    } finally {
      delete G.__ATELIER_BUILD_PROD__;
      delete G.__ATELIER_LAST_ERROR__;
    }
  });
});
