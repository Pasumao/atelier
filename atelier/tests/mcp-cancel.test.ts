/**
 * mcp-cancel.test.ts — P1-11 红检（建议书 A6 前半）：MCP 长操作 spawnSync 冻结宿主事件循环、
 * tasks/cancel 对子进程无效。
 *
 * 缺陷（建议书 4.5 P1-11）：mcp/server.mjs callTool 内四处 spawnSync（checkpointCli / graph.static /
 * test.run / diff.report git）经 dev 面 /__atelier/mcp 直接跑在 Vite 进程内——agent 触发
 * checkpoint/test.run 后页面服务/HMR/SSE 全部冻结到子进程结束；http.mjs 的 Tasks 后台化形同
 * 虚设：tasks.mjs run() 微任务里执行的仍是 spawnSync，tasks/cancel 的 abort 对子进程无效
 * （tasks.mjs 旧注释自认「同步段不可中断」）。
 *
 * 修复（本文件钉死的行为契约）：spawnCaptured（child_process.spawn + stdio 流式收集 +
 * 超时/abort 树杀，win32 参照 scripts/bench.mjs 既有 taskkill /T /F 写法）+ callTool 可选
 * opts.signal 透传 + http.mjs run(signal) 接线（Tasks store 的 abort 真正接到子进程 kill）。
 *
 * 红检（先红后绿，§14.2）：
 *   ① 集成——真实 callTool("test.run") 落到睡死 pnpm 脚本上（免真实 180s vitest），由独立
 *      驱动子进程走 HTTP 语义（tools/call → tasks/cancel → tasks/get 轮询）。红证必须从被冻
 *      结进程之外观测（spawnSync 会连测试进程事件循环一起冻住，进程内断言无从发起）：
 *      修前 = tools/call 应答迟到（事件循环被冻结）+ cancel 命中的是已自然完成的任务 +
 *      终态不是 cancelled；修后 = cancel 命中 running 任务、任务即时落 cancelled、睡死子
 *      进程被树杀（pid 消亡铁证，非睡满自然退出）。
 *   ② 单元——spawnCaptured 的超时树杀与 abort 树杀（pid 消亡铁证）。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-mcp-cancel-"));
const APP = path.join(TMP, "app");
const SLEEPER = path.join(TMP, "sleeper.cjs");

/** 睡死进程：落 pidfile（供外部证明「这个 pid 被树杀了」）后挂住指定毫秒数 */
fs.writeFileSync(
  SLEEPER,
  [
    `const fs = require("node:fs");`,
    `if (process.env.SLEEPER_PIDFILE) { try { fs.writeFileSync(process.env.SLEEPER_PIDFILE, String(process.pid), "utf8"); } catch {} }`,
    `setTimeout(() => process.exit(0), Number(process.argv[2] ?? 10000));`,
    "",
  ].join("\n"),
  "utf8",
);

/** test.run 的最小替身应用：pnpm test = 睡死脚本（不装依赖、不起真实 vitest） */
fs.mkdirSync(path.join(APP, ".atelier"), { recursive: true });
fs.writeFileSync(
  path.join(APP, "package.json"),
  JSON.stringify({ name: "atelier-cancel-fixture", private: true, scripts: { test: "node sleeper.cjs" } }, null, 2),
  "utf8",
);
fs.copyFileSync(SLEEPER, path.join(APP, "sleeper.cjs"));
fs.writeFileSync(path.join(APP, "atelier.config.json"), JSON.stringify({ agent: { confirm: "auto" } }, null, 2), "utf8");
fs.writeFileSync(path.join(APP, ".atelier", "dev-token"), "cancel-fixture-token", "utf8");

/** pid 存活探针：树杀成立的铁证 = 进程从运行列表消失。
 * Windows 实测（见本批红检调试）：taskkill /F 后进程对象可因句柄滞留短暂可 OpenProcess——
 * kill0 会假报「存活」，tasklist 的运行列表才是权威存活面；POSIX 以 kill0 的 ESRCH 为准。 */
import { spawn as nodeSpawn } from "node:child_process";
async function pidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (e: any) {
    if (e?.code === "ESRCH") return false;
  }
  if (process.platform !== "win32") return true; // POSIX：kill0 未 ESRCH 视为存活
  return new Promise<boolean>((resolve) => {
    const t = nodeSpawn("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], { windowsHide: true });
    let out = "";
    t.stdout?.on("data", (c) => (out += String(c)));
    t.on("error", () => resolve(true)); // tasklist 不可用时不误判死（保守）
    t.on("close", () => resolve(out.includes(`"${pid}"`)));
  });
}
async function until(fn: () => boolean | Promise<boolean>, ms = 8000, step = 150): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return fn();
}

/* ================================================================== ① 集成：cancel 真终止 */

describe("P1-11 红检①：tasks/cancel 对运行中的 test.run 长任务真终止子进程（驱动子进程外部观测）", () => {
  it(
    "test.run 长任务期间事件循环不被冻结 + cancel 命中 running + 终态 cancelled + 睡死子进程被树杀",
    { timeout: 180_000 },
    async () => {
      const driverPath = path.join(TMP, "cancel-driver.mjs");
      const driverOut = path.join(TMP, "driver-events.jsonl");
      const pidfile = path.join(APP, "sleeper.pid");
      fs.writeFileSync(
        driverPath,
        [
          `import fs from "node:fs";`,
          `const T0 = Date.now();`,
          `const line = (obj) => fs.appendFileSync(process.env.DRIVER_OUT, JSON.stringify(obj) + "\\n");`,
          `const { handleMcpHttp } = await import(process.env.DRIVER_HTTP_MJS);`,
          `const post = async (method, body, name) => {`,
          `  const headers = { "content-type": "application/json", "mcp-method": method };`,
          `  if (name) headers["mcp-name"] = name;`,
          `  return handleMcpHttp(new Request("http://127.0.0.1/__atelier/mcp", { method: "POST", headers, body: JSON.stringify(body) }), { projectRoot: process.env.DRIVER_APP });`,
          `};`,
          `const parse = (r) => JSON.parse(r.body);`,
          `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));`,
          ``,
          `const created = parse(await post("tools/call", { arguments: {} }, "test.run"));`,
          `const task = created.result.task;`,
          `line({ event: "created", t: Date.now() - T0, taskId: task.taskId, taskStatus: task.status });`,
          ``,
          `// 等 pnpm 真把睡死脚本拉起来（pidfile 由 sleeper 落盘）——取消必须命中活着的子进程树`,
          `let pid = null;`,
          `for (let i = 0; i < 150 && pid == null; i++) {`,
          `  try { pid = Number(fs.readFileSync(process.env.DRIVER_PIDFILE, "utf8").trim()); } catch { await sleep(100); }`,
          `}`,
          `line({ event: "sleeper", t: Date.now() - T0, pid });`,
          ``,
          `const before = parse(await post("tasks/get", { taskId: task.taskId })).result;`,
          `line({ event: "before-cancel", t: Date.now() - T0, status: before?.status ?? null });`,
          `const cancelReply = parse(await post("tasks/cancel", { taskId: task.taskId })).result;`,
          `line({ event: "cancel-reply", t: Date.now() - T0, status: cancelReply?.status ?? null });`,
          ``,
          `for (let i = 0; i < 150; i++) {`,
          `  const v = parse(await post("tasks/get", { taskId: task.taskId })).result;`,
          `  if (v && ["completed", "failed", "cancelled"].includes(v.status)) {`,
          `    line({ event: "settled", t: Date.now() - T0, status: v.status });`,
          `    process.exit(0);`,
          `  }`,
          `  await sleep(100);`,
          `}`,
          `line({ event: "no-settle", t: Date.now() - T0 });`,
          `process.exit(2);`,
          "",
        ].join("\n"),
        "utf8",
      );

      // 驱动器是独立进程：修前 callTool 的 spawnSync 冻结的是驱动器自己的事件循环，
      // 时间戳从进程之外读——这正是缺陷的观测位置（进程内断言在冻结期间无从发起）。
      const r = spawnSync(process.execPath, [driverPath], {
        cwd: APP,
        encoding: "utf8",
        timeout: 150_000,
        windowsHide: true,
        env: {
          ...process.env,
          DRIVER_HTTP_MJS: pathToFileURL(path.join(PKG, "mcp", "http.mjs")).href,
          DRIVER_APP: APP,
          DRIVER_OUT: driverOut,
          DRIVER_PIDFILE: pidfile,
          SLEEPER_PIDFILE: pidfile, // sleeper（经 pnpm 继承 env）落 pid 用
          ATELIER_DEV_URL: "http://127.0.0.1:9", // 必死端口：test.run 全程不该 fetch dev 面
        },
      });
      const rows = fs
        .readFileSync(driverOut, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as any);
      const byEvent = (name: string) => rows.filter((row) => row.event === name);
      const created = byEvent("created")[0];
      const sleeper = byEvent("sleeper")[0];
      const beforeCancel = byEvent("before-cancel")[0];
      const cancelReply = byEvent("cancel-reply")[0];
      const settled = byEvent("settled")[0];
      expect(r.status, `驱动器应正常退出（stderr: ${r.stderr}）`).toBe(0);

      expect(created, "driver 应记录 created 事件").toBeTruthy();
      // 红检①：修前 ≈ 10s（tools/call 应答被 spawnSync 冻结到睡死脚本自然退出）；
      // 修后 = Tasks 后台化立即返回句柄（< 5s，含 pnpm 无关的余量）。
      expect(created.t, "红检①：tools/call 应答不被长任务冻结（created < 5s）").toBeLessThan(5000);
      expect(sleeper?.pid, "睡死子进程已被 pnpm 拉起（pidfile 就位）").toBeTruthy();
      // 红检②：修前驱动器恢复控制权时任务早已自然 completed，cancel 是对终态的空操作。
      expect(beforeCancel?.status, "红检②：cancel 命中的是 running 任务").toBe("running");
      expect(cancelReply?.status, "cancel 即落 cancelled 终态").toBe("cancelled");
      expect(settled, "driver 应记录 settled 事件").toBeTruthy();
      // 红检③：修前 settled.status = completed（run 结果照常产出，只是被丢弃视图）。
      expect(settled.status, "红检③：任务终态 cancelled").toBe("cancelled");
      expect(settled.t - cancelReply.t, "取消后立即 settle（子进程被终止，run 不再悬挂）").toBeLessThan(5000);
      // 红检④：睡死子进程被树杀（pid 从运行列表消失），而非睡满 10s 自然退出。
      expect(
        await until(async () => !(await pidAlive(sleeper.pid))),
        "红检④：睡死子进程被树杀（pid 消亡）",
      ).toBe(true);
    },
  );
});

/* ================================================================== ② 单元：spawnCaptured */

const serverMjs = (await import("../mcp/server.mjs")) as any;

describe("P1-11 红检②：spawnCaptured（spawn + 流式收集 + 超时/abort 树杀）", () => {
  it(
    "正常路径：stdout/stderr 流式收集 + 退出码（spawnSync 同构结果形状，调用面最小改动）",
    { timeout: 30_000 },
    async () => {
      const { spawnCaptured } = serverMjs;
      expect(typeof spawnCaptured, "spawnCaptured 应由 server.mjs 导出").toBe("function");
      const r = await spawnCaptured(process.execPath, ["-e", `process.stdout.write("captured-ok"); process.stderr.write("warn-line"); process.exit(0)`]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("captured-ok");
      expect(r.stderr).toContain("warn-line");
      const bad = await spawnCaptured(process.execPath, ["-e", `process.exit(3)`]);
      expect(bad.status).toBe(3);
    },
  );

  it(
    "超时：及时 settle（ETIMEDOUT）且子进程被树杀（pid 消亡）",
    { timeout: 30_000 },
    async () => {
      const { spawnCaptured } = serverMjs;
      expect(typeof spawnCaptured).toBe("function");
      const pidfile = path.join(TMP, "unit-timeout.pid");
      const t0 = Date.now();
      const r = await spawnCaptured(process.execPath, [SLEEPER, "10000"], {
        timeoutMs: 300,
        env: { ...process.env, SLEEPER_PIDFILE: pidfile },
      });
      expect(Date.now() - t0, "超时后及时 settle（不等睡满）").toBeLessThan(5000);
      expect(r.error?.code, "超时以 ETIMEDOUT 标记（spawnSync 同款错误码）").toBe("ETIMEDOUT");
      expect(r.status).toBeNull();
      const pid = Number(fs.readFileSync(pidfile, "utf8").trim());
      // 同步树杀语义：resolution 即树已死（kill 在 timeout 路径内完成后才 settle）
      expect(await until(async () => !(await pidAlive(pid))), "超时子进程被树杀").toBe(true);
    },
  );

  it(
    "abort：外部取消信号触发后子进程被树杀（P1-11 核心——tasks.cancel 的 signal 接到 kill）",
    { timeout: 30_000 },
    async () => {
      const { spawnCaptured } = serverMjs;
      expect(typeof spawnCaptured).toBe("function");
      const pidfile = path.join(TMP, "unit-abort.pid");
      const ac = new AbortController();
      const pending = spawnCaptured(process.execPath, [SLEEPER, "10000"], {
        signal: ac.signal,
        env: { ...process.env, SLEEPER_PIDFILE: pidfile },
      });
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(pidfile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      const pid = Number(fs.readFileSync(pidfile, "utf8").trim());
      expect(await pidAlive(pid), "abort 前子进程活着").toBe(true);
      ac.abort();
      const r = await pending;
      expect(r.error?.code, "abort 以 ABORT_ERR 标记（Node AbortError 同款错误码）").toBe("ABORT_ERR");
      expect(r.status).toBeNull();
      expect(await until(async () => !(await pidAlive(pid))), "abort 后子进程被树杀").toBe(true);
    },
  );
});
