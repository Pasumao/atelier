/**
 * gen-compile-gate.test.ts — FS-DESIGN §7.3 门禁一「生成后零修改可编译」的自动化（FS-M3 主智能体集成件）。
 *
 * 全链（中间零手改）：atelier init（--no-ai）→ pnpm install（模板 lock，--prefer-offline）
 *   → gen db + gen auth + gen endpoint → tsc 严格诊断必须为 0。
 * 红线：生成物/产物任何 TS 诊断 = 门禁红（生成器类型形态回归的第一道网，Prisma "忘了 generate" 的
 * 反向纪律：regen 之外还必须可编译）。
 * 诚实边界：门禁跑 node 宿主路径（bun:sqlite 分支未覆盖——同 sqlite.ts 既有挂账）；
 * typescript 是框架 devDependency（只服务本门禁，应用零新增依赖——tsconfig 随模板分发）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as ts from "typescript";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const CLI = path.join(PKG, "cli.mjs");

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/** 最小全栈夹具（应用代码的规范形态：契约 satisfies / 端点泛型标注 / SQL 边界显式收口） */
function writeFixtureFiles(root: string): void {
  const w = (rel: string, text: string): void => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text, "utf8");
  };
  // 契约单源追加（模板自带的 src/contract.ts 持有 app.* 契约——门禁追加 chat.* 而非覆写，
  // 与 gen 产物「追加式永不重写」同一纪律；FlatSchema import 随模板自带）
  fs.appendFileSync(
    path.join(root, "src", "contract.ts"),
    `
// —— 门禁追加夹具（chat.*）：契约单源——扁平字面量 + satisfies（字面量推断保持 + 契约形状校验）——
export const chatInputSchema = {
  type: "object",
  reqProps: { chatId: { type: "number" }, content: { type: "string", min: 1 } },
} satisfies FlatSchema;
export const chatMessageSchema = {
  type: "object",
  reqProps: { id: { type: "number" }, chatId: { type: "number" }, role: { type: "string", enum: ["user", "assistant"] }, content: { type: "string" } },
} satisfies FlatSchema;
`
  );
  w(
    "src/server/db/schema.ts",
    `import { table } from "../../vendor/atelier/server/db.ts";

export const messages = table("messages", {
  id: { type: "integer", primaryKey: true },
  chatId: { type: "integer", notNull: true },
  role: { type: "text", notNull: true, enum: ["user", "assistant"] },
  content: { type: "text", notNull: true },
  createdAt: { type: "integer", notNull: true },
});
`
  );
  w(
    "src/server/endpoints/chat.ts",
    `import { defineCommand, defineQuery, type SqliteDb } from "../../vendor/atelier/server/index.ts";
import { chatInputSchema, chatMessageSchema } from "../../contract.ts";

export const chatAsk = defineCommand<{ chatId: number; content: string }, { id: number; chatId: number; role: "user"; content: string }, SqliteDb>("chat.ask", {
  contract: chatInputSchema,
  output: chatMessageSchema,
  emits: ["table:messages"],
  handler: async (input, ctx) => {
    const r = await ctx.db.prepare("INSERT INTO messages (chatId, role, content, createdAt) VALUES (?, ?, ?, ?)").run(input.chatId, "user", input.content, Date.now());
    return { id: Number(r.lastInsertRowid), chatId: input.chatId, role: "user" as const, content: input.content };
  },
});

export const chatList = defineQuery<{ chatId: number; content: string }, { id: number; chatId: number; role: "user" | "assistant"; content: string }, SqliteDb>("chat.list", {
  contract: chatInputSchema,
  output: chatMessageSchema,
  live: { invalidate: ["table:messages"] },
  handler: (input, ctx) => {
    // 手写 SQL 边界显式收口行类型（同生成 crud 的 as PascalRow 纪律）
    const rows = ctx.db.prepare("SELECT id, chatId, role, content FROM messages WHERE chatId = ?").all(input.chatId) as Array<{ id: number; chatId: number; role: "user" | "assistant"; content: string }>;
    return rows[0] ?? { id: 0, chatId: 0, role: "user" as const, content: "" };
  },
});
`
  );
}

function run(cmd: string, args: string[], opts: { cwd?: string; shell?: boolean; env?: NodeJS.ProcessEnv } = {}): void {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, shell: opts.shell ?? false, env: opts.env, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} 失败（exit ${r.status}）：\n${r.stdout?.slice(-2000)}\n${r.stderr?.slice(-2000)}`);
  }
}

describe("gen-compile 门禁（§7.3 门禁一：init → 三生成器 → tsc 零诊断）", () => {
  it(
    "init + install + gen db/auth/endpoint 全链产物 tsc 严格零诊断",
    { timeout: 300_000, retry: 0 },
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-gate-"));
      roots.push(root);

      // ① atelier init（自包含应用，含模板 tsconfig.json 与 vendor 布局）
      run(process.execPath, [CLI, "init", "--target", root, "--name", "GateFs", "--no-ai"]);
      expect(fs.existsSync(path.join(root, "tsconfig.json"))).toBe(true);
      expect(fs.existsSync(path.join(root, "src", "vendor", "atelier", "server", "index.ts"))).toBe(true);

      // ② pnpm install（模板 lock + @types/node——TS 解析 node:crypto 与 vitest 的前提；CI=1 免 TTY 交互）
      const inst = spawnSync("pnpm", ["install", "--prefer-offline"], {
        cwd: root,
        shell: process.platform === "win32",
        env: { ...process.env, CI: "true" },
        encoding: "utf8",
        windowsHide: true,
      });
      const typesDir = path.join(root, "node_modules", "@types", "node");
      if (!fs.existsSync(typesDir)) {
        throw new Error(
          `pnpm install 后 @types/node 缺失（exit ${inst.status}）\nstdout: ${inst.stdout?.slice(-1500)}\nstderr: ${inst.stderr?.slice(-1500)}\npkgdevdeps: ${fs.readFileSync(path.join(root, "package.json"), "utf8").slice(0, 600)}`,
        );
      }

      // ③ 三生成器全跑（中间零手改）
      writeFixtureFiles(root);
      run(process.execPath, [CLI, "gen", "db", "--root", root]);
      run(process.execPath, [CLI, "gen", "auth", "--root", root]);
      run(process.execPath, [CLI, "gen", "endpoint", "--root", root]);

      // ④ tsc 严格诊断 = 0（typescript API 直跑；CompilerHost 的 cwd 必须锚到 fixture——
      //    否则 "types": ["node"] 的默认 typeRoots 解析从 vitest 进程 cwd 走查，永远找不到）
      const cfgPath = path.join(root, "tsconfig.json");
      const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
      expect(cfg.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
      const host = ts.createCompilerHost(parsed.options, /*setParentNodes*/ true);
      host.getCurrentDirectory = () => root;
      const program = ts.createProgram(parsed.fileNames, parsed.options, host);
      const diags = ts.getPreEmitDiagnostics(program);
      const formatted = ts.formatDiagnosticsWithColorAndContext(diags, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (f) => f,
        getNewLine: () => "\n",
      });
      expect(formatted || "(no diagnostics)").toBe("(no diagnostics)");
    },
  );
});
