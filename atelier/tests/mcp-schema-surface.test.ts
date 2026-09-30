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
import fs from "node:fs";
import { listTools } from "../mcp/server.mjs";
import { FS6_TOOLS, FS6_CONSUMED_ARGS } from "../mcp/endpoint-tools.mjs";

const DEFS = JSON.parse(fs.readFileSync(new URL("../mcp/mcp-definitions.json", import.meta.url), "utf8")) as {
  tools: Array<{ name: string; params?: { reqProps?: Record<string, unknown>; optProps?: Record<string, unknown> } }>;
};

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

/* ---- P2-M3（2026-09-30 第三遍架构复校 §2.2）：机检扩为双向 ----
 * R3 的 TOOL_META.args ⊆ 广告 只覆盖非 FS6 工具（消费 ⊆ 广告单向），FS6 全族不入 TOOL_META，
 * server.mjs 注释宣称的「FS6 消费面元数据在 endpoint-tools.mjs 单源」实为不存在——
 * endpoint.impact 广告 root 被静默丢弃正是该缺口漏进广告面的实例。目标：FS6 消费面元数据
 * （FS6_CONSUMED_ARGS，consumes + gate 两键）在 endpoint-tools.mjs 单源落档，机检双向：
 * 消费 ∪ 闸 ⊆ 广告（未广告参数不得消费）且 广告 ⊆ 消费 ∪ 闸（幻影广告参数归零）。
 * gate 豁免位 = _approval（endpoint.call 的审批参数由 callTool 公共闸消费剥离，不进 handler）。 */
describe("P2-M3 FS6 消费面元数据：双向机检（消费 ∪ 闸 = 广告，两向都钉）", () => {
  it("FS6 全族：FS6_CONSUMED_ARGS 与广告 schema 键集双向精确相等（红态：元数据不存在 + endpoint.impact root 幻影广告）", () => {
    for (const name of FS6_TOOLS as unknown as Iterable<string>) {
      const meta = (FS6_CONSUMED_ARGS as Record<string, { consumes?: string[]; gate?: string[] }> | undefined)?.[name];
      if (!meta) throw new Error(`FS6 消费面元数据缺失：${name}（红态：FS6_CONSUMED_ARGS 未落档）`);
      const params = DEFS.tools.find((t) => t.name === name)?.params ?? {};
      const advertised = new Set([...Object.keys(params.reqProps ?? {}), ...Object.keys(params.optProps ?? {})]);
      const consumed = new Set([...(meta.consumes ?? []), ...(meta.gate ?? [])]);
      for (const k of consumed) {
        expect(advertised.has(k), `${name} 消费未广告参数 "${k}"`).toBe(true);
      }
      for (const k of advertised) {
        expect(consumed.has(k), `${name} 广告参数 "${k}" 未被任何一方消费（幻影广告——静默丢弃类漂移）`).toBe(true);
      }
    }
  });

  it("endpoint.impact 消费面含 root（红态：广告 root 但实现静默丢弃——R 批宣称清零的幻影参数类存活）", () => {
    const meta = (FS6_CONSUMED_ARGS as Record<string, { consumes?: string[] }> | undefined)?.["endpoint.impact"];
    expect(meta?.consumes, "endpoint.impact 元数据").toBeDefined();
    expect(meta?.consumes).toContain("root");
    expect(meta?.consumes).toContain("contractKey");
  });
});
