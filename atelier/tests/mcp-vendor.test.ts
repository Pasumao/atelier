/**
 * mcp-vendor.test.ts — M7 vendor 批：vendored 应用 MCP HTTP 直连（FS-DESIGN §10.2 尾件，
 * M6 尾件批候选池挂账销账）。
 *
 * 挂账原文：应用 dev 面 /__atelier/mcp 现诚实 503 指路 stdio——要直连需 init/sync vendor
 * 整棵依赖树并核对 vendor 布局相对 import。本测试把「整棵依赖树」钉成机械事实：
 *   a. init fixture（--no-ai；vendored MCP 族是零依赖 .mjs——只 import node 内建，无需 pnpm install）；
 *   b. vendor 名单断言：mcp 五件 + mcp-definitions.json + scripts/struct.mjs + gen/impact.mjs
 *      + gen/gen-endpoint.mjs（impact 的传递 import）+ compiler/project-json.mjs +
 *      compiler/extract-schema.mjs（决策 26 schema 提取器）全部落位，
 *      且既有 vendor 语义（dev 面六件 / src/runtime / src/vendor/atelier）不回退；
 *   c. 从应用内 vendored 路径动态 import <app>/mcp/http.mjs——独立 deps 实例驱动 tools/list（40 工具）
 *      与 ping；加打 structure.map 真执行（证明 vendored ../scripts/struct.mjs 相对解析生效）；
 *      devUrl 指向必死端口（:9 discard）——tools/list / ping / 本地工具全程不 fetch 即铁证；
 *   d. 机械闭包核对：从 mcp/http.mjs 走相对 import 传递闭包，可达集合必须与 vendor 名单
 *      （除 fs.readFileSync 数据依赖 mcp-definitions.json）精确相等——新增漏 vendor 即红、减少也红；
 *      extract-schema.mjs 由 dev 插件经 ROOT 相对动态 import 消费（路径是运行时数据而非字面量
 *      import，文本扫描 regex 不可见）→ 作为闭包种子根显式入队（零依赖自包含 → 闭包贡献仅自身）；
 *   e. sync 幂等：破坏名单内文件后重跑 atelier sync——字节恢复等同框架源 + vendored import
 *      照常工作；名单外文件不误删（全量覆盖语义，非镜像删除）。
 *
 * 诚实边界（闭包核对结论，2026-09-25 机械复核）：server.mjs 运行时 spawn 的 ../scripts/checkpoint.mjs
 * （checkpoint.source_* 与 diff.report 工具）与 ../compiler/codegen.mjs（graph.static 工具）不在
 * import 闭包——vendored 应用缺失时走 ATR 结构化报错（诚实降级），不入 vendor 名单；docs.search
 * 语料在 vendored 应用缩为工作区 AGENTS.md + 应用 llms.txt（walk 对缺目录静默跳过）。
 * 真实 vite dev 面端到端（spawn pnpm dev → curl /__atelier/mcp）不在单测面——与既有 mcp-http
 * 测试同形态，dev 插件桥接层以单测 + 集成批手工冒烟覆盖。
 * 纪律（§14.2）：先红后绿——本文件先于 vendor 实现落盘跑红（vendor 文件缺失断言红 + import 失败红）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const CLI = path.join(PKG, "cli.mjs");
const APP = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-mcp-vendor-"));

afterAll(() => {
  fs.rmSync(APP, { recursive: true, force: true });
});

/** vendor 名单（目标应用布局与框架仓相对布局同构；与 init-project.mjs / sync-project.mjs 的
 * MCP 族清单三处同源——任何一处改动必须同步另外两处，test d 的精确相等断言是机检网）。
 * extract-schema.mjs（决策 26）不属 /__atelier/mcp 闭包，由 dev 插件 transform 消费——见 test d。 */
const MCP_VENDOR: Array<[string, string[]]> = [
  ["mcp", ["server.mjs", "http.mjs", "tasks.mjs", "confirm.mjs", "endpoint-tools.mjs", "mcp-definitions.json"]],
  ["scripts", ["struct.mjs"]],
  ["gen", ["impact.mjs", "gen-endpoint.mjs"]],
  ["compiler", ["project-json.mjs", "extract-schema.mjs"]],
];
const VENDOR_FILES = MCP_VENDOR.flatMap(([dir, files]) => files.map((f) => `${dir}/${f}`));
/** import 闭包期望集 = vendor 名单 − mcp-definitions.json（server.mjs 经 HERE + readFileSync 取的数据依赖） */
const EXPECTED_IMPORT_CLOSURE = VENDOR_FILES.filter((f) => f !== "mcp/mcp-definitions.json").sort();

function runCli(args: string[]): void {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) {
    throw new Error(`atelier ${args.join(" ")} 失败（exit ${r.status}）：\n${r.stdout?.slice(-1500)}\n${r.stderr?.slice(-1500)}`);
  }
}

/** 文本层扫相对 import（static `from "..."` + dynamic `import("...")`；node: 内建与裸名不属闭包） */
function scanRelativeImports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.[^"']*)["']/g)].map((m) => m[1]);
}

/** 从 app 内 entry（app 相对路径，可多个种子根）走相对 import 传递闭包。
 * missing = 解析到但应用内不存在（vendor 漏件 / 未来依赖漂移的第一现场）。 */
function walkImportClosure(entryRels: string[]): { reached: string[]; missing: string[] } {
  const seen = new Set<string>();
  const missing: string[] = [];
  const queue = [...entryRels];
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(APP, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    for (const spec of scanRelativeImports(abs)) {
      const target = path.relative(APP, path.resolve(path.dirname(abs), spec)).split(path.sep).join("/");
      if (target.startsWith("..")) {
        missing.push(`${rel} -> ${spec}（越出应用根）`);
        continue;
      }
      queue.push(target);
    }
  }
  return { reached: [...seen].sort(), missing };
}

beforeAll(() => {
  runCli(["init", "--target", APP, "--name", "VendorFs", "--no-ai"]);
  /* 合并窗口桩（schema 批）：框架源 atelier/compiler/extract-schema.mjs 由并行分支 A 落地，
   * 未合并时 init 的名单项 warn+skip（诚实降级）——此处向 fixture 桩入零依赖空实现，让名单/闭包
   * 断言不依赖合并时序；A 合并后 init 真 vendor 该件（桩分支不再触发）。桩仅存在于 tmp fixture。 */
  const scanner = path.join(APP, "compiler", "extract-schema.mjs");
  if (!fs.existsSync(scanner)) {
    fs.mkdirSync(path.dirname(scanner), { recursive: true });
    fs.writeFileSync(scanner, "export function extractComponentDecls() { return []; }\nexport function extractPropsSchemas() { return []; }\n", "utf8");
  }
});

function mcpRequest(method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1/__atelier/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-method": method, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const deps = () => ({ projectRoot: APP, devUrl: "http://127.0.0.1:9", devToken: "vendored-self-contained" });

describe("M7 vendor 批：vendored 应用 MCP HTTP 直连（候选池挂账销账）", () => {
  it("b. init 脚手架含 MCP vendor 全名单（十件）+ 既有 vendor 语义不回退", () => {
    for (const rel of VENDOR_FILES) {
      expect(fs.existsSync(path.join(APP, rel)), `missing vendored file: ${rel}`).toBe(true);
    }
    // 既有名单不回退：dev 面六件 + runtime 两布局
    for (const f of ["atelier-dev-plugin.mjs", "dev-server-host.mjs", "dev-screenshot.mjs", "gen-tailwind-theme.mjs", "dev-review-data.mjs", "dev-review-pages.mjs"]) {
      expect(fs.existsSync(path.join(APP, "scripts", f)), `dev face lost: ${f}`).toBe(true);
    }
    expect(fs.existsSync(path.join(APP, "src", "runtime", "core.ts"))).toBe(true);
    expect(fs.existsSync(path.join(APP, "src", "vendor", "atelier", "server", "index.ts"))).toBe(true);
  });

  it("c. 应用内 vendored http.mjs 动态 import 自成一体：tools/list=40 + ping + structure.map 真执行（devUrl 必死端口不出网）", async () => {
    const mod: any = await import(pathToFileURL(path.join(APP, "mcp", "http.mjs")).href);
    const d = deps();

    const list = (await mod.handleMcpHttp(mcpRequest("tools/list", {}), d)) as any;
    expect(list.status).toBe(200);
    const parsedList = JSON.parse(list.body);
    expect(parsedList.ok).toBe(true);
    const names: string[] = parsedList.result.tools.map((t: any) => t.name);
    expect(names.length).toBe(40);
    expect(names).toContain("tasks.get");

    const ping = (await mod.handleMcpHttp(mcpRequest("ping", {}), d)) as any;
    expect(ping.status).toBe(200);
    expect(JSON.parse(ping.body).result).toEqual({});

    // structure.map 真执行：vendored ../scripts/struct.mjs 相对解析 + 八层守卫跑通应用根
    const map = (await mod.handleMcpHttp(
      mcpRequest("tools/call", { arguments: { root: APP } }, { "mcp-name": "structure.map" }),
      d,
    )) as any;
    expect(map.status).toBe(200);
    const parsedMap = JSON.parse(map.body);
    expect(parsedMap.result.isError, parsedMap.result.content?.[0]?.text).toBe(false);
    expect(JSON.parse(parsedMap.result.content[0].text).summary).toBeTruthy();
  });

  it("d. 机械闭包核对：mcp/http.mjs（+ extract-schema.mjs 种子根）相对 import 传递闭包 ≡ vendor 名单（防未来依赖漂移）", () => {
    // 种子根二：extract-schema.mjs 由 dev 插件经 ROOT 相对动态 import 消费（路径是运行时数据，
    // 文本 regex 不可见）——显式入队后精确相等断言对它双向成立：它新增相对 import（破零依赖
    // 纪律）→ reached 超期望即红；名单漏 vendor → missing 即红。
    const { reached, missing } = walkImportClosure(["mcp/http.mjs", "compiler/extract-schema.mjs"]);
    expect(missing, `vendored 闭包缺件: ${missing.join(", ")}`).toEqual([]);
    expect(reached, "import 闭包与 vendor 名单漂移（两边都红：漏 vendor 与多余依赖）").toEqual(EXPECTED_IMPORT_CLOSURE);
  });

  it("e. sync 幂等：名单内文件破坏后 sync 字节恢复 + vendored import 照常工作；名单外文件不误删", async () => {
    // 破坏：删一个闭包件 + 弄坏一份 + 放一个名单外哨兵（force——红检阶段文件本就不存在也不拦红）
    fs.rmSync(path.join(APP, "compiler", "project-json.mjs"), { force: true });
    fs.writeFileSync(path.join(APP, "mcp", "confirm.mjs"), "// corrupted before sync", "utf8");
    fs.writeFileSync(path.join(APP, "mcp", "extra-sentinel.mjs"), "// not in vendor list", "utf8");

    runCli(["sync", "--target", APP]);

    // 名单内：与框架源字节等同（全量覆盖语义）；框架源自身缺失（分支 A 合并窗口）的名单项
    // 由 init/sync 的 warn+skip 语义保持桩件——字节等同断言随框架源落地自动生效
    for (const rel of VENDOR_FILES) {
      const framework = path.join(PKG, rel);
      if (!fs.existsSync(framework)) continue;
      const vendored = fs.readFileSync(path.join(APP, rel));
      expect(vendored.equals(fs.readFileSync(framework)), `sync 后 ${rel} 与框架源不等同`).toBe(true);
    }
    // 名单外哨兵不误删（覆盖非镜像）
    expect(fs.existsSync(path.join(APP, "mcp", "extra-sentinel.mjs")), "名单外文件不应被 sync 删除").toBe(true);

    // 破坏过的 confirm.mjs 已恢复 → 换新实例（cache-bust）import 照常工作
    const mod: any = await import(pathToFileURL(path.join(APP, "mcp", "http.mjs")).href + `?after-sync=${Date.now()}`);
    const out = (await mod.handleMcpHttp(mcpRequest("tools/list", {}), deps())) as any;
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).result.tools.length).toBe(40);
  });
});
