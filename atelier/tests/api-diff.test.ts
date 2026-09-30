/**
 * api-diff.test.ts — P3-4 公共 API diff 门禁与漂移度量原型验收：
 * 提取器（runtime 导出/CLI 命令/MCP 工具/token 键/组件契约）· diff 分类（breaking/additive/relaxed/
 * valueDrift）· churn 漂移指标 · allowlist 豁免门禁红绿。
 * 诚实边界：提取器是语法级（正则/括号配对），用例即其语义承诺的边界。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  diffSurfaces,
  extractCliCommands,
  extractComponentContracts,
  extractMcpTools,
  extractOpenApiPaths,
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
  it("openapi 端点面（FS-9 §13 纳管）：paths×method → METHOD+path 排序；x-atelier-* 扩展键不收；文件缺失 = 空面", () => {
    const dir = tmpDir();
    write(
      path.join(dir, "openapi.json"),
      JSON.stringify({
        openapi: "3.0.3",
        paths: {
          "/api/chat.ask": { post: { "x-atelier-kind": "command" } },
          "/api/chat.list": { post: {}, get: { "x-atelier-restful": true } },
        },
      }),
    );
    expect(extractOpenApiPaths(path.join(dir, "openapi.json"))).toEqual([
      { id: "GET /api/chat.list", kind: "get" },
      { id: "POST /api/chat.ask", kind: "post" },
      { id: "POST /api/chat.list", kind: "post" },
    ]);
    expect(extractOpenApiPaths(path.join(dir, "nope.json"))).toEqual([]); // 未导出 OpenAPI 的应用 = 空面不报错
  });

  it("openapi 面 diff：端点删除 = breaking、新增 = additive、method 变化 = removed+added（§13 漂移可见）", () => {
    const base = { openapi: [{ id: "POST /api/a", kind: "post" }, { id: "POST /api/b", kind: "post" }] };
    const removed = diffSurfaces({ surfaces: base }, { surfaces: { openapi: [{ id: "POST /api/a", kind: "post" }] } });
    expect(removed.summary).toMatchObject({ removed: 1, breaking: 1, ok: false });
    const added = diffSurfaces({ surfaces: base }, { surfaces: { openapi: [{ id: "POST /api/a", kind: "post" }, { id: "POST /api/b", kind: "post" }, { id: "GET /api/c", kind: "get" }] } });
    expect(added.summary).toMatchObject({ added: 1, breaking: 0, ok: true });
    const methodChanged = diffSurfaces(
      { surfaces: { openapi: [{ id: "POST /api/a", kind: "post" }] } },
      { surfaces: { openapi: [{ id: "GET /api/a", kind: "get" }] } },
    );
    expect(methodChanged.summary).toMatchObject({ removed: 1, added: 1, breaking: 1, ok: false });
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
    // P-C#8：judge 改显式 strict 传参（修前从 summary.ok 反推——budget 超限同样压 ok=false，
    // 非 strict 的 added 被误标）。行为契约有意变更，调用点随批更新。
    const j = judge(d, [], { strict: true });
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

/* ---------------- P1 #8：基线损坏 = 独立退出码 3（与 usage/缺 baseline 的 2 分离） ----------------
 * 评审 #8：baseline JSON 损坏也 die exit 2，checkpoint 把 2 一律解释为「布局不可判 → vacuous
 * pass」——坏基线静默放行，击穿「未检不锚」。修后：布局不可判/缺 baseline/usage = 2；
 * 基线存在但不可评估（JSON 损坏 / schema 不识别）= 3，checkpoint 对 3 拒锚。 */
describe("P1 #8：基线损坏退出码（CLI 装配面，spawn 真实脚本）", () => {
  const SCRIPT = path.resolve(import.meta.dirname, "..", "scripts", "api-diff.mjs");

  it("红检：baseline JSON 截断 → exit 3 + stderr 指认损坏；缺 baseline 仍 exit 2（既有语义不回退）", () => {
    const dir = tmpDir();
    const bad = path.join(dir, "api-surface.json");
    fs.writeFileSync(bad, '{"schemaVersion":1,"surfaces":{"mcp-tools":[{"id":"a"}', "utf8"); // 截断
    const r = spawnSync(process.execPath, [SCRIPT, "check", "--root", dir, "--baseline", bad, "--json"], { encoding: "utf8", windowsHide: true });
    expect(r.status).toBe(3); // 修复前：2——被 checkpoint 解释为 vacuous pass
    expect(r.stderr).toContain("baseline");
    expect(r.stderr).toContain("api-diff snapshot"); // fix 指路再基线化

    const missing = spawnSync(process.execPath, [SCRIPT, "check", "--root", dir, "--baseline", path.join(dir, "nope.json")], { encoding: "utf8", windowsHide: true });
    expect(missing.status).toBe(2); // 缺 baseline = usage 级，语义不变
    expect(missing.stderr).toContain("缺 baseline");
  });

  it("红检：JSON 合法但 schema 不识别（schemaVersion 缺失 / surfaces 非对象）→ exit 3", () => {
    const dir = tmpDir();
    const bogus = path.join(dir, "api-surface.json");
    fs.writeFileSync(bogus, JSON.stringify({ hello: "not a snapshot" }), "utf8");
    const r = spawnSync(process.execPath, [SCRIPT, "check", "--root", dir, "--baseline", bogus], { encoding: "utf8", windowsHide: true });
    expect(r.status).toBe(3); // 修复前：diffSurfaces 当空面处理 → 可能 vacuous 放行（exit 0/2）
  });
});

/* ---------------- P-C#8 + P2-C6（第三遍架构复校 §3 拉入 / §2.3） ----------------
 * P-C#8：judge strict 反推——修前 added 违规判定依赖 `summary.ok === false && breaking === 0`：
 *   ① 仅 --budget 超限时 ok 同样为 false → 非 strict 的 added 被误标 added(strict)；
 *   ② --strict + removed 时 breaking > 0 → added 漏标且永不走豁免环（--allow 无法豁免 added）。
 * 修法：strict 显式传参（judge(diff, allow, { strict })），added 同样走豁免环。
 * P2-C6：--allow 文件缺失/坏档/无 accepted 键 → 静默按空表（typo 路径零提示，文案还说
 *   「未在 allowlist 中豁免」）。修法：die 2 指路径（与基线损坏 exit 3 同一诚实纪律）。 */
describe("P-C#8：judge strict 反推修正（显式 strict + added 走豁免环）", () => {
  const base = (surfaces) => ({ surfaces });

  it("红检①：--budget 超限不误标 added（judge 不得从 summary.ok 反推 strict）", () => {
    const before = base({
      "token-keys": [{ id: "a", value: "1" }, { id: "b", value: "2" }, { id: "c", value: "3" }, { id: "d", value: "4" }],
      "mcp-tools": [{ id: "t1" }],
    });
    const after = base({
      "token-keys": [{ id: "a", value: "1" }, { id: "b", value: "2" }, { id: "c", value: "3" }, { id: "d", value: "9" }],
      "mcp-tools": [{ id: "t1" }, { id: "t2" }], // added——非 strict
    });
    const d = diffSurfaces(before, after, { budget: 0.1 }); // 值漂移超预算（非 strict）
    expect(d.summary.ok).toBe(false);
    expect(d.summary.breaking).toBe(0);
    const j = judge(d);
    expect(j.violations.filter((v) => v.kind === "added(strict)"), "修前：ok=false 被 反推 为 strict → added 误标").toEqual([]);
    expect(j.violations.some((v) => v.kind === "value-budget")).toBe(true); // budget 违规照报
  });

  it("红检②：--strict + removed 时 added 同样标违规且走豁免环", () => {
    const d = diffSurfaces(
      base({ "mcp-tools": [{ id: "keep" }, { id: "drop" }] }),
      base({ "mcp-tools": [{ id: "keep" }, { id: "fresh" }] }),
      { strict: true },
    );
    // 修前：breaking=1（removed）→ strict 块整体跳过 → added 漏标；--allow 豁免 removed 后 added 仍不可见
    const exemptRemoved = judge(d, ["mcp-tools:drop"], { strict: true });
    expect(exemptRemoved.violations.some((v) => v.kind === "added(strict)" && v.id === "fresh")).toBe(true);
    const exemptBoth = judge(d, ["mcp-tools:drop", "mcp-tools:fresh"], { strict: true });
    expect(exemptBoth.violations, "added 必须走豁免环（--allow 可豁免 added(strict)）").toEqual([]);
  });

  it("非 strict 时 added 恒不标违规（显式 strict 参数缺省 false，不加违规）", () => {
    const d = diffSurfaces(
      base({ "mcp-tools": [{ id: "a" }] }),
      base({ "mcp-tools": [{ id: "a" }, { id: "b" }] }),
    );
    expect(judge(d).violations).toEqual([]);
  });
});

describe("P2-C6：--allow 文件缺失/坏档 → die 2 指路径（不再静默按空表）", () => {
  const SCRIPT = path.resolve(import.meta.dirname, "..", "scripts", "api-diff.mjs");

  /** 最小 app 布局（detectLayout = app：src/components + atelier.config.json）+ 空 baseline → diff 零漂移 */
  function makeAppRoot() {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "src", "components"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".atelier"), { recursive: true });
    fs.writeFileSync(path.join(dir, "atelier.config.json"), JSON.stringify({ tokens: {} }), "utf8");
    fs.writeFileSync(
      path.join(dir, ".atelier", "api-surface.json"),
      JSON.stringify({ schemaVersion: 1, generatedAt: "t", root: "x", layout: "app", surfaces: {} }) + "\n",
      "utf8",
    );
    return dir;
  }

  it("红检：--allow 指向不存在路径 → exit 2 + stderr 指路径（修前 exit 0 静默空表）", () => {
    const dir = makeAppRoot();
    const r = spawnSync(process.execPath, [SCRIPT, "check", "--root", dir, "--allow", path.join(dir, "nope-allow.json")], { encoding: "utf8", windowsHide: true });
    expect(r.status).toBe(2); // 修复前：readJson→null ?.accepted ?? [] 静默空表 → exit 0
    expect(r.stderr).toContain("--allow");
    expect(r.stderr).toContain("nope-allow.json");
    expect(r.stderr).toContain("fix:");
  });

  it("红检：--allow 是无 accepted 键的合法 JSON → exit 2 指认形态", () => {
    const dir = makeAppRoot();
    const allowFile = path.join(dir, "allow.json");
    fs.writeFileSync(allowFile, JSON.stringify({ exempted: ["mcp-tools:x"] }), "utf8"); // 键名拼错
    const r = spawnSync(process.execPath, [SCRIPT, "check", "--root", dir, "--allow", allowFile], { encoding: "utf8", windowsHide: true });
    expect(r.status).toBe(2); // 修复前：静默空表 exit 0——拼错键名假装「无破坏」
    expect(r.stderr).toContain("accepted");
    expect(r.stderr).toContain("fix:");
  });

  it("回归：--allow 形态正确且 accepted 真实豁免 → 照常 exit 0（守卫不误伤正常豁免）", () => {
    const dir = makeAppRoot();
    const allowFile = path.join(dir, "allow.json");
    fs.writeFileSync(allowFile, JSON.stringify({ accepted: [] }), "utf8");
    const r = spawnSync(process.execPath, [SCRIPT, "check", "--root", dir, "--allow", allowFile], { encoding: "utf8", windowsHide: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PASS");
  });
});
