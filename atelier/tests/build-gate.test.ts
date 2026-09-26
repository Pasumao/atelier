/**
 * build-gate.test.ts — D-F14 `atelier build` 验收（FS-DESIGN §12 自托管单容器产线 v1 两 target）。
 *
 * 全链（零手改，gen-compile-gate 先例）：atelier init（--no-ai）→ pnpm install（--prefer-offline）
 *   → build --target=node --out <tmp>/dist → 产物断言（前端 dist/index.html + 服务端启动壳
 *   dist/server.mjs）→ spawn 产物入口（ATELIER_SERVER_PORT=0）→ 收 ATELIER_SERVER_READY 握手行
 *   → POST /api/app.ping 通（§14.4 验收环同一端点）→ GET / 静态 index.html 通（单容器双面：静态
 *   前端 + /api 同口）→ 收尾杀进程（Windows 孤儿进程零容忍，openapi-golden 同款）。
 *
 * 决策 27 F-2 prod 剥离门（本文件追加，构建链激活三分支之 B）：
 *   · 壳旗标形状：dist/server.mjs 含 `__ATELIER_PROD__ = true` + `await import`（置位先于装配单源
 *     init 的形状证明——静态 import 会 ESM 提升，置位将晚于模块 init 而永远赶不上动态读）；
 *   · 服务面激活实证：spawn 产物后 GET /api/__atelier/server-status → 405 ATR-311（prod 旗下
 *     introspect 路由隐身，journal-subprocess.test.ts prod 负例同款口径——分发器顺序实读，非 404）；
 *   · bundle 标记门（独立 it）：node 产物 assets/*.js 不含 `atr-error-card`（dev 错误卡渲染分支
 *     已被 define DCE；CSS 不检查）与 `__ATELIER_BUILD_PROD__` 残留标识符（折叠后无痕）。
 *     **设计内已知红**：并行 A 分支（runtime/template.ts 调用点 reshape 为 BUILD_PROD || dynProd()）
 *     未合并 → template.ts 无 bare 标识符 → define 无匹配 → 错误卡分支无法常量化 → `atr-error-card`
 *     必然残留。红因抄进提交信息，A 合并后 define 折叠转绿（机检证明 = DCE 前提是 A 的 reshape）；
 *   · 体积 delta 诚实可见：build 出账含「prod 剥离: JS 产物 N 文件共 X KB（define DCE 后）」行
 *     （数字不冻结——只验行存在）。
 *
 * 红证（§14.2 不假红）：
 *   · --target=edge → exit 2 显式拒绝（§12 不做清单：SQLite 数据层与 serverless 天然错配——
 *     拒绝位即文档，绝不静默产出跑不起来的产物）；
 *   · 产物壳入口是 .mjs + 相对 import 应用 .ts（vendor 单源）——本门禁的 spawn 即在验这条链，
 *     壳被手改出框架契约（握手行/port 0 语义）会在此直接红。
 *
 * bun target（本机有 bun 时）：build --target=bun → build 内建冒烟自证跑通 + 测试再独立 spawn
 *   `bun server.mjs` 复验；本机无 bun（当前环境实况）：产物生成 + build 输出诚实标注「未实测」
 *   （挂账既有口径），断言退化为产物存在性——不假绿称实测。
 *
 * skip 策略：宿主 node < 23.6（无默认 type stripping，产物壳 import 应用 .ts 跑不了）→ 整组诚实
 * skip（openapi-golden 同款）。诚实边界：--out 与 vite outDir 的错配（应用自定义 outDir 不传
 * --out）只在 build 侧诚实报错，不在本门禁重复钉；产物不自包含（dist 内相对引用 src/vendor——
 * 单容器整目录部署语义，单文件 exe 归 package/桌面线）由 build 输出文案声明，不机检。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const CLI = path.join(PKG, "cli.mjs");

/** node ≥23.6 才默认 type stripping（产物启动壳要 import 应用 .ts：main-server/vendor 链） */
const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split(".").map(Number);
const TYPE_STRIPPING_OK = NODE_MAJOR! > 23 || (NODE_MAJOR === 23 && NODE_MINOR! >= 6);
const d: typeof describe = TYPE_STRIPPING_OK ? describe : describe.skip;

/* ---------------- fixture：init 出真实应用（模块级共享，it 按序执行） ---------------- */

let root: string | null = null; // fixture 应用目录
const procs: ChildProcess[] = [];

afterAll(async () => {
  for (const p of procs.splice(0)) {
    if (p.exitCode === null && !p.killed) p.kill();
  }
  await Promise.allSettled(procs.map((p) => new Promise((r) => (p.exitCode !== null ? r(null) : p.once("exit", r)))));
  await new Promise((r) => setTimeout(r, 100)); // Windows 句柄释放宽限
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    shell: process.platform === "win32" && cmd !== process.execPath,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** init + install 一次（300s 级，与 gen-compile-gate 同量级；后续 it 复用同一 fixture） */
function ensureFixture(): string {
  if (root) return root;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-build-gate-"));
  const init = run(process.execPath, [CLI, "init", "--target", root, "--name", "BuildGate", "--no-ai"]);
  expect(init.status).toBe(0);
  const inst = run("pnpm", ["install", "--prefer-offline"], { cwd: root, env: { CI: "true" } });
  expect(inst.status).toBe(0);
  return root;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** spawn 产物入口 → 就绪握手行取实际端口（openapi-golden startGoldenServer 同款收尸纪律） */
async function startBuiltServer(entry: string, runtime: "node" | "bun"): Promise<{ port: number; stop: () => Promise<void> }> {
  const cmd = runtime === "bun" ? "bun" : process.execPath;
  const proc = spawn(cmd, [entry], {
    cwd: path.dirname(entry),
    env: { ...process.env, ATELIER_SERVER_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  procs.push(proc);
  let out = "";
  let err = "";
  proc.stdout!.on("data", (c: Buffer) => (out += c.toString("utf8")));
  proc.stderr!.on("data", (c: Buffer) => (err += c.toString("utf8")));
  const deadline = Date.now() + 15_000;
  for (;;) {
    const m = out.match(/^ATELIER_SERVER_READY \{"port":(\d+)\}\r?\n/m);
    if (m) {
      const port = Number(m[1]);
      expect(port).toBeGreaterThan(0);
      return {
        port,
        stop: async () => {
          if (proc.exitCode !== null) return;
          const exited = new Promise<void>((r) => proc.once("exit", () => r()));
          proc.kill();
          await Promise.race([exited, sleep(5_000)]);
          if (proc.exitCode === null) proc.kill("SIGKILL");
          await exited.catch(() => {});
        },
      };
    }
    if (proc.exitCode !== null) throw new Error(`产物入口提前退出（exit ${proc.exitCode}）：\n${out}\n${err}`);
    if (Date.now() > deadline) throw new Error(`产物入口 15s 未就绪：\n${out}\n${err}`);
    await sleep(25);
  }
}

d("D-F14 atelier build：自托管单容器产线（node/bun 两 target + edge 拒绝位）", () => {
  it(
    "全链正控：init → install → build --target=node → 产物 spawn → 握手 → app.ping + 静态 index 双面通",
    { timeout: 300_000, retry: 0 },
    async () => {
      const appDir = ensureFixture();
      const outDir = path.join(appDir, "dist");

      const b = run(process.execPath, [CLI, "build", "--root", appDir, "--target=node", "--out", outDir]);
      expect(b.stderr).toBe("");
      expect(b.status).toBe(0);

      // 产物断言：前端静态面 + 服务端启动壳（单容器两件同口）
      expect(fs.existsSync(path.join(outDir, "index.html"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "server.mjs"))).toBe(true);
      const shellSrc = fs.readFileSync(path.join(outDir, "server.mjs"), "utf8");
      expect(shellSrc).toContain("ATELIER_SERVER_PORT"); // env 三件契约（壳读 env，serve 只收解析值）
      expect(shellSrc).toContain("createAppHandler"); // 装配单源：壳不做第二份端点注册

      // 决策 27 prod 剥离·壳旗标形状：置位 + 先于装配（静态 import 会 ESM 提升——必须 await import）
      expect(shellSrc).toContain("__ATELIER_PROD__ = true");
      expect(shellSrc).toContain("await import");

      // spawn 产物 → 握手 → 双面探活
      const srv = await startBuiltServer(path.join(outDir, "server.mjs"), "node");
      try {
        const ping = await fetch(`http://127.0.0.1:${srv.port}/api/app.ping`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
        expect(ping.status).toBe(200);
        expect((await ping.json() as { ok: boolean }).ok).toBe(true);

        const index = await fetch(`http://127.0.0.1:${srv.port}/`);
        expect(index.status).toBe(200);
        expect(index.headers.get("content-type")).toContain("text/html");
        expect(await index.text()).toContain('<div id="app">');

        // 静态面诚实边界：缺文件 404（不做 SPA fallback——模板单页无客户端路由）
        const missing = await fetch(`http://127.0.0.1:${srv.port}/no-such-asset.js`);
        expect(missing.status).toBe(404);

        // 决策 27 服务面激活实证：prod 旗下 server-status 调试面隐身 → GET 落回 405 ATR-311
        //（journal-subprocess.test.ts prod 负例同款口径——分发器顺序实读，非 404/空数据）
        const hidden = await fetch(`http://127.0.0.1:${srv.port}/api/__atelier/server-status`);
        expect(hidden.status).toBe(405);
        expect(((await hidden.json()) as { code: string }).code).toBe("ATR-311");
      } finally {
        await srv.stop();
      }

      // 运行指引诚实呈现（单容器整目录部署语义 + 端口/env 位可答）
      expect(b.stdout).toContain("server.mjs");
      expect(b.stdout).toContain("ATELIER_DB_PATH");
      // 体积 delta 诚实可见（决策 27：数字不冻结——只验行存在）
      expect(b.stdout).toContain("prod 剥离");
      expect(b.stdout).toContain("（define DCE 后）");
    },
  );

  it(
    "prod 剥离门：node 产物 JS assets 不含 dev 错误卡（atr-error-card）与 define 标识符残留（设计内已知红）",
    { timeout: 60_000, retry: 0 },
    () => {
      const appDir = ensureFixture();
      const assetsDir = path.join(appDir, "dist", "assets"); // 全链正控 it 先跑：node target 产物已在此
      const jsAssets = fs.readdirSync(assetsDir).filter((f) => f.endsWith(".js")); // CSS 不检查（.atr-error-card 样式仍在 = 决策 27 诚实边界）
      expect(jsAssets.length).toBeGreaterThan(0);
      for (const f of jsAssets) {
        const js = fs.readFileSync(path.join(assetsDir, f), "utf8");
        // 已知红红因（抄进提交信息）：并行 A 分支（runtime/template.ts 调用点 reshape 为
        // BUILD_PROD || dynProd()）未合并 → 调用点无 bare 标识符 __ATELIER_BUILD_PROD__ →
        // vite define 无匹配 → dev 错误卡分支（动态 isProd() 守卫）无法常量化 DCE → 字符串必然残留。
        expect(
          js.includes("atr-error-card"),
          `${f} 残留 dev 错误卡渲染分支（atr-error-card）——设计内已知红：A 分支 BUILD_PROD||dynProd() reshape 未合并，define 无匹配可折叠（决策 27），A 合并后转绿`,
        ).toBe(false);
        expect(js.includes("__ATELIER_BUILD_PROD__"), `${f} 残留 define 标识符 __ATELIER_BUILD_PROD__（折叠后应无痕）`).toBe(false);
      }
    },
  );

  it(
    "红证：--target=edge → exit 2 显式拒绝（不做清单即文档，绝不静默产出）",
    { timeout: 60_000, retry: 0 },
    () => {
      const appDir = ensureFixture();
      const r = run(process.execPath, [CLI, "build", "--root", appDir, "--target=edge"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("edge");
      expect(r.stderr).toContain("不做"); // 拒绝理由指向不做清单，fix 可执行（改用 node|bun）
    },
  );

  it(
    "bun target：有 bun → 冒烟自证 + 独立复验；无 bun → 产物生成 + 输出诚实标注未实测（不假绿）",
    { timeout: 120_000, retry: 0 },
    async () => {
      const appDir = ensureFixture();
      const outDir = path.join(appDir, "dist-bun");
      const hasBun = spawnSync("bun", ["--version"], { encoding: "utf8", windowsHide: true }).status === 0;

      const b = run(process.execPath, [CLI, "build", "--root", appDir, "--target=bun", "--out", outDir]);
      expect(b.status).toBe(0);
      expect(fs.existsSync(path.join(outDir, "index.html"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "server.mjs"))).toBe(true);

      if (hasBun) {
        expect(b.stdout).not.toContain("未实测"); // 有 bun 就不许挂账话术
        const srv = await startBuiltServer(path.join(outDir, "server.mjs"), "bun");
        try {
          const ping = await fetch(`http://127.0.0.1:${srv.port}/api/app.ping`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
          expect(ping.status).toBe(200);
        } finally {
          await srv.stop();
        }
      } else {
        expect(b.stdout).toContain("未实测"); // 诚实标注：产物已生成但本机无 bun 未跑通
        expect(b.stdout).toContain("bun"); // 运行指引仍给出（交给有 bun 的宿主）
      }
    },
  );
});
