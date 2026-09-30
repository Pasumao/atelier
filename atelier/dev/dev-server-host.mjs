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
 *     上游响应头等待有界（UPSTREAM_HEADERS_TIMEOUT_MS → 504，头后流式期零超时——SSE 长连接不误杀）、
 *     客户端中断即销毁上游（live 生成器不滞留——R3 结构债批 §4.6）；
 *     P1 #3 起 Origin/Host 白名单闸（镜像 P1-12，原语单源本文件）——承载写副作用的反代面不再是
 *     跨站 no-cors 写的免检通道；
 *   - 热重启：调用方（dev 插件 watcher）debounce 后调 restart(reason)——停旧（SIGTERM，1.5s 后
 *     SIGKILL 兜底；Windows 上 kill 即终止语义）→ 重启 → 重新握手。前端 HMR 零牵连：server 文件
 *     不在 Vite 模块图，watch 只喂本监督器（决策 16 full-reload 前科不许重演——这是实现注记）。
 *
 * 诚实边界：不代理 WebSocket 升级（server 面 live 走 SSE，无 WS 需求）；重启窗口期代理如实 503；
 * stdio pipe 全程持续消费（防 64KB 缓冲写满卡死子进程）。
 */
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import readline from "node:readline";
import path from "node:path";

/** 就绪行严格前缀（三方契约第 3 条） */
export const READY_PREFIX = "ATELIER_SERVER_READY ";
/** SIGTERM 后等待子进程退出的兜底窗口，超时 SIGKILL */
const SIGKILL_FALLBACK_MS = 1500;
/** start() 等握手的最长时限（超时杀子进程并如实报错） */
const DEFAULT_READY_TIMEOUT_MS = 10000;

/* ---- P1 #3：Origin/Host 白名单原语（单源——dev 插件 P1-12 闸与本文件反代闸共用；
 * 插件 re-export 保持 P1-12 既有导出面不变）----
 * 威胁模型一句话：dev-token 是 dev 面唯一信任锚，而浏览器对跨站 no-cors 请求仍会打到
 * /__atelier/* 与 <mount>/*（承载写副作用）——无来源闸时，token 门挡不住「伪造来源页驱动
 * 浏览器直接跨站写」这一族 CSRF（P1-12）。 */

/** 自身授权方 → 允许 Origin 列表（127.0.0.1/localhost/[::1] × 显式配置 host；通配 host 不是「自身 host」）。
 *  http/https 双 scheme 都认：scheme 由部署形态决定，来源判定的实质是 host:port。 */
export function originAllowlist(port, extraHosts = []) {
  const authorities = new Set(["127.0.0.1", "localhost", "[::1]"]);
  for (const h of Array.isArray(extraHosts) ? extraHosts : [extraHosts]) {
    if (typeof h === "string" && !["0.0.0.0", "::", "*"].includes(h)) authorities.add(h);
  }
  const origins = [];
  for (const a of authorities) for (const scheme of ["http", "https"]) origins.push(`${scheme}://${a}:${port}`);
  return origins;
}

/** Origin 是否放行：白名单命中，或与 Host 头同授权方（浏览器设置的 Host = 实际连接的授权方——
 *  覆盖自定义 host/局域网 IP 访问；跨站伪造时 Origin 与 Host 必然失配）。Origin: null / 乱值一律拒。 */
export function originAllowed(origin, allowlist, hostHeader = null) {
  let u;
  try { u = new URL(String(origin)); } catch { return false; }
  if (hostHeader && u.host === String(hostHeader).toLowerCase()) return true;
  return allowlist.includes(u.origin);
}

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
 * P1 #11：子进程击杀（win32 按 dev-screenshot/bench 的 taskkill /T 树杀先例——server 面虽是单
 * node 进程，树杀一并覆盖其意外派生的子进程；POSIX SIGTERM + SIGKILL 兜底定时器）。调用返回即
 * 「击杀已发出」，不等退出——握手超时路径要同步杀，绝不留占端口持 SQLite 句柄的孤儿。
 */
function killChildTree(c) {
  if (!c || c.pid == null || (c.exitCode !== null && c.exitCode !== undefined) || c.signalCode !== null) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      /* fall through 到 kill() */
    }
  }
  try {
    c.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const t = setTimeout(() => {
    try {
      c.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, SIGKILL_FALLBACK_MS);
  t.unref?.();
}

/**
 * server 面监督器。用法（dev 插件）：
 *   const sup = createServerSupervisor({ root, port, mount, dbPath, env, selfPort, selfHosts });
 *   server.middlewares.use(sup.middleware());   // 注册在 /__atelier 之前（路径不重叠，顺序只为清晰）
 *   await sup.start();                           // 就绪握手后 resolve {port}
 *   await sup.restart("src/server 变更");        // 热重启（watcher debounce 后调）
 *   await sup.stop();                            // vite 收尾（幂等，防双杀）
 * selfPort/selfHosts：P1 #3 反代 Origin 闸的白名单口径 = dev 面自身端口（页面所在 port，number
 * 或 () => number——端口漂移后取实际端口）× 显式配置 host；缺省回落到 server port（直连形态）。
 */
export function createServerSupervisor({ root, port = 5174, mount = "/api", dbPath = ".atelier/dev.db", env = {}, readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS, selfPort = null, selfHosts = [] }) {
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
   * P1 #11：握手超时同步杀子进程（killChildTree）——注释承诺「超时杀子进程并如实报错」必须兑现，
   * 不留占端口持 SQLite 句柄的孤儿；start() re-entry（child 还挂着，如超时刚杀 exit 未落地）先
   * stop() 清场再 spawn，绝不覆盖引用制造孤儿。
   * 约定：boot 期 await 一次；之后的变更一律走 restart()（stop 会作废在途 start 的等待）。
   */
  function start() {
    if (starting) return starting;
    if (child) {
      // P1 #11 re-entry 防孤儿：先停干净上一代，再走 spawn 路径（starting 先解引用防自引用死锁）
      starting = (async () => {
        await stop();
        starting = null;
        return spawnAndAwait();
      })();
      return starting;
    }
    return spawnAndAwait();
  }

  function spawnAndAwait() {
    if (stripArgs === null) {
      console.warn(
        `[atelier] dev 托管跳过：Node ${process.versions.node} < 22.6 无法原生跑 .ts（type stripping）——server 面不托管，前端照常跑；<${mount}>/* 将返回 503 ATR-403`,
      );
      return Promise.resolve(null);
    }
    const myGen = ++gen;
    starting = new Promise((resolve, reject) => {
      let settled = false;
      let timedOut = false;
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
        // P1 #11：超时即杀（win32 taskkill /T /F，POSIX SIGTERM→SIGKILL）——先于 settle 发出，
        // 子进程绝不越过握手超时存活
        timedOut = true;
        killChildTree(c);
        settle(new Error(`ATR-403: server 面握手超时（${readyTimeoutMs}ms 未收到 ATELIER_SERVER_READY 行）——子进程已终止；检查 ${entryAbs} 是否按契约在 listen 后输出就绪行（上方 [server] 行是子进程原样输出）`));
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
        if (timedOut) return; // 握手超时路径：子进程被本监督器终止，超时错误已如实上报，不叠加退出告警
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
      /* P1 #3：反代写面 Origin 闸——语义严格镜像 P1-12 闸（同一原语单源）：
       * Origin 存在且不在白名单（127.0.0.1/localhost/[::1]/配置 host × selfPort）也不与 Host 头
       * 同授权方 → 403。无 Origin = 非浏览器客户端（curl/MCP stdio）放行不误伤；Origin: null 拒；
       * 跨站 no-cors fetch 驱动 POST /api/<写端点> 在此拦断。selfPort 函数口径使端口漂移后白名单
       * 跟随实际端口（Origin ≡ Host 同授权放行对漂移天然成立——Host 头即实际连接授权方）。 */
      const sp = typeof selfPort === "function" ? selfPort() : (selfPort ?? port);
      if (req.headers.origin != null && !originAllowed(req.headers.origin, originAllowlist(sp, selfHosts), req.headers.host)) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({
          ok: false,
          error: "ATR-403-dev: cross-origin request to the proxied server face is rejected",
          fix: "从应用自身 origin（127.0.0.1/localhost）访问 dev 面；工具链以无 Origin 通道调用（Origin 闸镜像 P1-12，与 /__atelier/* 同一 originAllowlist/originAllowed 单源）",
        }));
        return;
      }
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
 *
 * R3 结构债批 §4.6 代理韧性（评审：无代理超时、客户端中断不销毁上游——SSE 场景滞留）：
 *   · 上游响应头超时（UPSTREAM_HEADERS_TIMEOUT_MS，可 options.headersTimeoutMs 覆盖直测）：只约束
 *     「发出请求 → 收到上游响应头」窗口，超时 proxyReq.destroy() + 504 ATR JSON（错误码沿用
 *     ATR-403 族，不新增错误码——contract-checks CHECK 1 对账面）。SSE 豁免论证：SSE 端点在
 *     listen 后立即回写响应头——头到达即撤闸，头之后的流式期（含完全空闲）不受任何超时约束，
 *     长连接绝不误杀（tests/proxy-resilience 用例 C：200ms 级闸下流存活 >1s 实证）。
 *   · 客户端中断 → 销毁上游：res close 且响应未写完（!writableEnded）= 下游真断开 → 上游
 *     proxyReq 一并销毁，server 面 live 生成器随之收尾，不再滞留。正常完成（writableEnded）与
 *     客户端在位的长连接零影响。
 */
export const UPSTREAM_HEADERS_TIMEOUT_MS = 15000;

export function forwardRequest(targetPort, req, res, options = {}) {
  const headersTimeoutMs = Number(options.headersTimeoutMs ?? UPSTREAM_HEADERS_TIMEOUT_MS);
  let timedOut = false; // 超时路径已应答 504——error 事件（destroy 的直接后果）不再二次处置
  const proxyReq = http.request(
    `http://127.0.0.1:${targetPort}${req.url ?? "/"}`,
    { method: req.method, headers: req.headers, agent: PROXY_AGENT },
    (proxyRes) => {
      clearTimeout(headersTimer); // 头已到达 → 响应头等待闸即撤（SSE 长连接自此零超时约束）
      if (res.headersSent) {
        proxyRes.destroy();
        return;
      }
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  // 响应头等待闸（仅头等待期生效——SSE 透传路径豁免论证见上方函数注释）
  const headersTimer = setTimeout(() => {
    timedOut = true;
    proxyReq.destroy(); // 上游 socket 一并销毁（滞留窗口归零）
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    res.statusCode = 504;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: `ATR-403: server 面上游超时（${headersTimeoutMs}ms 未返回响应头——子进程卡死或热重启窗口；SSE 长连接不受影响——闸只在响应头等待期生效）`,
        fix: "看控制台 [server] 前缀行定位子进程状态；短暂重试通常即恢复（热重启秒级完成）",
      }),
    );
  }, headersTimeoutMs);
  headersTimer.unref?.();
  proxyReq.on("error", (e) => {
    clearTimeout(headersTimer);
    if (timedOut) return; // 超时路径已如实应答 504 且上游已销毁——不覆盖、不二次处置
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
  // 客户端中断 → 销毁上游（§4.6：SSE 场景滞留根除）。res close 且 !writableEnded = 下游真断开
  // （正常完成的响应 writableEnded=true 零影响；客户端在位的长连接不触发 close）。
  const killUpstream = () => {
    clearTimeout(headersTimer);
    if (!proxyReq.destroyed) proxyReq.destroy();
  };
  res.on("close", () => {
    if (!res.writableEnded) killUpstream();
  });
  req.on("error", killUpstream); // 上行中断（客户端上传途中断开）同样不留悬挂上游
  req.pipe(proxyReq); // 上行流式
  return proxyReq;
}
