/**
 * dev-screenshot-close.test.ts — 「bench 成功路径进程不自退」尾巴的红绿钉（2026-09-29 实证缺陷）。
 *
 * 缺陷链（BACKLOG 尾巴节 + 1.1.0 版批四指标复测：bench 出数成功后事件循环被残留句柄吊死，
 * taskkill /T /F 收尸整树 16 PID）：dev-screenshot.mjs openTransientBrowser().close() 三洞——
 *   ① CDP WebSocket 从不 close：开放 ws 无限期吊住事件循环（主因；bench cdpSession?.close()
 *      直接受害）；
 *   ② child.kill() 只杀直属进程：win32 无头 Edge/Chrome 是 crashpad/gpu/renderer 进程树，
 *      直属进程死后浏览器子进程残留（bench.mjs killTree 已有 taskkill /pid /T /F 先例）；
 *   ③ 1.5s 延迟 rmSync 的 setTimeout 未 unref：句柄全清后进程仍多活 1.5s。
 *
 * 为什么 spawn 子进程探针：dev-screenshot.mjs 是纯 .mjs；而真正的行为——「close() 后进程能否
 * 自然落出（事件循环清空）」只有真进程能证明，vitest worker 自身句柄面嘈杂，进程内断言钉不住。
 * 探针 = node --input-type=module -e：动态 import dev-screenshot.mjs → openTransientBrowser()
 * （不传 debugPort = pickFreePort 随机空闲口，绝不占 bench 的 9346）→ await close()（用例②
 * 测双 close 幂等）→ 自然结束（无显式 exit）。断言：探针在 30s 看门狗内自退 exit 0 + 浏览器
 * pid 已死（树杀生效无孤儿）。父侧纪律：超时即 taskkill /pid <probe> /T /F 整树收尸——红态下
 * 浏览器还活着，Windows 孤儿进程零容忍。本机无浏览器（findBrowser 候选全缺）→ 整组诚实 skip
 * （build-gate TYPE_STRIPPING_OK 同款写法；候选清单镜像 dev-screenshot.mjs findBrowser，
 * 含 ATELIER_EDGE_PATH 逃生口，不改动被测模块面）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FRAMEWORK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const MODULE_URL = pathToFileURL(path.join(FRAMEWORK, "dev", "dev-screenshot.mjs")).href;
const TIMEOUT_MS = 30_000;

/** 镜像 dev-screenshot.mjs findBrowser 的候选清单（仅作 skip 门禁；候选漂移时被测模块自己会
 *  throw "msedge.exe not found" 让用例红，不会静默漏检） */
function findBrowserPath(): string | null {
  const candidates = [
    process.env.ATELIER_EDGE_PATH,
    // 与 findBrowser 同款：Linux CI/桌面候选
    ...(process.platform === "linux"
      ? ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
      : []),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

const BROWSER_OK = findBrowserPath() !== null;
const d: typeof describe = BROWSER_OK ? describe : describe.skip;

const procs: ChildProcess[] = [];

afterAll(async () => {
  // 兜底收尸：任何仍存活的探针整树 taskkill + 按 profile 标记清扫无头浏览器
  // （正常路径探针已自退，此处只接异常；Windows 孤儿进程零容忍）
  for (const p of procs.splice(0)) {
    if (p.exitCode === null && !p.killed && p.pid) {
      spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    }
  }
  sweepShotBrowsers();
});

/** 探针脚本（--input-type=module）：open → close ×n → 自然结束（无显式 exit）。
 *  句柄全清 = 事件循环自然清空 = exit 0；任一残留（ws / 浏览器树 / 定时器）= 挂死，由父侧看门狗处刑。 */
const probeSrc = (closeCalls: number) => `
const mod = await import(process.env.PROBE_MODULE);
const s = await mod.openTransientBrowser(); // 不传 debugPort = pickFreePort 随机空闲口
console.log("PROBE_OPEN pid=" + s.child.pid);
for (let i = 0; i < ${closeCalls}; i++) await s.close();
console.log("PROBE_CLOSED");
`;

/** 按 atelier-shot 一次性 profile 标记清扫无头 Edge（dev-screenshot spawn 的实例 cmdline 必带
 *  --user-data-dir=<tmp>/atelier-shot-*，用户日常 Edge 不带——按标记打，绝不误伤）。红态下
 *  close() 的 child.kill() 已杀死直属 Edge 启动进程、真实浏览器挂在死 PID 之下，taskkill /T
 *  从探针侧/浏览器 pid 侧都够不到（死中间节点断链，2026-09-29 红检实证）——只认 cmdline 标记
 *  才是完备收尸。全仓无第二处测试 spawn 真浏览器（dev-face-security 等仅文本机检），清扫安全。 */
function sweepShotBrowsers(): void {
  if (process.platform !== "win32") return;
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'atelier-shot' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  try { spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore", timeout: 15000 }); } catch { /* best effort */ }
}

/** 跑探针并裁决：返回 exit code（null = 看门狗超时整树收尸）+ stdout/stderr 全量带回供失败诊断 */
async function runProbe(closeCalls: number) {
  const probe = spawn(process.execPath, ["--input-type=module", "-e", probeSrc(closeCalls)], {
    env: { ...process.env, PROBE_MODULE: MODULE_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  procs.push(probe);
  const stdout: string[] = [];
  const stderr: string[] = [];
  probe.stdout?.on("data", (c: Buffer) => stdout.push(c.toString()));
  probe.stderr?.on("data", (c: Buffer) => stderr.push(c.toString()));
  const code = await new Promise<number | null>((resolve) => {
    const watchdog = setTimeout(() => {
      // 红态收尸：探针整树 taskkill /T /F + 按 profile 标记清扫无头浏览器（16 PID 教训——绝不留孤儿）
      if (probe.pid) spawnSync("taskkill", ["/pid", String(probe.pid), "/T", "/F"], { stdio: "ignore" });
      sweepShotBrowsers();
      resolve(null);
    }, TIMEOUT_MS);
    probe.once("exit", (c) => { clearTimeout(watchdog); resolve(c); });
  });
  return { code, out: stdout.join(""), err: stderr.join("") };
}

d("dev-screenshot openTransientBrowser().close() 事件循环收口", () => {
  it(
    "close() 后探针子进程自退 exit 0 且浏览器 pid 无残留（ws 关闭/树杀/unref 三洞合一行为钉）",
    async () => {
      const { code, out, err } = await runProbe(1);
      const ctx = `probe stdout: ${out.trim() || "(none)"}\nprobe stderr: ${err.trim() || "(none)"}`;
      expect(
        code,
        `probe did not self-exit within ${TIMEOUT_MS}ms — residual handle kept the loop alive (watchdog tree-killed it)\n${ctx}`,
      ).toBe(0);
      expect(out, ctx).toContain("PROBE_CLOSED");

      // 树杀钉：close() 返回后浏览器直属进程必须已死（win32 taskkill /T /F 同步等待；pid 复用
      // 窗口极小，3s 轮询兜底——探针 exit 0 而浏览器活着 = 树杀缺失的孤儿前兆）
      const pid = Number(out.match(/PROBE_OPEN pid=(\d+)/)?.[1]);
      expect(pid, `probe did not report browser pid\n${ctx}`).toBeGreaterThan(0);
      const alive = async () => { try { process.kill(pid, 0); return true; } catch { return false; } };
      for (let i = 0; i < 30 && (await alive()); i++) await new Promise((r) => setTimeout(r, 100));
      expect(await alive(), `browser pid ${pid} still alive after close() — tree-kill missing\n${ctx}`).toBe(false);
    },
    TIMEOUT_MS + 15_000,
  );

  it(
    "close() 幂等：二次调用 no-op（不抛错），探针仍自退 exit 0",
    async () => {
      const { code, out, err } = await runProbe(2);
      const ctx = `probe stdout: ${out.trim() || "(none)"}\nprobe stderr: ${err.trim() || "(none)"}`;
      expect(code, `probe did not self-exit within ${TIMEOUT_MS}ms (double close must stay safe and drain)\n${ctx}`).toBe(0);
      expect(out, ctx).toContain("PROBE_CLOSED");
    },
    TIMEOUT_MS + 15_000,
  );
});
