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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
      "ui.screenshot": 60_000, // P2-M5（2026-09-30 复校）：与同端点 snapshot.diff 同档——旧 4s 冷路径首拍必超时（有意变更，红检先行）
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

/* ================================================================== P2-M1/M2/M5（2026-09-30 第三遍架构复校 §2.2） */

describe("P2-M1 MCP 面认证失败恒 ATR-405（R3 402→405 拆分漏改两处的补钉）", () => {
  /** 401 恒答假 dev 面（token 门拒绝——dev 面真实行为 = 401 ATR-405，dev-review.test.ts:514 同款语义） */
  let unauth: http.Server;
  let unauthUrl = "";
  beforeAll(async () => {
    unauth = http.createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "ATR-405: invalid or missing X-Atelier-Token" }));
    });
    await new Promise<void>((r) => unauth.listen(0, "127.0.0.1", r));
    unauthUrl = `http://127.0.0.1:${(unauth.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => unauth.close(() => r()));
  });

  it("dev-token 认证失败恒 405：callDevFaceTool 路径（tokens.list）与 devJson 路径（ui.a11y）都钉——红态：ATR-402 与 confirm 拒绝同码双语义", async () => {
    const root = tmpRoot();
    writeApp(root);
    const ctx = { projectRoot: root, devUrl: unauthUrl, devToken: "wrong-token" };
    try {
      await expect(callTool("tokens.list", {}, ctx)).rejects.toMatchObject({
        atr: { code: "ATR-405", message: expect.stringContaining("dev token rejected") },
      }); // 红态：ATR-402（server.mjs callDevFaceTool 401 映射）
      await expect(callTool("ui.a11y", {}, ctx)).rejects.toMatchObject({
        atr: { code: "ATR-405" },
      }); // 红态：ATR-402（server.mjs devJson 401 映射）
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("REL-A A7 清扫残端：snapshotDiffHandler 直连 /__atelier/screenshot 的 401 → ATR-405（红态：折叠进 ATR-4xx-dev capture failed 族，与三条既有 401 路径口径分裂）", async () => {
    const root = tmpRoot();
    writeApp(root);
    const ctx = { projectRoot: root, devUrl: unauthUrl, devToken: "wrong-token" };
    try {
      for (const name of ["snapshot.diff", "snapshot.review_diff"] as const) {
        const err = await callTool(name, {}, ctx).catch((e: any) => e);
        expect(err?.atr?.code, `红态：${name} 的 401 被 !j.ok 折叠进 capture failed（atr.code = ATR-4xx-dev）`).toBe("ATR-405");
        expect(err?.message).toContain("dev token rejected");
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("P2-M2 ATELIER_TOOLSETS 执行闸：广告面 = 可执行面（单一口径）", () => {
  it("红：TOOLSETS 排除的工具凭名直呼 → ATR-404（红态：绕过广告过滤照常执行）；广告内工具可达；未设 env 全量可用不回归", async () => {
    // 正控（未设 env，既有单源实例）：tasks.update 可达执行层——未注册 task → ATR-401 未找到（非 404 未知工具）
    const root = tmpRoot();
    writeApp(root);
    const control = await callTool("tasks.update", { taskId: "task-none" }, { projectRoot: root, devUrl: baseUrl, devToken: "r3-snapshot-token" }).catch((e: any) => e);
    expect(control?.atr?.code).toBe("ATR-401");

    process.env.ATELIER_TOOLSETS = "query";
    try {
      vi.resetModules();
      const restricted: any = await import("../mcp/server.mjs");
      // operation 面被 TOOLSETS=query 隐藏——凭名直呼必须 ATR-404（红态：分发 Map 命中照常执行 → ATR-401）
      await expect(
        restricted.callTool("tasks.update", { taskId: "task-none" }, { projectRoot: root, devUrl: baseUrl, devToken: "r3-snapshot-token" })
      ).rejects.toMatchObject({ atr: { code: "ATR-404" } });
      // 广告内（query 面）工具照常执行——structure.map 本地直算不受闸扰
      const out = await restricted.callTool("structure.map", { root }, { projectRoot: root, devUrl: baseUrl, devToken: "r3-snapshot-token" });
      expect(out).toBeDefined();
    } finally {
      delete process.env.ATELIER_TOOLSETS;
      vi.resetModules();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("P2-M5 ui.screenshot 超时预算与超时/不可达文案方向", () => {
  it("红：TOOL_META ui.screenshot 与同端点 snapshot.diff 同档（≥30s——dev-screenshot 冷路径看门狗杀常驻浏览器后首拍必超 4s）", () => {
    expect(TOOL_META["ui.screenshot"]?.timeoutMs).toBeGreaterThanOrEqual(30_000); // 红态：4_000
  });

  it("红：fetch 超时单列文案「timed out」（红态：TimeoutError 也被文案化成 unreachable——排查方向指错）；连接拒绝仍「unreachable」", async () => {
    const root = tmpRoot();
    writeApp(root);
    const ctx = { projectRoot: root, devUrl: baseUrl, devToken: "r3-snapshot-token" };
    const realFetch = globalThis.fetch;
    try {
      // 超时分支：AbortSignal.timeout 的拒绝形态 = DOMException name "TimeoutError"
      globalThis.fetch = (async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }) as typeof fetch;
      const timedOut = await callTool("ui.screenshot", {}, ctx).catch((e: any) => e);
      expect(timedOut?.message, "超时分支文案应指「timed out」").toContain("timed out");
      expect(timedOut?.message, "超时分支不得误报 unreachable（红态：指错排查方向）").not.toContain("unreachable");

      // 不可达分支：连接拒绝（cause.code ECONNREFUSED）——既有语义保持
      globalThis.fetch = (async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      }) as typeof fetch;
      const unreachable = await callTool("ui.screenshot", {}, ctx).catch((e: any) => e);
      expect(unreachable?.message).toContain("unreachable");
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(root, { recursive: true, force: true });
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
