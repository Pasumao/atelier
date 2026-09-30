/**
 * r3-mcp-dispatch.test.ts — R3 收口批（2026-09-30 架构评审 §2.2 风险 2 / §6 批次 R3）：
 *   ① callTool 分发 Map：原 ~430 行七段 if-chain 的名字分派段表化为 TOOL_HANDLERS
 *     （工具名 → handler）+ per-tool 元数据 TOOL_META（超时 ms、参数白名单位、透传位）。
 *     机检不变量：广告实现面 = Map 键集（40 工具一件不缺、一件不幻影）；meta.args ⊆ 广告
 *     schema 键（消费面 ⊆ 广告面——§4.1「广告参数静默丢弃」的反向漂移同被钉死）；长操作
 *     工具必须声明 timeoutMs 且与既有字面值逐字节一致（行为零变化红线）。
 *   ② snapshot.diff per-platform 基线路径（§4.1 末件）：MCP 侧基线路径写死平铺
 *     .atr/snapshots/baseline.png，dev 面/CLI 已平台感知（.atr/snapshots/<platform>/，
 *     scripts/snapshot.mjs m10 批 C 单源）——per-platform 布局下 MCP 侧失明。修法 =
 *     server.mjs 内联平台感知布局纯函数 snapshotLayout（vendor 闭包红线：mcp-vendor.test.ts
 *     机械核对相对 import 闭包 = vendor 名单精确相等，禁新增本地 import——对表
 *     scripts/snapshot.mjs 既有单源，注 MUST stay in sync），基线解析与 CLI 同阶梯：
 *     平台基线胜出 → 旧平铺只读回落（legacy 标记）→ 都缺 = 无基线 note。
 *
 * 纪律（§14.2）：先红后绿——红检阶段 TOOL_HANDLERS / TOOL_META / snapshotLayout 尚不存在，
 * ①②相关用例全红；既有 MCP 全族（mcp-http / mcp-cancel / mcp-confirm / mcp-endpoint-tools /
 * mcp-schema-surface）断言零修改为行为零变化的门。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/* ---------- 被测件（红检阶段命名导出缺失 → 断言红） ---------- */
const serverMjs: any = await import("../mcp/server.mjs");
const { callTool, listTools } = serverMjs;
const { TOOL_HANDLERS, TOOL_META, snapshotLayout } = serverMjs;

const advertised = (listTools() as Array<{ name: string }>).map((t) => t.name);
const schemaOf = (name: string): Record<string, unknown> => {
  const t = (listTools() as Array<{ name: string; inputSchema: unknown }>).find((x) => x.name === name);
  if (!t) throw new Error(`tool not advertised: ${name}`);
  return (t.inputSchema ?? {}) as Record<string, unknown>;
};

describe("R3① callTool 分发 Map：广告实现面 = Map 键集（一件不缺、一件不幻影）", () => {
  it("TOOL_HANDLERS 是 Map，且键集与 tools/list 广告名精确相等（40 工具）", () => {
    expect(TOOL_HANDLERS).toBeInstanceOf(Map);
    const keys = [...TOOL_HANDLERS.keys()].sort();
    expect(keys).toEqual([...advertised].sort());
  });

  it("无幻影 handler：Map 键 ⊆ 广告面（对未广告名注册 handler = 404 兜底被旁路）", () => {
    for (const k of TOOL_HANDLERS.keys()) {
      expect(advertised, `phantom handler: ${k}`).toContain(k);
    }
  });

  it("pending（specified, wiring pending）工具不得入 Map——诚实『未接线』报错不被旁路", () => {
    // 当前 40 工具全部 implemented（本断言为未来新增 pending 工具时的守卫）
    const pending = (listTools() as Array<{ name: string; description: string }>)
      .filter((t) => t.description.includes("(specified, wiring pending)"))
      .map((t) => t.name);
    for (const p of pending) expect(TOOL_HANDLERS.has(p)).toBe(false);
  });

  it("per-tool 元数据（超时 ms）：长 spawn/下游 fetch 型工具必须声明，且与既有字面值逐字节一致", () => {
    expect(TOOL_META).toBeInstanceOf(Object);
    // 字面值 = 收口前各分支内联超时（行为零变化红线——handler 须从本表取值）
    const expected: Record<string, number> = {
      "test.run": 180_000,
      "graph.static": 60_000,
      "checkpoint.source_list": 601_000,
      "checkpoint.source_commit": 601_000,
      "checkpoint.source_rollback": 601_000,
      "diff.report": 30_000,
      "snapshot.diff": 60_000,
      "snapshot.review_diff": 60_000,
      "registry.list_components": 4_000,
      "registry.get_component": 4_000,
      "tokens.list": 4_000,
      "state.snapshot": 4_000,
      "ui.screenshot": 4_000,
    };
    for (const [name, ms] of Object.entries(expected)) {
      expect(TOOL_META[name]?.timeoutMs, `${name} timeoutMs`).toBe(ms);
    }
  });

  it("参数白名单位：meta.args ⊆ 该工具广告 schema 键（消费面 ⊆ 广告面——§4.1 反向漂移同被钉死）", () => {
    for (const [name, meta] of Object.entries(TOOL_META as Record<string, { args?: string[] }>)) {
      if (!Array.isArray(meta.args)) continue;
      const props = (schemaOf(name).properties ?? {}) as Record<string, unknown>;
      for (const key of meta.args) {
        expect(props[key], `${name} consumes unadvertised arg "${key}"`).toBeDefined();
      }
    }
  });

  it("元数据键 ⊆ Map 键（无孤儿元数据）", () => {
    for (const name of Object.keys(TOOL_META as Record<string, unknown>)) {
      expect(TOOL_HANDLERS.has(name), `orphan meta: ${name}`).toBe(true);
    }
  });
});

/* ================================================================== ② snapshot.diff per-platform */

const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "atelier-r3-snapshot-"));
const PNG_A = Buffer.from("png-bytes-alpha");
const PNG_B = Buffer.from("png-bytes-beta");

describe("R3② snapshot.diff 基线路径平台感知（内联纯函数 snapshotLayout，对表 scripts/snapshot.mjs）", () => {
  it("布局形状：.atr/snapshots/<platform>/{baseline,current}.png + 旧平铺 legacyBaseline 只读位（显式 platform 跨平台确定）", () => {
    expect(typeof snapshotLayout).toBe("function");
    const win = snapshotLayout("C:\\app", "win32");
    expect(win.dir).toBe(path.join("C:\\app", ".atr", "snapshots", "win32"));
    expect(win.baseline).toBe(path.join("C:\\app", ".atr", "snapshots", "win32", "baseline.png"));
    expect(win.current).toBe(path.join("C:\\app", ".atr", "snapshots", "win32", "current.png"));
    expect(win.legacyBaseline).toBe(path.join("C:\\app", ".atr", "snapshots", "baseline.png"));
    const linux = snapshotLayout("/app", "linux");
    expect(linux.baseline).toBe(path.join("/app", ".atr", "snapshots", "linux", "baseline.png"));
    expect(linux.legacyBaseline).toBe(path.join("/app", ".atr", "snapshots", "baseline.png"));
  });
});

/* ---------- snapshot.diff 行为：假 dev face（/__atelier/screenshot?compare=1）+ 真落盘基线 ---------- */
let fake: http.Server;
let baseUrl = "";

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const urlPath = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && urlPath === "/__atelier/screenshot") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        imageBase64: PNG_A.toString("base64"),
        threshold: 0.12,
        pixelDiff: { mismatchRatio: 0.5, dimsDiffer: false },
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => fake.close(() => r()));
});

function writeApp(root: string): void {
  fs.mkdirSync(path.join(root, ".atelier"), { recursive: true });
  fs.writeFileSync(path.join(root, "atelier.config.json"), JSON.stringify({ agent: { confirm: "auto" }, tokens: {} }, null, 2));
  fs.writeFileSync(path.join(root, ".atelier", "dev-token"), "r3-snapshot-token", "utf8");
}

const ctxOf = (root: string) => ({ projectRoot: root, devUrl: baseUrl, devToken: "r3-snapshot-token" });

describe("R3② snapshot.diff 行为：基线解析与 CLI 同阶梯（平台胜出 → 平铺只读回落 → 无基线）", () => {
  it("平台基线存在 → 与之比对（MATCH）；current 落平台目录——红态：写死平铺，MCP 侧对平台布局失明", async () => {
    const root = tmpRoot();
    writeApp(root);
    const platDir = path.join(root, ".atr", "snapshots", process.platform);
    fs.mkdirSync(platDir, { recursive: true });
    fs.writeFileSync(path.join(platDir, "baseline.png"), PNG_A);
    try {
      const out = (await callTool("snapshot.diff", {}, ctxOf(root))) as any;
      expect(out.paths.current).toBe(path.join(platDir, "current.png"));
      expect(out.paths.baseline).toBe(path.join(platDir, "baseline.png"));
      expect(out.byteMatch).toBe(true);
      expect(out.verdict).toBe("MATCH");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("仅旧平铺基线存在 → 只读回落比对，paths.legacy 标记——红态：无 legacy 标记位", async () => {
    const root = tmpRoot();
    writeApp(root);
    const flatDir = path.join(root, ".atr", "snapshots");
    fs.mkdirSync(flatDir, { recursive: true });
    fs.writeFileSync(path.join(flatDir, "baseline.png"), PNG_A);
    try {
      const out = (await callTool("snapshot.diff", {}, ctxOf(root))) as any;
      expect(out.paths.baseline).toBe(path.join(flatDir, "baseline.png"));
      expect(out.paths.legacy).toBe(true);
      expect(out.byteMatch).toBe(true);
      expect(out.verdict).toBe("MATCH");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("平台基线胜出旧平铺：两处并存时比对平台基线（不回落）——红态：永远比对平铺（口径分裂实证）", async () => {
    const root = tmpRoot();
    writeApp(root);
    const snapDir = path.join(root, ".atr", "snapshots");
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, "baseline.png"), PNG_B); // 旧平铺 = 另一内容
    const platDir = path.join(snapDir, process.platform);
    fs.mkdirSync(platDir, { recursive: true });
    fs.writeFileSync(path.join(platDir, "baseline.png"), PNG_A); // 平台基线 = 捕获同内容
    try {
      const out = (await callTool("snapshot.diff", {}, ctxOf(root))) as any;
      expect(out.paths.baseline).toBe(path.join(platDir, "baseline.png"));
      expect(out.byteMatch).toBe(true);
      expect(out.verdict).toBe("MATCH");
      expect(out.paths.legacy).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("全无基线 → paths.baseline null + match null + 引导 note（既有语义保持）", async () => {
    const root = tmpRoot();
    writeApp(root);
    try {
      const out = (await callTool("snapshot.diff", {}, ctxOf(root))) as any;
      expect(out.paths.baseline).toBeNull();
      expect(out.match).toBeNull();
      expect(out.note).toContain("no baseline");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
