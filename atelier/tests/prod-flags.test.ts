/**
 * prod-flags.test.ts — 决策 27 BUILD_PROD 短路旗语义钉子（F-2 prod 剥离 v1 · runtime 分支 A）。
 * 背景见 atelier/docs/design-decisions.md 决策 27：浏览器面构建期 DCE 要求调用点引用模块级
 * 常量绑定（esbuild 只折叠常量条件，不内联函数调用），而模块级 init 捕获会杀死既有运行时
 * 置旗测试——定案 = 调用点统一「构建期常量 || 运行时动态读」双旗形态。本文件钉三件事：
 *   ① dynProd 动态翻转照常生效（静态导入、未注 define：置旗 → prod 行为、复位 → dev 行为）
 *      ——证明调用点现读、init 捕获没有发生，prod-strip 置旗 + afterAll 复位约定全兼容；
 *   ② BUILD_PROD 在无 define 环境为 false（typeof 守卫负例：标识符未注入、求值零
 *      ReferenceError）；正控 = globalThis 预置 + 新模块实例 init 捕获 true（define 通道的
 *      运行时等价模拟——define 注入的正是同名 bare 标识符），且捕获后不随全局翻转（构建期
 *      常量语义，与 dynProd 的现读形成对照）；
 *   ③ 折叠语义静态机检：源码正则断言调用点全部为「构建期常量 || 动态读」形态、旧函数读法
 *      不复存在——防未来改回函数调用/属性访问挡死 esbuild define 折叠 + 分支 DCE。
 */
import "./dom-shim.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { mountComponent } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { validateFlat } from "../runtime/contract.ts";

/** 与 template.ts 逐字同源的守卫声明（测试文件内独立 declare，验证本环境求值语义） */
declare const __ATELIER_BUILD_PROD__: boolean | undefined;

const G = globalThis as { __ATELIER_PROD__?: boolean; __ATELIER_BUILD_PROD__?: boolean };
afterAll(() => {
  G.__ATELIER_PROD__ = false; // 与 prod-strip 同款复位纪律，防污染同进程后续测试
  delete G.__ATELIER_BUILD_PROD__;
});

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};
/** 未注册子组件宿主：ATR-4xx 错误卡（dev）vs 空占位（prod）是旗语义最干净的行为探针 */
function ghostHost(name: string): ComponentDef {
  return { name, render: () => ({ raw: `<section><Ghost /></section>`, scope: {} }) as never };
}

describe("决策 27 runtime 双旗（prod-flags）", () => {
  it("① dynProd 动态翻转照常生效：置旗 prod 行为、复位 dev 行为（证明无 init 捕获）", async () => {
    const reg: ComponentRegistry = new Map();
    const host = ghostHost("FlagsGhostHost");
    reg.set("FlagsGhostHost", host);
    G.__ATELIER_PROD__ = true;
    const prodC = document.createElement("div");
    mountComponent(host, {}, prodC, reg, validateFlat);
    await flush();
    expect(prodC.textContent).not.toContain("ATR-4xx"); // prod：record 后空占位
    G.__ATELIER_PROD__ = false;
    const devC = document.createElement("div");
    mountComponent(host, {}, devC, reg, validateFlat); // 同一模块实例内翻转回 dev
    await flush();
    expect(devC.textContent).toContain("ATR-4xx"); // 错误卡回归 → 调用点现读，无 init 捕获
  });

  it("② 负例：无 define 环境标识符未注入，typeof 守卫求值 false 且零 ReferenceError", () => {
    expect(G.__ATELIER_BUILD_PROD__).toBeUndefined();
    // 与 template.ts BUILD_PROD 定义逐字同源的守卫表达式（本环境 = 无 define 的 vitest 进程）
    expect(typeof __ATELIER_BUILD_PROD__ !== "undefined" && __ATELIER_BUILD_PROD__ === true).toBe(false);
  });

  it("② 正控：globalThis 预置 + 新模块实例 init 捕获 true → 仅凭构建期旗即 prod 行为", async () => {
    const reg: ComponentRegistry = new Map();
    const host = ghostHost("FlagsGhostHostBfp");
    reg.set("FlagsGhostHostBfp", host);
    G.__ATELIER_BUILD_PROD__ = true; // define 注入的运行时等价物（同名 bare 标识符全局在场）
    try {
      const freshSpec = "../runtime/template.ts?bfp=positive"; // query 换新模块实例（init 重求值）
      const fresh = (await import(freshSpec)) as typeof import("../runtime/template.ts");
      // __ATELIER_PROD__ 恒 false：此处 prod 行为只能来自 BUILD_PROD init 捕获
      const c = document.createElement("div");
      fresh.mountComponent(host, {}, c, reg, validateFlat);
      await flush();
      expect(c.textContent).not.toContain("ATR-4xx");
      delete G.__ATELIER_BUILD_PROD__; // 全局撤除后同实例仍 prod = const 一次性捕获（非现读）
      const c2 = document.createElement("div");
      fresh.mountComponent(host, {}, c2, reg, validateFlat);
      await flush();
      expect(c2.textContent).not.toContain("ATR-4xx");
    } finally {
      delete G.__ATELIER_BUILD_PROD__;
    }
  });

  describe("③ 折叠语义静态机检（防改回函数调用挡死 DCE）", () => {
    const src = readFileSync(fileURLToPath(new URL("../runtime/template.ts", import.meta.url)), "utf8");
    it("旧函数读法不复存在（定义与调用点全灭，含注释残留）", () => {
      expect(src).not.toMatch(/\bisProd\b/);
    });
    it("调用点全部为 BUILD_PROD || dynProd() 形态且恰好 8 处（增减调用点须同步改此钉；第 8 处 = 决策 27 集成收口 validateProps 失败卡旗控）", () => {
      expect(src.match(/BUILD_PROD \|\| dynProd\(\)/g)?.length).toBe(8);
    });
    it("__ATELIER_PROD__ 读取仅存 dynProd 单点（无 init 捕获、无散落直读）", () => {
      expect(src.match(/globalThis as \{ __ATELIER_PROD__\?: boolean \}\)\.__ATELIER_PROD__ === true/g)?.length).toBe(1);
    });
    it("守卫定义在位：bare 标识符 + typeof 前置（define 可替换前提，属性访问读法禁返）", () => {
      expect(src).toMatch(/declare const __ATELIER_BUILD_PROD__: boolean \| undefined;/);
      expect(src).toMatch(/const BUILD_PROD = typeof __ATELIER_BUILD_PROD__ !== "undefined" && __ATELIER_BUILD_PROD__ === true;/);
    });
  });
});
