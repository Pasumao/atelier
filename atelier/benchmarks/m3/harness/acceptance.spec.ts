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
import { mountComponent, type ComponentDef } from "../../../runtime/template.ts";
import { validateFlat } from "../../../runtime/contract.ts";
import { findByTag, makeContainer, serialize } from "../../../tests/dom-shim.ts";

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
    expect(TASK).toMatch(/^task[123]-(counter|stream|rollback)$/);
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
    expect(src).not.toMatch(/setInterval|setTimeout/);
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
});
