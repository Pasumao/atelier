/**
 * template-html.test.ts — html`` 标签模板形态守卫（P-A P2-R4）。
 *
 * 修复前 html(strings) 只收首参：①借 apply/call 展开的标签形态参数里 values 被旧签名静默
 * 丢弃——${} 插值无声消失；②作为普通函数调用 html(`a${x}`)（模板字面量先求值成普通字符串）
 * 在 .raw 上抛裸 TypeError——两者都不可诊断。修复后两种误用一律四段式响亮拒绝（ATR-101
 * 解析期显式拒绝家族），标签模板形态语义逐字不变。
 */
import { describe, expect, it } from "vitest";
import { html } from "../runtime/template.ts";

const catchAtr = (fn: () => unknown): { code?: string; message?: string; fix?: string } => {
  try {
    fn();
  } catch (e) {
    return e as { code?: string; message?: string; fix?: string };
  }
  return {};
};

describe("P-A P2-R4：html`` 只支持标签模板形态（误用四段式拒绝，不静默）", () => {
  it("红检：作为普通函数调用 html(`a${x}`) → 四段式 ATR 错误（修复前 .raw 上裸 TypeError，无 code 无 fix）", () => {
    const x = 5;
    const thrown = catchAtr(() => html(`a${x}b` as never));
    expect(thrown.code, "必须是四段式 ATR 错误而非裸 TypeError").toBe("ATR-101");
    expect(String(thrown.message)).toMatch(/插值/);
    expect(String(thrown.fix)).toMatch(/\$\{\}|locals/);
  });

  it("红检：apply/call 转发标签形态参数（values 非空）→ 四段式拒绝（修复前 values 静默丢弃 = ${} 插值无声消失）", () => {
    const strings = Object.assign(["a", "b"], { raw: ["a", "b"] });
    const thrown = catchAtr(() => (html as unknown as (...args: unknown[]) => unknown)(strings, 5));
    expect(thrown.code, "rest 值不得被静默丢弃").toBe("ATR-101");
  });

  it("回归守卫：标签模板形态不受影响（raw 拼接 + .locals 链式注入）", () => {
    const t = html`<p>{n.value}</p>`;
    expect(t.raw).toBe("<p>{n.value}</p>");
    const scoped = t.locals({ n: { value: 3 } });
    expect(scoped.scope).toEqual({ n: { value: 3 } });
    expect(scoped.locals({ m: 1 }).scope).toEqual({ n: { value: 3 }, m: 1 }); // 链式合并语义保持
  });
});
