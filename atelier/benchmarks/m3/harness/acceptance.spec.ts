/**
 * acceptance.spec.ts — M3 自动评分 harness（noskill / skill 臂共用同一评分器）。
 * 由 grade.mjs 驱动：env ATELIER_M3_TASK（task id）+ ATELIER_M3_ATTEMPT（attempt 目录）。
 * 无 env 时（常规 pnpm test 扫到本文件）整体 skip —— 不影响普通测试门。
 * 评分语义：组件契约违规会被 validateFlat 拦成 ATR-201 错误卡 → 断言失败 → grade fail。
 */
import "../../../tests/dom-shim.ts";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initTokens, mountComponent, type ComponentDef } from "../../../runtime/template.ts";
import { validateFlat } from "../../../runtime/contract.ts";
import { streamValue } from "../../../runtime/primitives.ts";
import { findByTag, makeContainer, serialize } from "../../../tests/dom-shim.ts";
import { stripComments } from "./strip-comments.ts";

const TASK = process.env.ATELIER_M3_TASK ?? "";
const ATTEMPT = process.env.ATELIER_M3_ATTEMPT ?? "";

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};
const validate = (schema: unknown, data: Record<string, unknown>) => validateFlat(schema as never, data);

function findByText(root: any, label: string): any {
  const walk = (n: any): any => {
    if (!n) return null;
    if (n.type === "element" && n.childNodes.length > 0 && n.childNodes.every((c: any) => c.type === "text")) {
      if (n.childNodes.map((c: any) => c.data).join("").trim() === label) return n;
    }
    for (const c of n.childNodes ?? []) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
}

async function mount(file: string, name: string, props: Record<string, unknown>) {
  const mod: any = await import(pathToFileURL(path.join(ATTEMPT, "src", "components", file)).href);
  const def = mod[name] as ComponentDef;
  expect(def, `${file} 必须导出 ${name}`).toBeTruthy();
  const container = makeContainer();
  mountComponent(def, props, container, new Map(), validate);
  await flush();
  return { mod, container };
}

(TASK ? describe : describe.skip)(`M3 acceptance [${TASK || "none"}]`, () => {
  it("task 已选定", () => {
    expect(TASK).toMatch(/^task[1-6]-(counter|stream|rollback|agent-cards|txn-board|token-discipline)$/);
    expect(fs.existsSync(ATTEMPT), `attempt 目录存在：${ATTEMPT}`).toBe(true);
  });

  it("task1-counter：契约 + $state + 事件", async () => {
    if (TASK !== "task1-counter") return;
    const { container } = await mount("Counter.atr.ts", "Counter", { start: 5 });
    expect(serialize(container)).toContain('"5"');
    const btn = findByTag(container, "button")[0];
    expect(btn, "模板里要有 <button>").toBeTruthy();
    btn.dispatchEvent({ type: "click" });
    await flush();
    expect(serialize(container)).toContain('"6"');
  });

  it("task2-stream：streamValue 语义 + 禁手写打字机", async () => {
    if (TASK !== "task2-stream") return;
    const src = fs.readFileSync(path.join(ATTEMPT, "src", "components", "StreamCard.atr.ts"), "utf8");
    // 禁令约束行为而非措辞：剥注释后只查代码文本（wave-4 注释复述禁令被误伤的修正）
    expect(stripComments(src), "代码文本中不得使用 setInterval/setTimeout 手写打字机").not.toMatch(
      /setInterval|setTimeout/,
    );
    const first = await mount("StreamCard.atr.ts", "StreamCard", {});
    const sv = first.mod.runDemo();
    expect(sv.done).toBe(true);
    expect(sv.values.length).toBeGreaterThanOrEqual(3);
    expect(sv.values.at(-1)).toBe("完成");
    const sv2 = first.mod.runDemo();
    const { container } = await mount("StreamCard.atr.ts", "StreamCard", { stream: sv2 });
    expect(serialize(container)).toContain("完成");
    expect(serialize(container)).toContain("✓");
  });

  it("task3-rollback：commit→mutate→rollback 回到时点", async () => {
    if (TASK !== "task3-rollback") return;
    const { container } = await mount("RollbackDemo.atr.ts", "RollbackDemo", {});
    const click = async (label: string) => {
      const b = findByText(container, label);
      expect(b, `按钮「${label}」存在`).toBeTruthy();
      b.dispatchEvent({ type: "click" });
      await flush();
    };
    expect(serialize(container)).toContain('"count"');
    expect(serialize(container)).toContain('"1"');
    await click("commit");
    await click("mutate");
    expect(serialize(container)).toContain('"2"');
    await click("rollback");
    expect(serialize(container)).toContain('"1"');
    expect(serialize(container)).not.toContain('"beta"');
  });

  it("task4-agent-cards：流式解析 + keyed each + 状态徽标 + 迟到推送", async () => {
    if (TASK !== "task4-agent-cards") return;
    const mod: any = await import(pathToFileURL(path.join(ATTEMPT, "src", "components", "ToolCallPanel.atr.ts")).href);
    expect(mod.runDemo, "必须导出 runDemo()").toBeTruthy();
    const s = mod.runDemo() as ReturnType<typeof streamValue<string>>;
    const { container } = await mount("ToolCallPanel.atr.ts", "ToolCallPanel", { stream: s });
    const ser = () => serialize(container);
    // 三张卡 + 名字与徽标一一对应
    expect(ser()).toContain('"search"');
    expect(ser()).toContain('"read"');
    expect(ser()).toContain('"write"');
    expect(ser()).toContain('"✓"');
    expect(ser()).toContain('"✗"');
    expect(ser()).toContain('"⏳"');
    // 卡序 = 流序（t1 < t2 < t3）
    const i = (n: string) => ser().indexOf(`"${n}"`);
    expect(i("search")).toBeLessThan(i("read"));
    expect(i("read")).toBeLessThan(i("write"));
    // 迟到推送：流仍在推进时新卡自动出现（流式响应性）
    s.push('{"id":"t4","name":"deploy","status":"done"}');
    await flush();
    expect(ser()).toContain('"deploy"');
  });

  it("task4-agent-cards：乱序流按键复用（DOM 顺序跟随流序）", async () => {
    if (TASK !== "task4-agent-cards") return;
    const s2 = streamValue<string>();
    s2.push('{"id":"t2","name":"read","status":"running"}');
    s2.push('{"id":"t3","name":"write","status":"error"}');
    s2.push('{"id":"t1","name":"search","status":"done"}');
    const { container } = await mount("ToolCallPanel.atr.ts", "ToolCallPanel", { stream: s2 });
    const i = (n: string) => serialize(container).indexOf(`"${n}"`);
    expect(i("read")).toBeLessThan(i("write"));
    expect(i("write")).toBeLessThan(i("search"));
  });

  it("task5-txn-board：父子组合 + store 事务 + 子组件无私有状态", async () => {
    if (TASK !== "task5-txn-board") return;
    const itemMod: any = await import(pathToFileURL(path.join(ATTEMPT, "src", "components", "TxnItem.atr.ts")).href);
    expect(itemMod.TxnItem, "TxnItem.atr.ts 必须导出 TxnItem").toBeTruthy();
    const itemSrc = fs.readFileSync(path.join(ATTEMPT, "src", "components", "TxnItem.atr.ts"), "utf8");
    expect(stripComments(itemSrc), "TxnItem 不得自建 $state（状态上提到父组件）").not.toMatch(/\$state\b/);
    const registry = new Map<string, ComponentDef>();
    registry.set("TxnItem", itemMod.TxnItem);
    const mod: any = await import(pathToFileURL(path.join(ATTEMPT, "src", "components", "TxnBoard.atr.ts")).href);
    expect(mod.TxnBoard, "TxnBoard.atr.ts 必须导出 TxnBoard").toBeTruthy();
    const container = makeContainer();
    mountComponent(mod.TxnBoard, {}, container, registry, validate);
    await flush();
    expect(serialize(container)).toContain('"alpha"');
    expect(serialize(container)).toContain('" ×"');
    const click = async (label: string) => {
      const b = findByText(container, label);
      expect(b, `按钮「${label}」存在`).toBeTruthy();
      b.dispatchEvent({ type: "click" });
      await flush();
    };
    await click("commit");
    await click("add");
    expect(serialize(container)).toContain('"beta"');
    expect(serialize(container)).toContain('"2"');
    await click("rollback");
    expect(serialize(container)).not.toContain('"beta"');
    expect(serialize(container)).not.toContain('"2"');
    expect(serialize(container)).toContain('"alpha"');
  });

  it("task6-token-discipline：token 单源 + ATR-204 + 逃生舱登记", async () => {
    if (TASK !== "task6-token-discipline") return;
    const cfg = JSON.parse(fs.readFileSync(path.join(ATTEMPT, "atelier.config.json"), "utf8"));
    expect(cfg.tokens?.color?.accent, "config 必须新增 tokens.color.accent").toBeTruthy();
    const testSrc = fs.readFileSync(path.join(ATTEMPT, "tests", "styling-discipline.test.ts"), "utf8");
    expect(testSrc).toContain('"PricingCard.atr.ts"'); // SCOPED_ALLOWLIST 已登记
    const src = fs.readFileSync(path.join(ATTEMPT, "src", "components", "PricingCard.atr.ts"), "utf8");
    const style = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(src)?.[1] ?? "";
    expect(style, "组件必须含 <style scoped> 且引用新 token").toContain("var(--color-accent)");
    expect(style).toContain("var(--space-md)");
    // 运行时路径：以 attempt 配置初始化 tokenState 再挂载——引用未定义 token 会渲染 ATR-204 错误卡
    initTokens({ tokens: cfg.tokens });
    const { container } = await mount("PricingCard.atr.ts", "PricingCard", { plan: "Pro" });
    const ser = serialize(container);
    expect(ser).toContain('"Pro"');
    expect(ser).toContain('"●"');
    expect(ser, "出现 ATR-204 = 引用了未定义 token").not.toContain("ATR-204");
  });
});

/** 评分器自测（常驻，无 env 也跑）：stripComments 不许误剥、不许漏剥硬禁词。 */
describe("stripComments — grader self-test", () => {
  it("注释里的禁令字样被剥离（wave-4 误伤复现）", () => {
    expect(stripComments("// 硬禁 setInterval/setTimeout 打字机\nconst a = 1;")).toBe("\nconst a = 1;");
    expect(stripComments("/* setInterval */ const a = 1;")).toBe(" const a = 1;");
  });
  it("字符串/正则/模板串里的构造不误剥为注释", () => {
    expect(stripComments(`const s = "/* not a comment */";`)).toBe(`const s = "/* not a comment */";`);
    expect(stripComments(`const u = "http://x"; // real comment`)).toBe(`const u = "http://x"; `);
    expect(stripComments(`const re = /['"]/; const t = 1;`)).toBe(`const re = /['"]/; const t = 1;`);
    expect(stripComments("const t = `a ${b /* c */} // d` + 1;")).toBe("const t = `a ${b } // d` + 1;");
    // 嵌套模板：TPL→expr→TPL→expr，闭合后各层正文/外层代码都不许被吞
    expect(stripComments("const n = `x${`y${z /*q*/} w`} v`;")).toBe("const n = `x${`y${z } w`} v`;");
  });
  it("真用定时器的代码必须原样留存（硬禁检查仍然有效）", () => {
    expect(stripComments("setTimeout(fn, 100);")).toContain("setTimeout(fn, 100)");
    expect(stripComments("const id = setInterval(tick);")).toContain("setInterval(tick)");
  });
});
