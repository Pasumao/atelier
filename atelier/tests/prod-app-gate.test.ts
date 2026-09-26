/**
 * prod-app-gate.test.ts — 决策 27 F-2 prod 剥离 v1·应用模板 dev 装配门静态机检（C 分支）。
 *
 * 纯文本断言（零运行时、不依赖 A/B 分支任何改动，当场绿）：templates/app/src/main.ts 的
 * dev 装配三件（installStateBridge / devFetch 注册表自检 / store.commit 会话锚点）必须整体
 * 位于 `if (import.meta.env.DEV) { … }` 守卫块内；守卫块外不得残留任何 dev 装配调用（负例）；
 * 组件挂载与用户态装配不得被门住（prod 照常渲染）。
 *
 * 机制依据：vite 对 import.meta.env.DEV 做静态替换（build → false → 分支整体 DCE；
 * dev serve → true 照旧）——vite 原生机制，不依赖本批构建链 define/壳预置（A/B）。
 *
 * 诚实边界：本机检只对 main.ts 源码文本——不假设 vite.config.ts define 存在（构建链归 A/B）；
 * DCE 行为级验证（bundle 标记 / 产物冒烟 405 / CDP 证物）归决策 27 门禁三层，此处不重复。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const MAIN = path.join(PKG, "templates", "app", "src", "main.ts");
const SRC = fs.readFileSync(MAIN, "utf8");

/** DEV 守卫行形态（vite 静态替换面；决策 27 ③——注释里裸提 import.meta.env.DEV 不匹配） */
const GUARD = /if\s*\(\s*import\.meta\.env\.DEV\s*\)\s*\{/;

interface DevBlock {
  startLine: number;
  endLine: number;
  lines: string[];
}

/** 逐行花括号配对提取全部 import.meta.env.DEV 守卫块（守卫块体内无字符串内花括号，静态机检够用） */
function extractDevBlocks(src: string): DevBlock[] {
  const lines = src.split("\n");
  const blocks: DevBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!GUARD.test(lines[i])) continue;
    let depth = 0;
    let opened = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") {
          depth++;
          opened = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      if (opened && depth === 0) {
        blocks.push({ startLine: i, endLine: j, lines: lines.slice(i, j + 1) });
        i = j; // 外层 for 的 i++ 会跳过整个已消费块
        break;
      }
    }
  }
  return blocks;
}

const blocks = extractDevBlocks(SRC);
const srcLines = SRC.split("\n");

/** 某行号是否严格位于任一 DEV 守卫块内部（不含守卫行/收尾行本身） */
function insideAnyDevBlock(lineIdx: number): boolean {
  return blocks.some((b) => lineIdx > b.startLine && lineIdx < b.endLine);
}

/** 命中 needle 的全部行号 */
function lineIndexes(needle: string): number[] {
  return srcLines.reduce<number[]>((acc, l, idx) => (l.includes(needle) ? [...acc, idx] : acc), []);
}

/* dev 装配三件（决策 27 ③ 点名件）与用户态装配（组件挂载 + token 加载） */
const DEV_WIRING_CALLS = ["installStateBridge(", "store.commit(", 'devFetch("/__atelier/registry")'];
const USER_STATE_CALLS = ["initTokens(config", "mountComponent(HelloCard", "mountComponent(ContractProbe", "mountComponent(LiveNotes", "mountComponent(FormBinding", "mountComponent(SchemaProbe"];

describe("prod-app-gate（决策 27：main.ts dev 装配门静态机检）", () => {
  it("main.ts 存在 import.meta.env.DEV 守卫块（恰好一个、块体非空、带决策 27 口径注释）", () => {
    expect(blocks.length).toBe(1);
    const block = blocks[0]!;
    expect(block.endLine).toBeGreaterThan(block.startLine + 1); // 块体至少一行
    expect(block.lines.join("\n")).toContain("installStateBridge");
    expect(SRC).toContain("决策 27"); // 口径注释在场（build 时该分支被静态替换剔除）
    expect(SRC).toContain("import.meta.env.DEV");
  });

  it("dev 装配三件（installStateBridge / store.commit / devFetch 自检）全部位于守卫块内", () => {
    const blockLines = blocks[0]!.lines.join("\n");
    for (const call of DEV_WIRING_CALLS) {
      expect(blockLines, `守卫块内应含 ${call}`).toContain(call);
      const idxs = lineIndexes(call);
      expect(idxs.length).toBeGreaterThanOrEqual(1);
      for (const idx of idxs) {
        expect(insideAnyDevBlock(idx), `${call} 出现在守卫块外（行 ${idx + 1}）`).toBe(true);
      }
    }
  });

  it("负例：剥离守卫块后的 main.ts 不含任何 dev 装配调用（import 说明符不按调用计）", () => {
    const outside = srcLines
      .filter((_, idx) => !blocks.some((b) => idx >= b.startLine && idx <= b.endLine))
      .join("\n");
    expect(outside).not.toMatch(/installStateBridge\s*\(/);
    expect(outside).not.toMatch(/store\.commit\s*\(/);
    expect(outside).not.toMatch(/devFetch\s*\(/);
    // 静态 import 面保留（barrel 携带 = 决策 27 诚实边界，不在此解决）
    expect(outside).toContain("installStateBridge");
    expect(outside).toContain("devFetch");
    expect(outside).toContain("store");
  });

  it("组件挂载与用户态装配在场、且全部位于守卫块外（prod 照常渲染的镜像钉）", () => {
    for (const call of USER_STATE_CALLS) {
      const idxs = lineIndexes(call);
      expect(idxs.length, `${call} 应在场（模板不得被改空）`).toBeGreaterThanOrEqual(1);
      for (const idx of idxs) {
        expect(insideAnyDevBlock(idx), `${call} 被关进 DEV 守卫块（行 ${idx + 1}）`).toBe(false);
      }
    }
  });

  it("守卫块内不含组件挂载/用户态调用（三件与挂载零交叉的双向钉）", () => {
    const blockLines = blocks[0]!.lines.join("\n");
    for (const call of USER_STATE_CALLS) {
      expect(blockLines, `守卫块内不应含 ${call}`).not.toContain(call);
    }
  });
});
