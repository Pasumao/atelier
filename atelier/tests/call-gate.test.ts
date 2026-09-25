/**
 * call-gate.test.ts — D-F15 `atelier call` 验收（FS-DESIGN §14.4 端点工作循环的 CLI 验证环：
 * specs 验收命令直接可执行——「atelier call/try-it 验证」一步落地为子进程可跑的真命令）。
 *
 * harness：**spawn 子进程**起真实 server（openapi-golden 先例——同一 node-host serve() 单源，
 * port 0 + ATELIER_SERVER_READY 握手行取实际端口；fixture 内联 .ts 直跑需 Node ≥23.6 type
 * stripping，否则整组诚实 skip）。被测对象 = 子进程 `node atelier/cli.mjs call …`（真实 CLI 面）。
 * 为什么不 in-process serve：vitest worker 线程内的 node:http server 监听成功但请求分发悬挂
 * （standalone 同代码 19ms 正常——worker 事件循环与 undici 客户端的组合问题），子进程形态与
 * dev 托管/产物部署同构，恰好也是被验语义本身。
 *
 * 逐例断言（§14.2 红检先红后绿，红证不假红——致敏法：call.mjs 未落地时本文件整体红）：
 *   正控 × query：gate.ping → exit 0 + stdout 是合法 JSON + 响应字段真实（handler 值回传）；
 *   正控 × command：gate.echo '{"msg":"hi"}' → exit 0 + upper 派生值（输入过契约校验路径）；
 *   红证 × 未知端点：ATR-310 结构化错误上 stderr + exit 1（§15 错误码语义贯通到 CLI 通道）；
 *   红证 × 契约违规：min:1 违约 → ATR-201 上 stderr + exit 1（agent 看得见的结构化拒因）；
 *   红证 × server 不可达：ATR-403 形态结构化错误 + fix 指路 pnpm dev + exit 1（不静默、不 spawn——
 *     诚实边界：call 是验收环不是托管环，起 server 归 atelier dev / 产物自证归 build）；
 *   红证 × JSON 实参坏 / 非法端点名：usage 级 exit 2（不出网——坏输入在客户端即拦）；
 *   专项 × --timeout（M6-A 诚实边界关闭，2026-09-25 回填）：fixture 造慢端点（墙钟 sleep 超过
 *     时限）→ call 以极小 --timeout 打它 → ATR-403「无响应」形态 + 报出实际时限 + fix 指路
 *     --timeout 放宽 + exit 1（AbortSignal.timeout 路径）。红检替代=对照留证（同请求行为分流）：
 *     ①同端点无 --timeout（默认 10s）→ exit 0 正常返回——排除端点/server 本身坏；
 *     ②快端点 + 同样极小 --timeout → exit 0——超时是墙钟对响应等待，不是「小时限」本身；
 *     ③错误文案分流——timeout 路径「无响应」+「--timeout」fix，不含不可达路径的「pnpm dev」
 *     fix（call.mjs catch 内两个分支的措辞即分流观测点）。
 *
 * 诚实边界：--mount 自定义
 * 值走的是 resolveServerConfig 同款归一逻辑，单测不重复钉（dev-server-host.test.ts 已钉）。
 * 纪律（§14.2）：全 127.0.0.1、listen 一律 port 0；afterAll 杀子进程收尸后才删临时目录（Windows
 * 孤儿进程零容忍，openapi-golden 同款）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const CLI = path.join(PKG, "cli.mjs");

/** node ≥23.6 才默认 type stripping（子进程要直跑 .ts fixture 启动壳） */
const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split(".").map(Number);
const TYPE_STRIPPING_OK = NODE_MAJOR! > 23 || (NODE_MAJOR === 23 && NODE_MINOR! >= 6);
const d: typeof describe = TYPE_STRIPPING_OK ? describe : describe.skip;

/* ---------------- 真实 fixture server：spawn 子进程 + 握手行取实际端口 + 可靠收尸 ---------------- */

const tmpRoots: string[] = [];
const procs: ChildProcess[] = [];

afterAll(async () => {
  for (const p of procs.splice(0)) {
    if (p.exitCode === null && !p.killed) p.kill();
  }
  await Promise.allSettled(procs.map((p) => new Promise((r) => (p.exitCode !== null ? r(null) : p.once("exit", r)))));
  await new Promise((r) => setTimeout(r, 100)); // Windows 句柄释放宽限
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** fixture 启动壳：两端点（无契约 query + 有契约 command）显式注册，serve() 单源监听握手 */
function makeFixtureServer(): { port: Promise<number> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-call-gate-"));
  tmpRoots.push(dir);
  const serverIndex = JSON.stringify(pathToFileURL(path.join(PKG, "server", "index.ts")).href);
  const nodeHost = JSON.stringify(pathToFileURL(path.join(PKG, "server", "node-host.ts")).href);
  const file = path.join(dir, "bootstrap.ts");
  fs.writeFileSync(
    file,
    `import { EndpointRegistry, defineCommand, defineQuery } from ${serverIndex};
import { serve } from ${nodeHost};

const registry = new EndpointRegistry();
registry.register(defineQuery("gate.ping", { handler: () => ({ ok: true, pong: "gate" }) }));
registry.register(defineCommand<{ msg: string }, { echoed: string; upper: string }>("gate.echo", {
  contract: { type: "object", reqProps: { msg: { type: "string", min: 1 } } },
  handler: (input) => ({ echoed: input.msg, upper: input.msg.toUpperCase() }),
}));
// --timeout 专项（M6-A 回填）：慢端点拖墙钟（2.5s sleep——超过用例的极小时限，短于缺省 10s 对照时限）
registry.register(defineQuery("gate.slow", { handler: async () => { await new Promise((r) => setTimeout(r, 2500)); return { ok: true, slow: true }; } }));
await serve(registry.createHandler({ mount: "/api" }), { port: 0 });
`,
    "utf8",
  );
  const proc = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  procs.push(proc);
  let out = "";
  let err = "";
  proc.stdout!.on("data", (c: Buffer) => (out += c.toString("utf8")));
  proc.stderr!.on("data", (c: Buffer) => (err += c.toString("utf8")));
  const port = new Promise<number>((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const tick = () => {
      const m = out.match(/^ATELIER_SERVER_READY \{"port":(\d+)\}\r?\n/m);
      if (m) return resolve(Number(m[1]));
      if (proc.exitCode !== null) return reject(new Error(`fixture server 提前退出（exit ${proc.exitCode}）：\n${out}\n${err}`));
      if (Date.now() > deadline) return reject(new Error(`fixture server 15s 未就绪：\n${out}\n${err}`));
      setTimeout(tick, 25);
    };
    tick();
  });
  return { port };
}

const fixture = d ? makeFixtureServer() : null;
const PORT_PROMISE = fixture ? fixture.port : Promise.resolve(0);

/** 跑真实 CLI 子进程：`node atelier/cli.mjs call <args…>`（不经 runFile 直调——CLI 分发也算被测面） */
async function call(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  const port = await PORT_PROMISE;
  const r = spawnSync(process.execPath, [CLI, "call", ...args, "--port", String(port)], { encoding: "utf8", windowsHide: true });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** 预约一个当前空闲、随即释放的端口（不可达红证用——listen 后立即 close，连接必被拒） */
function grabClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

d("D-F15 atelier call：端点直调 CLI 通道（Builder.io 四通道对表的 CLI 位）", () => {
  it(
    "正控：query / command 全通——exit 0 + 响应 JSON 落 stdout + 零 stderr 噪声",
    { timeout: 30_000, retry: 0 },
    async () => {
      // query（无契约）：{} 缺省体即通
      const q = await call(["gate.ping"]);
      expect(q.status).toBe(0);
      expect(JSON.parse(q.stdout)).toEqual({ ok: true, pong: "gate" });

      // command（有契约）：JSON 实参过输入契约 → handler 真跑（upper 是 handler 派生值，非回显转发）
      const c = await call(["gate.echo", '{"msg":"hi"}']);
      expect(c.status).toBe(0);
      expect(c.stderr).toBe(""); // 成功路径零 stderr 噪声（结构化错误才上 stderr 的纪律位）
      expect(JSON.parse(c.stdout)).toEqual({ echoed: "hi", upper: "HI" });
    },
  );

  it(
    "红证：未知端点 ATR-310 / 契约违规 ATR-201 ——结构化错误上 stderr + exit 1",
    { timeout: 30_000, retry: 0 },
    async () => {
      const u = await call(["gate.nope"]);
      expect(u.status).toBe(1);
      expect(u.stdout).toBe("");
      expect(u.stderr).toContain("ATR-310");
      expect(u.stderr).toContain("fix"); // §15：fix 文案必须可执行——结构化错误三件套贯通
      expect(u.stderr).toContain("gate.ping"); // server 的 hints（已注册端点集）原样透传给 agent

      const v = await call(["gate.echo", '{"msg":""}']); // min:1 违约
      expect(v.status).toBe(1);
      expect(v.stderr).toContain("ATR-201");
      expect(v.stderr).toContain("msg");
    },
  );

  it(
    "红证：server 不可达 → ATR-403 形态结构化错误 + fix 指路 pnpm dev + exit 1（不静默不 spawn）",
    { timeout: 30_000, retry: 0 },
    async () => {
      const dead = await grabClosedPort();
      const r = spawnSync(process.execPath, [CLI, "call", "gate.ping", "--port", String(dead)], { encoding: "utf8", windowsHide: true });
      expect(r.status).toBe(1);
      expect(r.stdout ?? "").toBe("");
      expect(r.stderr ?? "").toContain("ATR-403");
      expect(r.stderr ?? "").toContain("pnpm dev"); // fix 可执行：指路托管环
    },
  );

  it(
    "红证：JSON 实参坏 / 非法端点名 → usage 级 exit 2（坏输入客户端即拦，不出网）",
    { timeout: 30_000, retry: 0 },
    async () => {
      const r = await call(["gate.echo", "{bad json"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("JSON");
      // 端点名形态守卫：带路径分隔符的实参是用法错误（端点是注册表名，不是 URL）
      const p = await call(["../escape"]);
      expect(p.status).toBe(2);
    },
  );

  it(
    "专项：--timeout AbortSignal 超时路径（慢端点 + 极小时限 → ATR-403 无响应 + fix 指路放宽）——对照留证分流",
    { timeout: 60_000, retry: 0 },
    async () => {
      // 对照①（红检替代）：同端点无 --timeout（缺省 10s > 2.5s sleep）→ exit 0 正常返回——
      // 证明下面的失败不是端点坏/server 坏，超时路径确实由时限触发
      const ctrl = await call(["gate.slow"]);
      expect(ctrl.status).toBe(0);
      expect(JSON.parse(ctrl.stdout)).toEqual({ ok: true, slow: true });

      // 专项：极小 --timeout 打慢端点 → fetch 被 AbortSignal.timeout 中止 →
      // ATR-403「无响应」形态（区别于不可达路径的「不可达」）+ 报出实际时限 + fix 可执行
      const t = await call(["gate.slow", "--timeout", "300"]);
      expect(t.status).toBe(1);
      expect(t.stdout).toBe(""); // 错误只上 stderr（响应 JSON 才上 stdout 的输出面纪律）
      expect(t.stderr).toContain("ATR-403");
      expect(t.stderr).toContain("无响应");
      expect(t.stderr).toContain("300ms"); // 实际时限入错误文案
      expect(t.stderr).toContain("--timeout"); // fix 指路放宽时限（可执行）
      // 错误文案分流：timeout 路径不出现不可达路径的「pnpm dev」托管环指路
      expect(t.stderr).not.toContain("pnpm dev");

      // 对照②：快端点 + 同样极小 --timeout → exit 0——超时是墙钟对响应等待，不是「小时限」本身
      const fast = await call(["gate.ping", "--timeout", "300"]);
      expect(fast.status).toBe(0);
      expect(JSON.parse(fast.stdout)).toEqual({ ok: true, pong: "gate" });
    },
  );
});
