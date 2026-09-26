/**
 * tsgo-parity.test.ts — D-F18「tsgo 双跑」落地（FS-DESIGN §19 拍板项 + §14.2 测试纪律）：
 * 类型守卫测试对**同一 fixture** 分别跑 tsc --noEmit 与 tsgo --noEmit，钉住两者的诊断行为差。
 *
 * fixture 链与 gen-compile-gate.test.ts 同款（init --no-ai → pnpm install → 门禁夹具 →
 * gen db/auth/endpoint，中间零手改）——该链覆盖框架全量产物形态（vendor runtime / 生成器产物 /
 * 模板组件 / 契约 satisfies / 泛型端点标注），是行为差观测的最小真实面。链体复制自
 * gen-compile-gate（不改绿测文件；两守卫各自持有 fixture，语义等价、零共享状态）。
 *
 * 钉住口径（§14.2 不假绿——首跑实测即有差异，如实钉住而非放宽）：
 *   实测（2026-09-25，tsc 5.9.3 vs tsgo 7.0.0-dev.20260707.2）：
 *     · tsc：0 诊断（gen-compile-gate 既有零诊断口径）；
 *     · tsgo：2 × TS2882（src/main.ts 对 ./atelier-tailwind.css / ./atelier-ui.css 的
 *       side-effect import，tsgo 新增的副作业导入检查——tsc 不报）。
 *   留痕（2026-09-26，tsgo 7.0.0-dev.20260707.2）：决策 27 F-2 prod 剥离 C 分支为 main.ts 的
 *     import.meta.env.DEV 装配门补了模板标准件 src/vite-env.d.ts（`/// <reference types="vite/client" />`，
 *     create-vite 脚手架同款，init 整目录拷贝自动随模板走）——vite/client 自带 `*.css` ambient
 *     模块声明，恰好满足 tsgo 的副作业导入检查，上述 2 × TS2882 差异消失；golden 收窄为空集
 *     （双跑全 parity）。属模板补齐标准 vite 类型面的正向收窄，非放宽口径；此后 tsc/tsgo 任何
 *     翻面差异（重现/新码/换文件）照旧即红。
 *   断言钉住的是差异集（{file, code} 对，语义身份粒度）而非诊断文案：only-in-tsc 必须为空、
 *   only-in-tsgo 必须恰等于上述 golden——tsgo/TS 升级翻出任何新差异（新码/新文件/消失）即红，
 *   人工复核后更新 golden 并记录（这正是 D-F18「钉住行为差」的作业方式：差异不隐瞒、不假绿，
 *   升级翻面必须留痕）。
 *
 * D-F18 建议原文是「CI 条件作业」，本落地以「钉版 devDependency + skipIf」替代其机制：
 * tsgo 随框架 devDependencies 进 `pnpm install --frozen-lockfile`，CI matrix（ubuntu/windows ×
 * node 22/24）跑全套 pnpm test 时本测试**天然双跑**，无需独立 job；平台二进制经包自身的
 * optionalDependencies（win32/linux/darwin × x64/arm64）随锁文件分发。skipIf 诚实兜底：
 * tsgo 不可用的环境整组 skip（不假绿、不假装跑过）。
 *
 * 诚实边界：tsgo 是 preview 质量钉版（@typescript/native-preview 7.0.0-dev.20260707.2，
 * 无 ^——preview 版次间诊断集可能翻动，golden 钉住机制即兜底）；tsgo 对模板 CSS 副作业导入
 * 报 TS2882 曾属模板×编译器交互（如实钉住），2026-09-26 决策 27 批补齐标准件 src/vite-env.d.ts
 * 后差异自然消失（见上留痕）；fixture 跑 node 宿主路径（bun:sqlite 分支同 sqlite.ts 既有挂账）。
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
const TSGO_BIN = path.join(PKG, "node_modules", "@typescript", "native-preview", "bin", "tsgo");
const TSGO_OK = fs.existsSync(TSGO_BIN);

/** 钉住的 tsgo-only 诊断差异集（{file, code} 对；file 相对 fixture root、posix 斜杠、按序）
 *  2026-09-26 收窄为空集：src/vite-env.d.ts（vite/client）的 `*.css` ambient 声明消除了既有
 *  2 × TS2882（CSS 副作业导入）tsgo-only 差异——留痕见文件头。 */
const PINNED_TSGO_ONLY: Array<{ file: string; code: string }> = [];

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/** 门禁夹具（与 gen-compile-gate.test.ts 同链同源：契约单源追加 chat.* + 端点泛型标注规范形态） */
function writeFixtureFiles(root: string): void {
  const w = (rel: string, text: string): void => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text, "utf8");
  };
  fs.appendFileSync(
    path.join(root, "src", "contract.ts"),
    `
// —— 守卫追加夹具（chat.*）：契约单源——扁平字面量 + satisfies（字面量推断保持 + 契约形状校验）——
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

/** 诊断行解析：`<file>(line,col): error TSxxxx: message` → {file（相对 root、posix）、code} 有序对 */
function parseDiagnostics(out: string, root: string): Array<{ file: string; code: string }> {
  const out2: Array<{ file: string; code: string }> = [];
  for (const m of out.matchAll(/^\s*(.+?)\((\d+),(\d+)\):\s*(?:error|warning)\s+(TS\d+):/gm)) {
    const abs = m[1]!.replace(/\\/g, "/");
    const rel = path.relative(root, abs).split(path.sep).join("/");
    out2.push({ file: rel, code: m[4]! });
  }
  return out2;
}

describe.skipIf(!TSGO_OK)("D-F18 tsgo 双跑：同一 fixture tsc/tsgo 诊断行为差钉住（§19 / §14.2）", () => {
  it(
    "init → install → gen 三件 → 同一夹具 tsc 0 诊断 + tsgo 差异集 ≡ 钉住 golden",
    { timeout: 300_000, retry: 0 },
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-tsgo-parity-"));
      roots.push(root);

      // ① init（自包含应用：模板 tsconfig / vendor 布局 / 模板组件与 CSS 副作业导入——
      //    TS2882 曾在此观测；2026-09-26 起 vite-env.d.ts 的 ambient 声明已消除该差异）
      run(process.execPath, [CLI, "init", "--target", root, "--name", "TsgoParityFs", "--no-ai"]);
      expect(fs.existsSync(path.join(root, "tsconfig.json"))).toBe(true);

      // ② pnpm install（模板 lock + @types/node；CI=1 免 TTY——gen-compile-gate 同款）
      spawnSync("pnpm", ["install", "--prefer-offline"], {
        cwd: root,
        shell: process.platform === "win32",
        env: { ...process.env, CI: "true" },
        encoding: "utf8",
        windowsHide: true,
      });
      expect(fs.existsSync(path.join(root, "node_modules", "@types", "node"))).toBe(true);

      // ③ 三生成器全跑（中间零手改）
      writeFixtureFiles(root);
      run(process.execPath, [CLI, "gen", "db", "--root", root]);
      run(process.execPath, [CLI, "gen", "auth", "--root", root]);
      run(process.execPath, [CLI, "gen", "endpoint", "--root", root]);

      // ④ tsc 侧：typescript API 直跑（gen-compile-gate 门禁同口径——CompilerHost cwd 锚 fixture）
      const cfgPath = path.join(root, "tsconfig.json");
      const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
      expect(cfg.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
      const host = ts.createCompilerHost(parsed.options, /*setParentNodes*/ true);
      host.getCurrentDirectory = () => root;
      const program = ts.createProgram(parsed.fileNames, parsed.options, host);
      const tscDiags = ts.getPreEmitDiagnostics(program);
      const tscFormatted = ts.formatDiagnosticsWithColorAndContext(tscDiags, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (f) => f,
        getNewLine: () => "\n",
      });
      expect(tscFormatted || "(no diagnostics)").toBe("(no diagnostics)"); // 既有零诊断口径
      const tscSet = tscDiags.map((dg) => ({
        file: path.relative(root, dg.file?.fileName ?? "?").split(path.sep).join("/"),
        code: `TS${dg.code}`,
      }));

      // ⑤ tsgo 侧：@typescript/native-preview 钉版子进程（bin/tsgo 为 node 启动器——跨平台 spawn）
      const tsgoPkg = JSON.parse(fs.readFileSync(path.join(PKG, "node_modules", "@typescript", "native-preview", "package.json"), "utf8")) as { version: string };
      const r = spawnSync(process.execPath, [TSGO_BIN, "--noEmit", "--pretty", "false", "-p", cfgPath], {
        encoding: "utf8",
        windowsHide: true,
      });
      const tsgoSet = parseDiagnostics(r.stdout ?? "", root);
      // tsgo 非零退出却解析不出诊断 = 崩溃/形态变更——诚实炸出原始输出，绝不静默当 0 诊断
      if (r.status !== 0 && tsgoSet.length === 0) {
        throw new Error(`tsgo ${tsgoPkg.version} exit ${r.status} 且无可解析诊断（形态变更？）：\nstdout: ${r.stdout?.slice(-2000)}\nstderr: ${r.stderr?.slice(-2000)}`);
      }

      // ⑥ 行为差 delta（双向）钉住：only-in-tsc 空 + only-in-tsgo ≡ golden
      const count = (xs: Array<{ file: string; code: string }>) => {
        const m = new Map<string, number>();
        for (const x of xs) m.set(`${x.file}|${x.code}`, (m.get(`${x.file}|${x.code}`) ?? 0) + 1);
        return m;
      };
      const delta = (a: Array<{ file: string; code: string }>, b: Array<{ file: string; code: string }>) => {
        const ca = count(a);
        const cb = count(b);
        const out: string[] = [];
        for (const [k, n] of ca) {
          const rest = n - (cb.get(k) ?? 0);
          for (let i = 0; i < rest; i++) out.push(k);
        }
        return out.sort();
      };
      const tsgoOnly = delta(tsgoSet, tscSet);
      const tscOnly = delta(tscSet, tsgoSet);
      // 差异集钉住（语义身份粒度 {file, code}——诊断文案措辞不钉，升缤断码/换文件/消失即红）
      expect(tscOnly, `tsc 报而 tsgo 不报（双跑第一守卫方向，tsgo ${tsgoPkg.version}）：${tscOnly.join(", ") || "(none)"}`).toEqual([]);
      expect(
        tsgoOnly,
        `tsgo 报而 tsc 不报的行为差（tsgo ${tsgoPkg.version}）≠ 钉住 golden：${tsgoOnly.join(", ") || "(none)"}——复核后更新 PINNED_TSGO_ONLY 并留痕`,
      ).toEqual(PINNED_TSGO_ONLY.map((x) => `${x.file}|${x.code}`).sort());
    },
  );
});
