/**
 * mcp-schema-surface.test.ts — R3 收口批（2026-09-30 架构评审 §4.1 MCP 契约面根治）：
 *   ① 广告面 = 消费面：dev 面零消费的广告参数（tokens.list.group / state.snapshot.root /
 *      ui.screenshot.format——server.mjs 通用路径本就不构造 query）从 mcp-definitions.json
 *      删除（红态：广告仍在——严格宿主按 schema 校验放行后参数被静默丢弃，契约失真）。
 *   ② flatToJsonSchema min/max → minimum/maximum 翻译（红态：原样 clone——严格宿主校验失效）。
 *   ③ 受闸工具 inputSchema 声明 `_approval`（红态：缺失——additionalProperties:false 的严格
 *      MCP 宿主直接拒绝审批二轮，ask 档在严格宿主上不可用）。
 * listTools() = stdio 与 HTTP 直连同源（server.mjs 单源），断言它即断言两个通道的广告面。
 */
import { describe, expect, it } from "vitest";
import { listTools } from "../mcp/server.mjs";

const schemaOf = (name: string): Record<string, any> => {
  const t = (listTools() as Array<{ name: string; inputSchema: unknown }>).find((x) => x.name === name);
  if (!t) throw new Error(`tool not advertised: ${name}`);
  return t.inputSchema as Record<string, any>;
};

describe("MCP 契约面：广告 = 消费（R3 收口）", () => {
  it("幻影广告参数已删：tokens.list.group / state.snapshot.root / ui.screenshot.format 不再出现在 inputSchema（红态：仍在广告）", () => {
    expect(schemaOf("tokens.list").properties.group).toBeUndefined();
    expect(schemaOf("state.snapshot").properties.root).toBeUndefined();
    expect(schemaOf("ui.screenshot").properties.format).toBeUndefined();
  });

  it("min/max 翻译 minimum/maximum：state.journal.lines / endpoint.journal.lines / tasks.update.ttlMs（红态：min/max 原样透传，严格宿主不识别）", () => {
    const lines = schemaOf("state.journal").properties.lines;
    expect(lines).toMatchObject({ type: "number", minimum: 1, maximum: 500 }); // 红态：{ min: 1, max: 500 }
    expect(lines.min).toBeUndefined();
    expect(lines.max).toBeUndefined();
    const ejLines = schemaOf("endpoint.journal").properties.lines;
    expect(ejLines).toMatchObject({ type: "number", minimum: 1, maximum: 50 });
    const ttl = schemaOf("tasks.update").properties.ttlMs;
    expect(ttl).toMatchObject({ type: "number", minimum: 1 });
    expect(ttl.min).toBeUndefined();
  });

  it("受闸三工具 inputSchema 声明 _approval（严格宿主 additionalProperties:false 下审批二轮可达）", () => {
    for (const name of ["checkpoint.rollback", "state.time_travel", "checkpoint.source_rollback"]) {
      const s = schemaOf(name);
      expect(s.properties._approval, name).toBeDefined(); // 红态：undefined——严格宿主拒绝审批二轮
      expect(s.properties._approval.type).toBe("object");
    }
  });
});
