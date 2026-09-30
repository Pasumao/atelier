/**
 * compiler-node-guard.test.ts — REL-A A4：compiler Node 版本闸复活（死代码闸 → import 前置闸）。
 *
 * 缺口（任务书 A4）：compiler/dump.mjs 顶层静态 `import ../runtime/template.ts` 先于 main() 内
 * 版本闸求值——Node 22.12~22.17 区间进程在闸前死于 ERR_UNKNOWN_FILE_EXTENSION（无旗标类型剥离
 * 22.18 起才默认开启）；codegen.mjs 连闸都没有。闸的机制修复 = 版本预检（纯函数）先于动态
 * import + ERR_UNKNOWN_FILE_EXTENSION 双保险转同款四段式。
 *
 * 红线（不动地板决策）：package.json engines ≥22.12、README ≥22.12、sqlite.ts ≥22.13 口径
 * 全部原样——本闸只钉「compiler 直载 runtime TS」这一机制的机制地板（22.18 = 类型剥离默认
 * 开启版本，与既有死闸文案一致）。22.12~22.17 语义 = 拒（fail closed：无旗标 import .ts 必死，
 * --experimental-strip-types 存在但未达支持地板）。
 *
 * 诚实边界：本机 Node 无法降级，「22.12 进程真实跑 dump.mjs」不可测——闸行为以合成版本串
 * 单测 + 「无顶层 runtime .ts 静态 import」结构断言钉死（静态 import 在 = 闸必为死代码）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const guard: any = await import("../compiler/node-guard.mjs");
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readCompilerSrc = (f: string) => fs.readFileSync(path.join(PKG, "compiler", f), "utf8");

describe("REL-A A4 nodeSupportsTsImport（纯函数，合成版本串）", () => {
  it("22.11.0 拒 / 22.12.0~22.17.9 拒（engines 地板之上仍拒——类型剥离 22.18 才默认开启，fail closed）", () => {
    expect(guard.nodeSupportsTsImport("22.11.0")).toBe(false);
    expect(guard.nodeSupportsTsImport("22.12.0")).toBe(false);
    expect(guard.nodeSupportsTsImport("22.13.0")).toBe(false);
    expect(guard.nodeSupportsTsImport("22.17.9")).toBe(false);
  });

  it("22.18.0 过（无旗标类型剥离首版）/ 22.x 更高过 / 23.x、24.x 过", () => {
    expect(guard.nodeSupportsTsImport("22.18.0")).toBe(true);
    expect(guard.nodeSupportsTsImport("22.20.1")).toBe(true);
    expect(guard.nodeSupportsTsImport("23.1.2")).toBe(true);
    expect(guard.nodeSupportsTsImport("24.0.0")).toBe(true);
  });

  it("21.x 及以下拒；残缺/垃圾版本串拒（NaN 正向判定 fail closed，绝不误放行）", () => {
    expect(guard.nodeSupportsTsImport("21.9.9")).toBe(false);
    expect(guard.nodeSupportsTsImport("20.18.0")).toBe(false);
    expect(guard.nodeSupportsTsImport("abc")).toBe(false);
    expect(guard.nodeSupportsTsImport("")).toBe(false);
    expect(guard.nodeSupportsTsImport(undefined)).toBe(false);
  });
});

describe("REL-A A4 四段式文案与双保险判别", () => {
  it("nodeGuardMessage：是什么（版本+直载 TS）/ 为什么（ERR_UNKNOWN_FILE_EXTENSION）/ 怎么修（≥22.18、vitest 替代）/ 指路齐", () => {
    const { message, fix } = guard.nodeGuardMessage("22.14.0");
    expect(message).toContain("22.14.0");
    expect(message).toContain("22.18");
    expect(message).toContain("ERR_UNKNOWN_FILE_EXTENSION");
    expect(fix).toContain("22.18");
    expect(fix).toContain("vitest");
    // 22.12~22.17 的旗标逃生门显式指「不走此路」（地板决策不动，闸语义诚实）
    expect(fix).toContain("experimental-strip-types");
  });

  it("isTsExtensionLoadError：code 形态与 message 形态都认；其余错误不误判", () => {
    expect(guard.isTsExtensionLoadError(Object.assign(new Error("x"), { code: "ERR_UNKNOWN_FILE_EXTENSION" }))).toBe(true);
    expect(guard.isTsExtensionLoadError(new Error("ERR_UNKNOWN_FILE_EXTENSION: .ts"))).toBe(true);
    expect(guard.isTsExtensionLoadError(new Error("boom"))).toBe(false);
    expect(guard.isTsExtensionLoadError(Object.assign(new Error("x"), { code: "ERR_MODULE_NOT_FOUND" }))).toBe(false);
    expect(guard.isTsExtensionLoadError(null)).toBe(false);
  });
});

describe("REL-A A4 结构断言：闸必须先于 runtime TS 加载（静态 import 在 = 闸必为死代码）", () => {
  it("dump.mjs / codegen.mjs 均无顶层 runtime/*.ts 静态 import（红态：dump.mjs:40 静态 import 先于 main() 内版本闸；codegen.mjs 连闸都没有）", () => {
    for (const f of ["dump.mjs", "codegen.mjs"]) {
      const src = readCompilerSrc(f);
      expect(src, `${f} 顶层静态 import runtime TS = 闸死代码（Node 22.12~22.17 在闸前死于 ERR_UNKNOWN_FILE_EXTENSION）`).not.toMatch(/^import\s[^;]*from\s+"\.\.\/runtime\/[^"]+\.ts";/m);
      expect(src, `${f} 必须接 node-guard 闸（版本预检先于动态 import）`).toContain("node-guard.mjs");
    }
  });
});
