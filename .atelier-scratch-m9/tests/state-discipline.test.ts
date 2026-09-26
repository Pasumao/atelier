/**
 * state-discipline.test.ts — store 快照语义（决策 5）的护栏。
 *
 * 规则：store.commit 按引用记录信号值，rollback 经 Object.is 判等跳过未变信号——
 * 所以对 $state 的数组/对象做【原地修改】的内容 rollback 恢复不了：
 *   ✗ items.value.push("beta")        ✓ items.value = [...items.value, "beta"]
 *   ✗ user.value.name = "x"           ✓ user.value = { ...user.value, name: "x" }
 *   ✗ items.value[0] = "x"            ✓ items.value = items.value.map((v, i) => i ? v : "x")
 *
 * 扫描对象：src 下全部 .ts（排除 *.spec.ts / *.test.ts / runtime vendor）。
 * 这是静态启发式：漏报可能（如经别名函数的原地改），误报按报错信息改写即可。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function* walkTs(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (e === "node_modules" || e === "runtime" || e.startsWith(".")) continue; // runtime vendor 是框架真相源，不在应用守卫范围
      yield* walkTs(p);
    } else if (e.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(e) && !e.endsWith(".d.ts")) yield p;
  }
}

const ROOT = path.resolve(__dirname, "../src");
const FILES = ROOT && fs.existsSync(ROOT) ? [...walkTs(ROOT)] : [];

/** 原地修改信号值的三类形态（= 后面不许跟 = 或 >，排除 == / => / <= 等） */
const IN_PLACE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\.\s*value\s*\.\s*(?:push|splice|sort|reverse|shift|pop|unshift|fill|copyWithin)\s*\(/, label: "对 .value 调用原地变更方法" },
  { re: /\.\s*value\s*\.\s*[A-Za-z_$][\w$]*\s*=(?![=>])/, label: "对 .value 的属性赋值" },
  { re: /\.\s*value\s*\[[^\]]*\]\s*=(?![=>])/, label: "对 .value 的下标赋值" },
];

describe("state discipline (decision 5 — 快照按引用记录，替换整值而非原地修改)", () => {
  it("src 下存在可扫描的 ts 文件", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it("信号值不得原地修改（rollback 恢不回来）", () => {
    for (const file of FILES) {
      const text = fs.readFileSync(file, "utf8");
      for (const { re, label } of IN_PLACE_PATTERNS) {
        const m = re.exec(text);
        expect(
          m,
          `${path.relative(ROOT, file)}：${label}「${m?.[0]}」——store 快照按引用记录（决策 5），` +
            `原地修改的内容 rollback 恢复不了；请整体替换引用：items.value = [...items.value, x]`,
        ).toBeNull();
      }
    }
  });
});
