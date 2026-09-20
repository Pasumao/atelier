/**
 * dev-server-host.mjs — FS-7 dev 托管：server 面子进程监督器 + <mount>/* 反向代理（FS-DESIGN §11.1）。
 *
 * 框架自有模块（framework-owned）；init/sync 时 vendor 进应用 scripts/，由 atelier-dev-plugin.mjs
 * 以相对路径引入。职责边界：
 *   - spawn <root>/src/server/main-server.ts（Node 原生 type stripping：major ≥23 直接跑，
 *     [22.6,23) 加 --experimental-strip-types，<22.6 诚实 warn 跳过托管——前端照常跑）；
 *   - 就绪握手：子进程 stdout 恰好一行 `ATELIER_SERVER_READY {"port":<实际端口>}`（三方契约第 3 条），
 *     其余 stdout/stderr 行加 `[server] ` 前缀透传到本进程 console——绝不吞：agent 靠它看子进程
 *     原样错误（如 EADDRINUSE 就换 server.port / 释放端口，绝不静默换口）；
 *   - <mount>/* 反向代理：方法/头/体透传、双向流式（req.pipe 上行、proxyRes writeHead+pipe 下行，
 *     SSE live 端点靠不缓冲自然流式）；未就绪/未托管/连接被拒 → 503 JSON（ATR-403，短暂、诚实）；
 *   - 热重启：调用方（dev 插件 watcher）debounce 后调 restart(reason)——停旧（SIGTERM，1.5s 后
 *     SIGKILL 兜底；Windows 上 kill 即终止语义）→ 重启 → 重新握手。前端 HMR 零牵连：server 文件
 *     不在 Vite 模块图，watch 只喂本监督器（决策 16 full-reload 前科不许重演——这是实现注记）。
 *
 * 诚实边界：不代理 WebSocket 升级（server 面 live 走 SSE，无 WS 需求）；重启窗口期代理如实 503；
 * stdio pipe 全程持续消费（防 64KB 缓冲写满卡死子进程）。
 */
import { spawn } from "node:child_process";
import http from "node:http";
import readline from "node:readline";
import path from "node:path";

/** 就绪行严格前缀（三方契约第 3 条） */
export const READY_PREFIX = "ATELIER_SERVER_READY ";
/** SIGTERM 后等待子进程退出的兜底窗口，超时 SIGKILL */
const SIGKILL_FALLBACK_MS = 1500;
/** start() 等握手的最长时限（超时杀子进程并如实报错） */
const DEFAULT_READY_TIMEOUT_MS = 10000;

/* keepAlive:false：热重启后同端口可能被新子进程复用，连接池里的旧 socket 会 ECONNRESET——
 * dev 代理性能不敏感，每请求新建连接换确定性。 */
const PROXY_AGENT = new http.Agent({ keepAlive: false });

/**
 * 解析应用 atelier.config.json 的 server 段 → {port, mount, dbPath}（三方契约第 2 条）。
 * 缺省 5174 / "/api" / ".atelier/dev.db"；port 0=自动合法透传（falsy 不吞）；mount 缺斜杠归一；
 * dbPath 优先级：env ATELIER_DB_PATH（--prod-db 注入位）> config server.dbPath > 缺省。
 */
export function resolveServerConfig(appConfigJson, env = {}) {
  const server = appConfigJson?.server ?? {};
  const rawPort = server.port;
  const num = rawPort == null ? NaN : Number(rawPort);
  const port = Number.isFinite(num) && num >= 0 ? num : 5174;
  const rawMount = String(server.mount ?? "/api");
  const mount = rawMount.startsWith("/") ? rawMount : `/${rawMount}`;
  const dbPath =
    (env.ATELIER_DB_PATH && String(env.ATELIER_DB_PATH).trim()) || server.dbPath || ".atelier/dev.db";
  return { port, mount, dbPath };
}

/**
 * 就绪行解析：严格前缀 READY_PREFIX + JSON 且 port 为有限数字 → {port}；否则 null（绝不 throw）。
 */
export function parseReadyLine(line) {
  if (typeof line !== "string" || !line.startsWith(READY_PREFIX)) return null;
  try {
    const j = JSON.parse(line.slice(READY_PREFIX.length));
    if (j && typeof j === "object" && Number.isFinite(j.port)) return { port: j.port };
  } catch {
    /* 坏 JSON → null */
  }
  return null;
}

/** Node 原生跑 .ts 的版本策略：≥23 直接跑；[22.6,23) 加 flag；<22.6 返回 null（跳过托管）。 */
function typeStripArgs() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj >= 23) return [];
  if (maj === 22 && min >= 6) return ["--experimental-strip-types"];
  return null;
}

/**
 * server 面监督器。用法（dev 插件）：
 *   const sup = createServerSupervisor({ root, port, mount, dbPath, env });
 *   server.middlewares.use(sup.middleware());   // 注册在 /__atelier 之前（路径不重叠，顺序只为清晰）
 *   await sup.start();                           // 就绪握手后 resolve {port}
 *   await sup.restart("src/server 变更");        // 热重启（watcher debounce 后调）
 *   await sup.stop();                            // vite 收尾（幂等，防双杀）
 */
export function createServerSupervisor({ root, port = 5174, mount = "/api", dbPath = ".atelier/dev.db", env = {}, readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS }) {
  const ENTRY = path.join("src", "server", "main-server.ts"); // 相对 root（spawn cwd=root，三方契约第 1 条）
  const entryAbs = path.join(root, ENTRY);
  const stripArgs = typeStripArgs();

  let child = null; // 在跑的子进程
  let childPort = null; // 握手所得实际端口
  let gen = 0; // 代际：stop/restart 后旧代际的全部监听与握手作废
  let starting = null; // 在途 start() promise（并发 start 共享同一份）

  function isReady() {
    return child !== null && childPort !== null;
  }

  function targetPort() {
    return childPort;
  }

  /**
   * spawn 子进程并等就绪握手。resolve {port}；托管被跳过（Node < 22.6，已打诚实 warn）resolve null；
   * 握手超时 / 子进程握手前退出 reject（错误信息指向上方 [server] 原样输出）。
   * 约定：boot 期 await 一次；之后的变更一律走 restart()（stop 会作废在途 start 的等待）。
   */
  function start() {
    if (starting) return starting;
    if (stripArgs === null) {
      console.warn(
        `[atelier] dev 托管跳过：Node ${process.versions.node} < 22.6 无法原生跑 .ts（type stripping）——server 面不托管，前端照常跑；<${mount}>/* 将返回 503 ATR-403`,
      );
      return Promise.resolve(null);
    }
    const myGen = ++gen;
    starting = new Promise((resolve, reject) => {
      let settled = false;
      const c = spawn(process.execPath, [...stripArgs, ENTRY], {
        cwd: root,
        env: {
          ...process.env,
          ...env,
          ATELIER_SERVER_PORT: String(port),
          ATELIER_SERVER_MOUNT: mount,
          ATELIER_DB_PATH: dbPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = c;
      childPort = null;

      const settle = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        starting = null;
        if (err) reject(err);
        else resolve(value);
      };
      const readyTimer = setTimeout(() => {
        settle(new Error(`ATR-403: server 面握手超时（${readyTimeoutMs}ms 未收到 ATELIER_SERVER_READY 行）——检查 ${entryAbs} 是否按契约在 listen 后输出就绪行（上方 [server] 行是子进程原样输出）`));
      }, readyTimeoutMs);

      // stdio pipe 必须持续消费（防缓冲死锁）；就绪行解析，其余行 [server] 前缀透传
      const rl = readline.createInterface({ input: c.stdout });
      rl.on("line", (line) => {
        if (myGen !== gen) return; // 旧代际输出作废
        const ready = parseReadyLine(line);
        if (ready) {
          childPort = ready.port;
          console.log(`[atelier] server 面 ready → http://127.0.0.1:${ready.port}（挂载 ${mount}，pid ${c.pid}）`);
          settle(null, { port: ready.port });
          return;
        }
        if (line.length) console.log(`[server] ${line}`);
      });
      c.stderr.setEncoding("utf8");
      c.stderr.on("data", (chunk) => {
        for (const line of String(chunk).split("\n")) if (line.length) console.error(`[server] ${line}`);
      });

      c.on("exit", (code, signal) => {
        if (myGen !== gen) return;
        child = null;
        childPort = null;
        console.error(
          `[atelier] server 子进程退出（code=${code ?? "-"} signal=${signal ?? "-"}）——上方 [server] 行为原样错误输出（EADDRINUSE → 释放端口或改 atelier.config.json 的 server.port；固定端口被占绝不静默换口）`,
        );
        settle(new Error(`ATR-403: server 子进程在握手前退出（code=${code ?? "-"} signal=${signal ?? "-"}）——看上方 [server] 行定位`));
      });
    });
    return starting;
  }

  /** 停掉当前子进程（SIGTERM，1.5s 后 SIGKILL 兜底；Windows 上 kill 即终止语义）。幂等。 */
  function stop() {
    const c = child;
    gen++; // 作废一切在途握手/输出/退出日志
    child = null;
    childPort = null;
    starting = null;
    if (!c) return Promise.resolve();
    if (c.exitCode !== null || c.signalCode !== null) return Promise.resolve(); // 已死，exit 事件不会再来
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearTimeout(killTimer);
          resolve();
        }
      };
      const killTimer = setTimeout(() => {
        try {
          c.kill("SIGKILL");
        } catch {
          /* 已退出 */
        }
      }, SIGKILL_FALLBACK_MS);
      c.once("exit", finish);
      try {
        c.kill("SIGTERM");
      } catch {
        finish();
      }
    });
  }

  /** 热重启：停旧 → 重启 → 重新握手。重启期间代理如实 503（短暂）。 */
  async function restart(reason) {
    console.log(`[atelier] server 面热重启（${reason}）`);
    await stop();
    return start();
  }

  /** 503 ATR-403 JSON（未就绪/未托管），fix 必须可执行。 */
  function send503(res, error, fix) {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error, fix }));
  }

  /** connect 兼容中间件：路径以 mount 开头才转发，否则 next()。 */
  function middleware() {
    return function atelierServerProxy(req, res, next) {
      const raw = req.url ?? "";
      const pathOnly = raw.split("?")[0];
      const onMount = pathOnly === mount || pathOnly.startsWith(`${mount}/`);
      if (!onMount) return next();
      if (!isReady()) {
        send503(
          res,
          "ATR-403: server 面未就绪（未托管 / 握手中 / 热重启中 / 宿主 Node < 22.6 跳过托管）",
          `确认 ${entryAbs} 存在且在 listen 后输出 ATELIER_SERVER_READY 行；看本控制台 [server] 前缀行定位子进程错误（EADDRINUSE → 释放端口或改 server.port）；Node ≥ 22.6`,
        );
        return;
      }
      forwardRequest(childPort, req, res);
    };
  }

  return { start, stop, restart, isReady, targetPort, middleware };
}

/**
 * 单请求反向代理（独立导出便于单测）：同路径转发到 http://127.0.0.1:<targetPort>，
 * 方法/头/体透传、双向流式（req.pipe 上行、proxyRes writeHead+pipe 下行——SSE 靠不缓冲自然流式）。
 * 连接失败（ECONNREFUSED 等）→ 503 ATR-403 JSON；响应已开始后中途断流只能如实 destroy（改不了头）。
 */
export function forwardRequest(targetPort, req, res) {
  const proxyReq = http.request(
    `http://127.0.0.1:${targetPort}${req.url ?? "/"}`,
    { method: req.method, headers: req.headers, agent: PROXY_AGENT },
    (proxyRes) => {
      if (res.headersSent) {
        proxyRes.destroy();
        return;
      }
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (e) => {
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: `ATR-403: server 面连接失败（${e?.code ?? e?.name ?? "Error"}）——子进程刚退出或热重启中`,
        fix: "看控制台 [server] 前缀行的子进程原样错误（EADDRINUSE → 释放端口或改 server.port）；短暂重试通常即恢复（热重启秒级完成）",
      }),
    );
  });
  req.pipe(proxyReq); // 上行流式
  return proxyReq;
}
