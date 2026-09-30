/**
 * dev-token-mint.test.ts — REL-A A3：dev-token 铸造时机（vite config 期 → serve 路径）。
 *
 * 缺口（任务书 A3）：旧口径插件工厂实例化即 writeFileSync(dev-token, randomUUID()) ⇒
 * `atelier build`/`pnpm build`（vite build 只实例化工厂、永不触发 configureServer）也重铸并覆写
 * token；与运行中 `pnpm dev` 互踩后，读盘 token 的工具链（scripts/snapshot.mjs / bench.mjs /
 * checkpoint.mjs）全部 401，而 checkpoint 把 !r.ok 一律判 vacuous 放行——「未检不锚」快照门
 * 静默解除。修后口径：token 铸造/落盘只在 configureServer（serve 路径）发生——build/config 期
 * 对 token 文件零读零写；磁盘已有非空 token（dev 重启/同目录并行 dev）复用不覆写（磁盘值 =
 * 运行中 dev 面的内存令牌，复用即不互踩）。
 *
 * harness（dev-face-routes.test.ts 同款）：chdir 临时目录再实例化（ROOT 工厂期捕获）；
 * configureServer 喂假 server 桩（无 httpServer → announceTokenUrl 直打；无 src/server 入口 →
 * 托管跳过）。
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mod: any = await import("../dev/atelier-dev-plugin.mjs");

describe("REL-A A3 dev-token 铸造时机：config/build 期零 touch，serve 期铸造/复用", () => {
  const created: string[] = [];
  const tmp = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-token-mint-"));
    created.push(d);
    return d;
  };
  const tokenFile = (dir: string) => path.join(dir, ".atelier", "dev-token");
  const prevCwd = process.cwd();
  afterAll(() => {
    process.chdir(prevCwd);
    for (const d of created) fs.rmSync(d, { recursive: true, force: true });
  });

  it("红检：磁盘已有 token（运行中 dev 面）→ 插件工厂实例化（build/config 期）不覆写——token 字节不变", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".atelier"), { recursive: true });
    fs.writeFileSync(tokenFile(dir), "running-dev-token-keep", "utf8");
    process.chdir(dir);
    try {
      mod.atelierDevPlugin(); // 旧口径：工厂期 writeFileSync 覆写（红态——快照门由此静默解除）
      expect(fs.readFileSync(tokenFile(dir), "utf8")).toBe("running-dev-token-keep");
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("红检：无 token 目录 → 插件工厂实例化（build/config 期）不铸造——零副作用", () => {
    const dir = tmp();
    process.chdir(dir);
    try {
      mod.atelierDevPlugin();
      expect(fs.existsSync(tokenFile(dir)), "build/config 期不得铸造或落盘 dev-token").toBe(false);
    } finally {
      process.chdir(prevCwd);
    }
  });

  /** serve 路径 harness：chdir → 实例化 → configureServer（假 server 桩），返回登记的中间件 */
  const configure = (dir: string): ((req: any, res: any, next: () => void) => Promise<void> | void)[] => {
    process.chdir(dir);
    try {
      const plugin = mod.atelierDevPlugin();
      const captured: unknown[] = [];
      plugin.configureServer({
        middlewares: { use: (fn: unknown) => captured.push(fn) },
        config: { server: { port: 5173 } },
        watcher: { add() {}, on() {} },
        httpServer: null,
      });
      return captured as any;
    } finally {
      process.chdir(prevCwd);
    }
  };

  it("serve 期（configureServer）：无 token → 铸造落盘（非空）；磁盘已有非空 token → 复用不覆写", () => {
    const fresh = tmp();
    configure(fresh);
    expect(fs.existsSync(tokenFile(fresh)), "serve 期必须铸造落盘（dev 面信任锚就位）").toBe(true);
    expect(fs.readFileSync(tokenFile(fresh), "utf8").trim().length).toBeGreaterThan(0);

    const existing = tmp();
    fs.mkdirSync(path.join(existing, ".atelier"), { recursive: true });
    fs.writeFileSync(tokenFile(existing), "already-minted-token", "utf8");
    configure(existing); // 旧口径：工厂期已被覆写，此处读到的是新铸值（红态）
    expect(fs.readFileSync(tokenFile(existing), "utf8")).toBe("already-minted-token");
  });

  it("serve 期落盘 token = dev 面令牌（磁盘值与内存值同源）：复用 token 打 dev 面不被 401 拒", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".atelier"), { recursive: true });
    fs.writeFileSync(tokenFile(dir), "already-minted-token", "utf8");
    const handlers = configure(dir);
    const res: any = { statusCode: 0, headers: {}, body: null as unknown, setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, end(b?: unknown) { this.body = b; }, write: () => {}, writeHead(c: number) { this.statusCode = c; }, destroy: () => {} };
    let nexted = false;
    for (const h of handlers) {
      nexted = false;
      await h({ url: "/__atelier/tokens", method: "GET", headers: { "x-atelier-token": "already-minted-token" } }, res, () => { nexted = true; });
      if (!nexted) break;
    }
    expect(nexted).toBe(false);
    expect(res.statusCode, "复用的磁盘 token 必须被 dev 面闸放行（磁盘值 = 内存令牌同源）").not.toBe(401);
  });
});
