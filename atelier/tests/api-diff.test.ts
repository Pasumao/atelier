/**
 * api-diff.test.ts — P3-4 公共 API diff 门禁与漂移度量原型验收：
 * 提取器（runtime 导出/CLI 命令/MCP 工具/token 键/组件契约）· diff 分类（breaking/additive/relaxed/
 * valueDrift）· churn 漂移指标 · allowlist 豁免门禁红绿。
 * 诚实边界：提取器是语法级（正则/括号配对），用例即其语义承诺的边界。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  diffSurfaces,
  extractCliCommands,
  extractComponentContracts,
  extractMcpTools,
  extractRuntimeExports,
  extractTokenKeys,
  judge,
  makeSnapshot,
  matchBrace,
} from "../scripts/api-diff.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atelier-api-diff-"));
}
function write(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, "utf8");
}

describe("matchBrace（引号/注释感知配对）", () => {
  it("字符串与注释里的花括号不参与配对", () => {
    const t = `const a = { x: "}" };`;
    expect(matchBrace(t, t.indexOf("{"))).toBe(t.length - 2);
    const t2 = `{ a: 1 } /* { */ // { trailing`;
    expect(matchBrace(t2, 0)).toBe(7);
  });
  it("转义引号不提前闭合", () => {
    const t = `{ a: "x\\"y{" }`;
    expect(matchBrace(t, 0)).toBe(t.length - 1);
  });
});

describe("提取器（语法级边界即承诺）", () => {
  it("runtime 导出面：value/type/star 三类，去重", () => {
    const dir = tmpDir();
    write(
      path.join(dir, "a.ts"),
      `export { $state, $derived } from "./core.ts";
export type { Signal } from "./core.ts";
export const devFetch = () => {};
export interface FlatSchema {}
export * from "./legacy.ts";`,
    );
    write(path.join(dir, "b.ts"), `export let cache = new Map();`);
    const entries = extractRuntimeExports(dir);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId["$state"].kind).toBe("value");
    expect(byId["Signal"].kind).toBe("type");
    expect(byId["FlatSchema"].kind).toBe("type");
    expect(byId["devFetch"].kind).toBe("value");
    expect(byId["cache"].kind).toBe("value");
    expect(byId["star:./legacy.ts"]).toBeDefined();
    // 同名 value/type 共存时后写覆盖 —— 单一 id，不双计
    expect(entries.filter((e) => e.id === "$state").length).toBe(1);
  });

  it("CLI 命令面：顶层 case 词（含连字符命令），不收非标识符", () => {
    const dir = tmpDir();
    write(
      path.join(dir, "cli.mjs"),
      `switch (cmd) {
  case "init": break;
  case "api-diff": break;
  case "help": break;
  case undefined: break;
  default: break;
}`,
    );
    expect(extractCliCommands(path.join(dir, "cli.mjs")).map((e) => e.id)).toEqual(["api-diff", "help", "init"]);
  });

  it("MCP 工具面：tools[].name", () => {
    const dir = tmpDir();
    write(
      path.join(dir, "mcp-definitions.json"),
      JSON.stringify({ tools: [{ name: "state.snapshot" }, { name: "registry.list_components" }] }),
    );
    expect(extractMcpTools(path.join(dir, "mcp-definitions.json")).map((e) => e.id)).toEqual([
      "registry.list_components",
      "state.snapshot",
    ]);
  });

  it("token 键面：嵌套扁平化，value 随行", () => {
    const dir = tmpDir();
    write(path.join(dir, "atelier.config.json"), JSON.stringify({ tokens: { color: { primary: "#fff" }, space: { xs: "4px" } } }));
    expect(extractTokenKeys(path.join(dir, "atelier.config.json"))).toEqual([
      { id: "color.primary", value: "#fff" },
      { id: "space.xs", value: "4px" },
    ]);
  });

  it("组件契约面：reqProps/optProps 键与类型（字符串内花括号不误配）", () => {
    const dir = tmpDir();
    write(
      path.join(dir, "HelloCard.atr.ts"),
      `export const helloCardSchema = {
  type: "object",
  reqProps: { title: { type: "string" }, rows: { type: "array" } },
  optProps: { start: { type: "number" } },
} as const;
export const HelloCard = component(function HelloCard(props: { title: string }) {
  return html\`<div class="{x}">{props.title}</div>\`;
}, { name: "HelloCard", schema: helloCardSchema });`,
    );
    expect(extractComponentContracts(dir)).toEqual([
      { id: "HelloCard.rows", kind: "req", type: "array" },
      { id: "HelloCard.start", kind: "opt", type: "number" },
      { id: "HelloCard.title", kind: "req", type: "string" },
    ]);
  });
});

describe("diff 分类与门禁语义", () => {
  const base = (surfaces) => ({ surfaces });

  it("removed = breaking（exit 1）；added = additive（exit 0）", () => {
    const d = diffSurfaces(
      base({ "mcp-tools": [{ id: "a" }, { id: "b" }] }),
      base({ "mcp-tools": [{ id: "a" }, { id: "c" }] }),
    );
    expect(d.summary).toMatchObject({ removed: 1, added: 1, breaking: 1, ok: false });
    expect(d.surfaces["mcp-tools"].removed).toEqual(["b"]);
  });

  it("--strict：added 也 fail", () => {
    const d = diffSurfaces(base({ "mcp-tools": [{ id: "a" }] }), base({ "mcp-tools": [{ id: "a" }, { id: "b" }] }), {
      strict: true,
    });
    expect(d.summary.breaking).toBe(0);
    expect(d.summary.ok).toBe(false);
    const j = judge(d);
    expect(j.violations.some((v) => v.kind === "added(strict)")).toBe(true);
  });

  it("导出 kind 变化（value↔type）= changed = breaking", () => {
    const d = diffSurfaces(
      base({ "runtime-exports": [{ id: "Signal", kind: "type" }] }),
      base({ "runtime-exports": [{ id: "Signal", kind: "value" }] }),
    );
    expect(d.summary).toMatchObject({ changed: 1, breaking: 1, ok: false });
  });

  it("契约：类型变化 breaking；req→opt relaxed 放行；opt→req breaking", () => {
    const d = diffSurfaces(
      base({ "component-contracts": [{ id: "C.a", kind: "req", type: "string" }, { id: "C.b", kind: "req", type: "number" }, { id: "C.c", kind: "opt", type: "boolean" }] }),
      base({ "component-contracts": [{ id: "C.a", kind: "req", type: "string[]" }, { id: "C.b", kind: "opt", type: "number" }, { id: "C.c", kind: "req", type: "boolean" }] }),
    );
    expect(d.summary).toMatchObject({ changed: 2, relaxed: 1, breaking: 2, ok: false });
    expect(d.surfaces["component-contracts"].relaxed.map((r) => r.id)).toEqual(["C.b"]);
  });

  it("token：键消失 = breaking；值变化 = valueDrift 信息性放行", () => {
    const d = diffSurfaces(
      base({ "token-keys": [{ id: "color.primary", value: "#111" }, { id: "color.danger", value: "#222" }] }),
      base({ "token-keys": [{ id: "color.primary", value: "#4D6BFE" }] }),
    );
    expect(d.summary).toMatchObject({ removed: 1, valueDrift: 1, breaking: 1, ok: false });
    expect(d.surfaces["token-keys"].valueDrift[0]).toEqual({ id: "color.primary", from: "#111", to: "#4D6BFE" });
  });

  it("--budget：值漂移比例超预算 = 红；未超 = 绿（信息性语义不被预算误伤）", () => {
    const before = base({ "token-keys": [{ id: "a", value: "1" }, { id: "b", value: "2" }, { id: "c", value: "3" }, { id: "d", value: "4" }] });
    const after = base({ "token-keys": [{ id: "a", value: "1" }, { id: "b", value: "2" }, { id: "c", value: "3" }, { id: "d", value: "9" }] });
    const over = diffSurfaces(before, after, { budget: 0.1 });
    expect(over.summary.valueBudgetExceeded).toEqual({ count: 1, total: 4, budget: 0.1 });
    expect(judge(over).violations.some((v) => v.kind === "value-budget")).toBe(true);
    const under = diffSurfaces(before, after, { budget: 0.5 });
    expect(under.summary.ok).toBe(true);
    expect(judge(under).violations).toEqual([]);
    // budget 0 = 冻结：任何值漂移都红
    expect(diffSurfaces(before, after, { budget: 0 }).summary.ok).toBe(false);
  });

  it("churn 漂移率 = 变更条目 / baseline 总条目", () => {
    const d = diffSurfaces(
      base({ "mcp-tools": [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }),
      base({ "mcp-tools": [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "e" }, { id: "f" }] }),
    );
    // removed 1 + added 2 = 3 / 4
    expect(d.summary.churn).toBe(0.75);
  });

  it("allowlist 豁免指定破坏项；未豁免项仍红", () => {
    const d = diffSurfaces(
      base({ "runtime-exports": [{ id: "keep", kind: "value" }, { id: "drop", kind: "value" }] }),
      base({ "runtime-exports": [{ id: "keep", kind: "value" }] }),
    );
    expect(judge(d).violations.map((v) => v.id)).toContain("drop");
    const exempted = judge(d, ["runtime-exports:drop"]);
    expect(exempted.violations).toEqual([]);
    expect(exempted.summary.ok).toBe(false); // summary 不变；放行由 violations 空判定（CLI exit 0 路径）
  });
});

describe("端到端（真实框架仓，自检面）", () => {
  it("框架 root snapshot：四非空面 + check 自身零漂移", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..");
    const snap = makeSnapshot(repoRoot);
    expect(snap.layout).toBe("framework");
    for (const name of ["runtime-exports", "cli-commands", "mcp-tools", "token-keys"]) {
      expect(snap.surfaces[name].length, `${name} 非空`).toBeGreaterThan(0);
    }
    // 自检：对同一仓重复提取，diff 必须零漂移（确定性提取）
    const snap2 = makeSnapshot(repoRoot);
    const d = diffSurfaces(snap, snap2);
    expect(d.summary.churn).toBe(0);
    expect(d.summary.breaking).toBe(0);
  });

  it("应用 root（starter 模板）snapshot：契约面 + token 面", () => {
    const appRoot = path.resolve(import.meta.dirname, "..", "templates", "app");
    const snap = makeSnapshot(appRoot);
    expect(snap.layout).toBe("app");
    const ids = snap.surfaces["component-contracts"].map((e) => e.id);
    expect(ids).toContain("HelloCard.title");
    expect(ids).toContain("HelloCard.start");
  });
});
