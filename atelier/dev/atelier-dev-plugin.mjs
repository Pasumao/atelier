/**
 * atelier-dev-plugin.mjs — Atelier dev 面（决策 7「内建代理面」+ 决策 9/12 安全与审计基线）。
 *
 * 框架自有模块（framework-owned）；`atelier init` 会把它连同 dev-screenshot/gen-tailwind-theme
 * 一起 vendor 进应用 scripts/（应用自包含，vite.config 从 ./scripts/ 引入）。
 *
 * 查询（GET，需 token）
 *  - /__atelier/registry · tokens · docs · state-snapshot
 *  - /__atelier/screenshot                 常驻无头实例截图（P0-6：同 tab 复用，崩溃自愈；视觉真相）
 *  - /__atelier/a11y                       无障碍树文本化（P2-2③：agent 检视语义优先于像素）
 *  - /__atelier/agent-health               agent 体检（P2-4：UA 分类台账 + 最近错误，JSON 结构化）
 *  - /__atelier/audit?lines=N              审计日志尾读
 *  - /__atelier/server-status              server 面运行时内省代理（FS-M6 D-F16/§10.3：端点全表含契约体
 *                                          + journal + live 订阅 + 迁移状态；子进程保留路由 + 父进程补充
 *                                          restarts/dbPath/host——MCP endpoint.* 族与调试页三处同源）
 *  - /__atelier/endpoints                  人可读端点调试页（D-F16：端点表 + try-it + schema 展示）
 *  - /__atelier/review-data[?anchor=<id>]  review 扩展数据（§11.2/§11.3：checkpoint 台账 × 迁移审计 ×
 *                                          command journal 窗口 diff + 三源统一时间轴；逻辑在
 *                                          dev-review-data.mjs，台账/库缺失诚实降级）
 *  - /__atelier/review-ext.js              review 页扩展脚本（注入既有 review 页，不重写它）
 *  - /__atelier/bridge/commands?token=     SSE 命令下行流（页面 EventSource 订阅；连接自报 UA → 体检入账）
 * 桥接
 *  - POST /__atelier/bridge/state          页面状态推送（缓存给 state.snapshot）
 *  - POST /__atelier/bridge/enqueue        MCP/CLI 下发命令 {op,args} → SSE 广播
 *  - POST /__atelier/bridge/ack            页面执行结果回执
 *  - GET  /__atelier/bridge/cmd-status     命令执行状态轮询（done/pending）
 *  - POST /__atelier/mcp                   MCP 2026-07-28 无状态 HTTP 直连（FS-M6 §10.2：
 *                                          Mcp-Method/Mcp-Name 头路由；逻辑单源 mcp/http.mjs，
 *                                          这里只接线）
 * 安全：/__atelier/* 一律校验 token（页面经 transformIndexHtml 注入；工具从 .atelier/dev-token 读取）。
 * 审计：非 GET 的 /__atelier/* 与命令回执均追加 .atelier/audit.jsonl。
 */
import { createRequire } from "node:module";
import { capturePagePersistent as capturePage, captureA11yPersistent } from "./dev-screenshot.mjs";
import { createServerSupervisor, resolveServerConfig } from "./dev-server-host.mjs";
/* FS-M6 尾件批（D-F16/§11.2/§11.3）：路由逻辑在独立模块——本文件只做接线注册 */
import { buildReviewDataAsync } from "./dev-review-data.mjs";
import { endpointsPageHtml, reviewExtScript } from "./dev-review-pages.mjs";

/** P2-4 agent 体检：UA 启发式分类（Astro 7 模式借鉴）。诚实边界：启发式可被伪造——
 * 面向的是检视而非鉴权；页面桥 SSE 连接自报 UA 是最可靠的信号（MCP 工具链调用无 UA）。 */
function classifyAgent(ua) {
  const s = String(ua ?? "");
  if (!s) return "tooling"; // 无 UA：MCP server fetch / curl 等工具链调用
  if (/HeadlessChrome|Puppeteer|Playwright|electron/i.test(s)) return "headless";
  if (/^curl|^Wget|python-requests|Claude|GPTBot|anthropic/i.test(s)) return "tooling";
  if (/Mozilla/i.test(s)) return "human";
  return "unknown";
}

export function atelierDevPlugin() {
  const require = createRequire(import.meta.url);
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const ROOT = process.cwd();

  const TOKEN = crypto.randomUUID();
  fs.mkdirSync(path.join(ROOT, ".atelier"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, ".atelier", "dev-token"), TOKEN, "utf8");
  const AUDIT_FILE = path.join(ROOT, ".atelier", "audit.jsonl");
  const audit = (kind, detail) => {
    try {
      fs.appendFileSync(AUDIT_FILE, JSON.stringify({ kind, detail, at: new Date().toISOString() }) + "\n");
    } catch { /* audit must never break the app */ }
  };

  let latestBridgeState;
  let screenshotInflight = null;
  let a11yInflight = null;
  /* FS-7 dev 托管（§11.1）：server 面子进程监督器；挂在这层作用域以便 closeBundle 兜底收尾 */
  let serverSupervisor = null;
  /* FS-M6（D-F16 server-status 的父进程侧补充事实）：热重启计数 + 解析出的库路径（未托管 = null） */
  let serverRestarts = 0;
  let serverDbPath = null;

  /* ---- P2-4 agent 体检台账：连接分类 + 最近错误（JSON 结构化，/__atelier/agent-health 出口） ---- */
  const agentLedger = {
    startedAt: Date.now(),
    connections: { human: 0, headless: 0, tooling: 0, unknown: 0 },
    lastError: null,
  };

  /* ---- downlink (P0-1): queue → SSE broadcast → ack → status poll ---- */
  const sseClients = new Set();
  const resolved = new Map();
  let cmdSeq = 0;
  function readBody(req) {
    return new Promise((resolve) => {
      let b = "";
      req.on("data", (c) => (b += c.toString("utf-8")));
      req.on("end", () => resolve(b));
    });
  }

  return {
    name: "atelier-dev-plugin",
    transformIndexHtml(html) {
      // 页面注入一次性 dev token（EventSource 无法带自定义 header，走 query）
      return html.replace(/<head[^>]*>/i, (m) => `${m}\n<script>window.__ATELIER_TOKEN__=${JSON.stringify(TOKEN)};</script>`);
    },
    transform(code, id) {
      // P0-5 HMR：给组件模块注入 HMR 边界。accept 回调在新模块求值（组件已重注册）后
      // 触发 runtime 的保值重挂载——替代整页 reload，$state 不再清零。
      const p = id.replace(/\\/g, "/");
      if (!p.endsWith(".atr.ts") || p.includes("/node_modules/")) return null;
      if (code.includes("import.meta.hot")) return null;
      return {
        code:
          code +
          "\n;if (import.meta.hot) import.meta.hot.accept(() => { try { window.__ATELIER_HMR_REMOUNT__?.(); } catch (e) { console.error('[atelier] HMR remount failed', e); } });\n",
        map: null,
      };
    },
    configureServer(server) {
      /* ---------- FS-7 dev 托管（FS-DESIGN §11.1）：server 面 = 子进程 + <mount>/* 反向代理 ----------
       * 中间件注册在 /__atelier 之前（两者路径不重叠，顺序只为清晰）；src/server/** 与 src/contract.ts
       * 不在 Vite 前端模块图，watcher 事件只喂本监督器做热重启——前端 HMR 零牵连（决策 16
       * full-reload 死循环前科不允许重演，实现注记）。入口不存在（纯前端应用）则诚实跳过，
       * 插件其余功能照旧。 */
      const serverEntry = path.join(ROOT, "src", "server", "main-server.ts");
      if (fs.existsSync(serverEntry)) {
        let appCfg = {};
        try {
          appCfg = JSON.parse(fs.readFileSync(path.join(ROOT, "atelier.config.json"), "utf-8"));
        } catch { /* 读不到/坏 JSON → 全缺省（5174 / /api / .atelier/dev.db） */ }
        const sc = resolveServerConfig(appCfg, process.env);
        serverDbPath = sc.dbPath; // server-status 父进程侧补充事实（review-data 的 sqlite 兜底也用它）
        serverSupervisor = createServerSupervisor({ root: ROOT, port: sc.port, mount: sc.mount, dbPath: sc.dbPath, env: process.env });
        server.middlewares.use(serverSupervisor.middleware());
        serverSupervisor.start().catch((e) => console.error(`[atelier] ${e?.message ?? e}`));

        // watch 热重启：change/add/unlink 过滤路径后 debounce 150ms → restart（决策 16 防抖口径）
        const serverDirPrefix = path.join(ROOT, "src", "server") + path.sep;
        const contractFile = path.join(ROOT, "src", "contract.ts");
        let restartTimer = null;
        const scheduleRestart = (p) => {
          if (p !== contractFile && !String(p).startsWith(serverDirPrefix)) return;
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            serverRestarts += 1; // server-status 的 restarts 位（§10.3 运行时事实）
            serverSupervisor?.restart("src/server 面文件变更").catch((e) => console.error(`[atelier] ${e?.message ?? e}`));
          }, 150);
        };
        try {
          server.watcher.add([path.join(ROOT, "src", "server"), contractFile]);
          server.watcher.on("change", scheduleRestart);
          server.watcher.on("add", scheduleRestart);
          server.watcher.on("unlink", scheduleRestart);
        } catch { /* watcher 不可用（测试桩等）——热重启降级为手动，托管与代理照常 */ }

        // 收尾主路径：vite httpServer close → stop()（stop 幂等，与 closeBundle 双路径防双杀）
        server.httpServer?.once("close", () => {
          serverSupervisor?.stop();
          serverSupervisor = null;
        });
      } else {
        console.log(`[atelier] dev 托管跳过：src/server/main-server.ts 不存在（纯前端应用——server 面不托管，dev 面其余功能照旧）`);
      }

      /* ---------- FS-M6（D-F16/§10.3）：server 面内省代理 ----------
       * 子进程保留路由 GET <mount>/__atelier/server-status（server/introspect.ts 产出）经此代理 +
       * 补充父进程侧事实（restarts/dbPath/host）。child null = 未托管/热重启窗口/握手中——诚实
       * ok:false，绝不假数据（MCP 消费侧契约：ok!==true 即结构化报错，见 endpoint-tools.mjs）。 */
      const fetchChildStatus = async () => {
        const port = serverSupervisor?.targetPort?.() ?? null;
        if (!port) return null;
        try {
          const r = await fetch(`http://127.0.0.1:${port}/__atelier/server-status`, { signal: AbortSignal.timeout(4000) });
          if (!r.ok) return null;
          const child = await r.json();
          return {
            ...child,
            server: {
              ...(child.server ?? {}),
              restarts: serverRestarts,
              dbPath: serverDbPath,
              host: `127.0.0.1:${server.config.server.port ?? 5173}`, // 公共入口 = dev 面端口（/api 反代）
            },
          };
        } catch {
          return null; // 握手窗口/子进程刚退出——按未就绪处理
        }
      };

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? "";
        if (!rawUrl.startsWith("/__atelier/")) return next();

        // token gate（决策 9/12）：全部代理面路由统一校验
        const hasToken =
          req.headers["x-atelier-token"] === TOKEN || rawUrl.includes(`token=${TOKEN}`);
        if (!hasToken) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "ATR-402: invalid or missing X-Atelier-Token", fix: `read ${ROOT}\\.atelier\\dev-token and send header x-atelier-token` }));
          return;
        }

        // 审计策略：查询（GET）不入账；一切非 GET（命令/上报回执之外的实际动作）入账
        if (req.method !== "GET")
          audit("access", { method: req.method, url: rawUrl.split("?")[0], agent: classifyAgent(req.headers["user-agent"]) });

        const url = rawUrl.split("?")[0];
        res.setHeader("Content-Type", "application/json; charset=utf-8");

        /* ---------- FS-M6（§10.2）：/__atelier/mcp —— MCP 2026-07-28 无状态 HTTP 直连端点 ----------
         * 逻辑单源 = atelier/mcp/http.mjs（handleMcpHttp，与 stdio server.mjs 同一 callTool 核心）；
         * 这里只接线：token 门之后桥接。桥模块按框架仓布局解析（dev/ 与 mcp/ 同级；应用侧由
         * init/sync vendor 同构布局——scripts/ 与 mcp/ 同级，FS-M7 起名单含 MCP 族十件），vendored
         * 拷贝按同样的相对路径直连可用；旧应用未 sync（缺 mcp/ 族）时诚实降级指路补齐 vendor /
         * stdio 通道，绝不静默。 */
        if (url === "/__atelier/mcp") {
          const body = await readBody(req);
          let out;
          try {
            const bridge = await import(new URL("../mcp/http.mjs", import.meta.url).href);
            const mcpRequest = new Request(`http://127.0.0.1${rawUrl}`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "mcp-method": String(req.headers["mcp-method"] ?? ""),
                "mcp-name": String(req.headers["mcp-name"] ?? ""),
              },
              body: body || "{}",
            });
            out = await bridge.handleMcpHttp(mcpRequest, {
              projectRoot: ROOT,
              devUrl: `http://127.0.0.1:${server.config.server.port ?? 5173}`,
              devToken: TOKEN,
            });
          } catch (e) {
            out = {
              status: 503,
              contentType: "application/json; charset=utf-8",
              body: JSON.stringify({
                ok: false,
                error: {
                  code: "ATR-4xx-dev",
                  message: `MCP HTTP bridge not available in this install (${e?.message ?? e})`,
                  fix: "旧应用未含 MCP vendor：重跑 node <repo>/atelier/cli.mjs sync --target <appDir> 补齐 mcp/ 族 vendor 后直连即用（新 init 应用自带）；或走 stdio 通道（node <repo>/atelier/mcp/server.mjs，env ATELIER_PROJECT_ROOT=<appDir>）",
                },
              }),
            };
          }
          res.statusCode = out.status;
          res.setHeader("Content-Type", out.contentType ?? "application/json; charset=utf-8");
          res.end(out.body);
          return;
        }

        // P2-4：agent 体检出口（token 门内，JSON 结构化）
        if (url === "/__atelier/agent-health") {
          res.end(
            JSON.stringify({
              ok: true,
              at: Date.now(),
              uptimeMs: Date.now() - agentLedger.startedAt,
              connections: agentLedger.connections,
              sseClients: sseClients.size,
              bridgeStateAt: latestBridgeState?.at ?? null,
              lastError: agentLedger.lastError,
              note: "UA 启发式分类（human/headless/tooling），面向检视不面向鉴权",
            }),
          );
          return;
        }

        /* ---------- query face ---------- */
        /* ---------- FS-M6（D-F16/§11.2/§11.3）：server 内省代理 + 调试页 + review 扩展数据 ---------- */
        if (url === "/__atelier/server-status") {
          const status = await fetchChildStatus();
          if (status) res.end(JSON.stringify(status));
          else
            res.end(
              JSON.stringify({
                ok: false,
                note:
                  "server 面未托管/未就绪（src/server/main-server.ts 不存在，或监督器握手/热重启中）——端点注册表/journal/live 是子进程内存态，父进程无事实可报；fix：应用目录 pnpm dev（托管自动拉起）并确认 main-server.ts 装配了端点",
              }),
            );
          return;
        }
        if (url === "/__atelier/endpoints") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(endpointsPageHtml(TOKEN));
          return;
        }
        if (url === "/__atelier/review-data") {
          const anchor = new URL(rawUrl, "http://x").searchParams.get("anchor");
          let childStatus = null;
          try {
            childStatus = await fetchChildStatus();
          } catch {
            childStatus = null;
          }
          // 迁移审计兜底（server-status 不带迁移行时）：node:sqlite 只读直开 dev 库（诚实标注实验性，
          // 见 dev-review-data.mjs readMigrationsSqlite）——dbPath 用托管装配解析出的同一个
          const payload = await buildReviewDataAsync({ root: ROOT, serverStatus: childStatus, anchorId: anchor, dbPath: serverDbPath });
          res.end(JSON.stringify(payload));
          return;
        }
        if (url === "/__atelier/review-ext.js") {
          // review 页 <script src> 注入件（token 经 query——EventSource/脚本标签无自定义头，同页面既有约定）
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.end(reviewExtScript(TOKEN));
          return;
        }
        if (url === "/__atelier/registry") {
          const manifest = JSON.parse(fs.readFileSync(`${ROOT}/src/manifest.json`, "utf-8"));
          res.end(JSON.stringify({ ok: true, meta: { atelier: "v0.2", server: "dev" }, ...manifest }));
          return;
        }
        if (url === "/__atelier/tokens") {
          let groups = {};
          try {
            groups = JSON.parse(fs.readFileSync(`${ROOT}/atelier.config.json`, "utf-8")).tokens ?? {};
          } catch { /* guidance via skills layer */ }
          res.end(JSON.stringify({ ok: true, meta: { source: "atelier.config.json" }, groups }));
          return;
        }
        if (url === "/__atelier/state-snapshot") {
          res.end(JSON.stringify(latestBridgeState ?? { ok: false, note: "no browser has reported yet — open the app once in dev preview" }));
          return;
        }
        if (url === "/__atelier/audit") {
          const lines = Math.max(1, Math.min(500, Number(new URL(rawUrl, "http://x").searchParams.get("lines") ?? 50)));
          let rows = [];
          try {
            rows = fs.readFileSync(AUDIT_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(-lines);
          } catch { /* empty */ }
          res.end(JSON.stringify({ ok: true, rows }));
          return;
        }
        if (url === "/__atelier/docs") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(fs.readFileSync(`${ROOT}/src/llms.txt`, "utf-8"));
          return;
        }
        if (url === "/__atelier/stream-intro") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          const intro =
            "2026 年 8 月，DeepSeek-V4 正式接棒：deepseek-chat 与 deepseek-reasoner 统一升级至 V4 架构，" +
            "1M 超长上下文与 MoE 架构带来旗舰级推理表现；7 月 31 日发布的轻量旗舰 V4-Flash 把输出价格打到每百万 token 约 $0.28。" +
            "V3.2 开源的 DSA 稀疏注意力继续延用，权重保持开放下载，并适配华为昇腾生态。" +
            "本页面本身，就是 Atelier —— 一个 AI 原生前端框架的现场演示。";
          const chunked = Array.from(intro);
          let i = 0;
          const timer = setInterval(() => {
            if (i >= chunked.length) {
              clearInterval(timer);
              res.end();
              return;
            }
            res.write(chunked[i]);
            i += 1;
          }, 24);
          req.on("close", () => clearInterval(timer));
          return;
        }
        if (url === "/__atelier/screenshot") {
          // snapshot=1 → 页面进入确定性渲染（动画冻结、流式文本一次性落定），见 index.html
          // compare=1 → P1-8 像素级对比：与 .atr/snapshots/baseline.png 同实例 canvas evaluate
          const wantsCompare = rawUrl.includes("compare=1");
          const appUrl = `http://127.0.0.1:${server.config.server.port ?? 5173}/?snapshot=1`;
          try {
            let compareBase64 = null;
            let threshold = 0.12;
            if (wantsCompare) {
              try {
                const basePath = path.join(ROOT, ".atr", "snapshots", "baseline.png");
                if (fs.existsSync(basePath)) {
                  compareBase64 = fs.readFileSync(basePath).toString("base64");
                  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "atelier.config.json"), "utf-8"));
                  threshold = Number(cfg?.snapshot?.mismatchThreshold ?? 0.12);
                }
              } catch { /* compare/阈值是尽力而为：读不到就退化为纯捕获 */ }
            }
            // 有界重试 ×2：无头捕获偶发瞬态失败（GPU 进程/冷启动），快速失败后重试即可吸收
            let imageBase64 = "";
            let pixelDiff = null;
            let lastErr = null;
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                screenshotInflight ??= capturePage({ url: appUrl, compareBase64, threshold }).finally(() => { screenshotInflight = null; });
                const r = await screenshotInflight;
                imageBase64 = r.imageBase64;
                pixelDiff = r.pixelDiff;
                lastErr = null;
                break;
              } catch (e) {
                lastErr = e;
                await new Promise((r) => setTimeout(r, 800));
              }
            }
            if (lastErr) throw lastErr;
            audit("screenshot", { bytes: imageBase64.length, pixel: pixelDiff ? pixelDiff.mismatchRatio : null });
            res.end(JSON.stringify({ ok: true, format: "png", imageBase64, pixelDiff, threshold, capturedFrom: appUrl, at: Date.now() }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
          return;
        }

        /* ---------- P2-2③ a11y 快照（无障碍树文本化；agent 检视语义优先于像素）---------- */
        if (url === "/__atelier/a11y") {
          const appUrl = `http://127.0.0.1:${server.config.server.port ?? 5173}/`;
          try {
            a11yInflight ??= captureA11yPersistent({ url: appUrl }).finally(() => { a11yInflight = null; });
            const r = await a11yInflight;
            audit("a11y", { nodes: r.nodeCount });
            res.end(JSON.stringify({ ok: true, a11y: r.a11y, nodeCount: r.nodeCount, capturedFrom: appUrl, at: Date.now() }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
          return;
        }

        /* ---------- review UI（P2-5 spec L5 最小版）---------- */
        if (url === "/__atelier/feedback") {
          // 与 MCP feedback.read 同一约定：specs/feedback.jsonl 每行 {at,verdict,target,note}
          const body = await readBody(req);
          let parsed = {};
          try { parsed = JSON.parse(body || "{}"); } catch { /* falls through */ }
          const verdict = parsed.verdict === "approve" || parsed.verdict === "disapprove" ? parsed.verdict : null;
          if (!verdict) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "verdict must be \"approve\" | \"disapprove\"", fix: "POST {verdict, target?, note?}" }));
            return;
          }
          const row = { at: new Date().toISOString(), verdict, target: String(parsed.target ?? "snapshot"), note: String(parsed.note ?? "") };
          try {
            fs.mkdirSync(path.join(ROOT, "specs"), { recursive: true });
            fs.appendFileSync(path.join(ROOT, "specs", "feedback.jsonl"), JSON.stringify(row) + "\n", "utf-8");
            audit("feedback", row);
            res.end(JSON.stringify({ ok: true, row, path: "specs/feedback.jsonl" }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
          return;
        }
        if (url === "/__atelier/snapshot-image") {
          // baseline/current 基线图直接从磁盘出（review 页 <img> 用；白名单外一律 404）
          const name = new URL(rawUrl, "http://x").searchParams.get("name") ?? "";
          if (name !== "baseline" && name !== "current") {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: "name must be baseline | current" }));
            return;
          }
          const p = path.join(ROOT, ".atr", "snapshots", `${name}.png`);
          if (!fs.existsSync(p)) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: `no ${name}.png yet (run 'atelier snapshot save' / snapshot.diff)` }));
            return;
          }
          res.setHeader("Content-Type", "image/png");
          res.end(fs.readFileSync(p));
          return;
        }
        if (url === "/__atelier/review") {
          // spec L5 最小版：timeline + 双图并排 + approve/disapprove 写回 specs/
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Atelier Review</title><style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#1a1a2e;background:#fafafa}
h1{font-size:18px} h2{font-size:15px;margin:18px 0 8px}
.row{display:flex;gap:16px;flex-wrap:wrap}.col{flex:1;min-width:320px}
.card{background:#fff;border:1px solid #e2e2e8;border-radius:8px;padding:14px}
img{max-width:100%;border:1px solid #ddd;background:#fff}
button{padding:6px 14px;border-radius:6px;border:1px solid #c9c9d4;background:#fff;cursor:pointer}
button.approve{border-color:#2e7d32;color:#2e7d32}button.disapprove{border-color:#c62828;color:#c62828}
button:hover{filter:brightness(.96)}
input{padding:6px 8px;border:1px solid #c9c9d4;border-radius:6px;width:60%}
li{margin:2px 0}.muted{color:#777}.ok{color:#2e7d32}.bad{color:#c62828}
#msg{margin-top:8px;min-height:20px}
</style></head><body>
<h1>Atelier Review <span class="muted">— spec L5（timeline · 双图并排 · 判定写回 specs/）</span></h1>
<div class="row"><div class="col card"><h2>Checkpoint timeline</h2><ul id="timeline" class="muted">loading…</ul>
<div class="muted" id="meta"></div></div>
<div class="col card"><h2>判定（写回 specs/feedback.jsonl）</h2>
<input id="note" placeholder="note（可空）"/><br/><br/>
<button class="approve" id="approve">👍 Approve</button>
<button class="disapprove" id="disapprove">👎 Disapprove</button>
<div id="msg"></div><h2>历史判定</h2><ul id="history" class="muted">loading…</ul></div></div>
<h2>双图并排（baseline ｜ current） <button id="fresh">Fresh capture</button> <button id="reload">Reload images</button></h2>
<div class="row"><div class="col card"><div class="muted">baseline</div><img id="baseline" alt="baseline"/></div>
<div class="col card"><div class="muted">current</div><img id="current" alt="current"/></div></div>
<script>
const TOKEN = ${JSON.stringify(TOKEN)};
const H = { "x-atelier-token": TOKEN };
const $ = (id) => document.getElementById(id);
function esc(s){const d=document.createElement("div");d.textContent=String(s??"");return d.innerHTML;}
async function loadState(){
  try{ const j = await (await fetch("/__atelier/state-snapshot",{headers:H})).json();
    const tl = Array.isArray(j.timeline) ? j.timeline : [];
    $("timeline").innerHTML = tl.length ? tl.map(c=>'<li><code>'+esc(c.id)+'</code> '+esc(c.name)+' <span class="muted">'+esc(new Date(c.at).toLocaleString())+'</span></li>').join("") : "<li>(empty — store.commit 会出现在这里)</li>";
    $("meta").textContent = "signals="+(j.signalCount??0)+" · checkpoints="+(j.checkpointCount??0)+" · "+(j.href??"");
  }catch(e){ $("timeline").innerHTML = "<li>state-snapshot 不可达（页面未打开过？）</li>"; }
}
function bust(){ return "?t="+Date.now(); }
function loadImages(){ $("baseline").src = "/__atelier/snapshot-image?name=baseline"+bust(); $("current").src = "/__atelier/snapshot-image?name=current"+bust(); }
async function loadHistory(){
  try{ const j = await (await fetch("/__atelier/feedback-history",{headers:H})).json();
    $("history").innerHTML = (j.rows??[]).length ? j.rows.map(r=>'<li>'+esc(r.at)+' <b class="'+(r.verdict==="approve"?"ok":"bad")+'">'+esc(r.verdict)+'</b> '+esc(r.target)+(r.note?' — '+esc(r.note):'')+'</li>').join("") : "<li>(none)</li>";
  }catch(e){ $("history").innerHTML = "<li>(unreadable)</li>"; }
}
async function send(verdict){
  $("msg").textContent = "…writing";
  const r = await fetch("/__atelier/feedback",{method:"POST",headers:{...H,"content-type":"application/json"},
    body: JSON.stringify({ verdict, target: "snapshot:"+location.search, note: $("note").value })});
  const j = await r.json();
  $("msg").innerHTML = j.ok ? '<span class="ok">written → '+esc(j.path)+'</span>' : '<span class="bad">'+esc(j.error)+'</span>';
  loadHistory();
}
$("approve").onclick = () => send("approve");
$("disapprove").onclick = () => send("disapprove");
$("reload").onclick = loadImages;
$("fresh").onclick = async () => {
  $("msg").textContent = "capturing…";
  try{ const j = await (await fetch("/__atelier/screenshot",{headers:H})).json();
    if(j.ok){ $("current").src = "data:image/png;base64,"+j.imageBase64; $("msg").textContent = "fresh capture ok（落盘请用 snapshot.diff / atelier snapshot）"; }
    else $("msg").textContent = j.error ?? "capture failed";
  }catch(e){ $("msg").textContent = String(e); }
};
loadState(); loadImages(); loadHistory();
</script>
<script src="/__atelier/review-ext.js?token=${TOKEN}"></script>
</body></html>`);
          return;
        }
        if (url === "/__atelier/feedback-history") {
          let rows = [];
          try {
            rows = fs.readFileSync(path.join(ROOT, "specs", "feedback.jsonl"), "utf-8")
              .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
          } catch { /* none yet */ }
          res.end(JSON.stringify({ ok: true, rows }));
          return;
        }

        /* ---------- bridge: up-push / downlink ---------- */
        if (url === "/__atelier/bridge/state") {
          const body = await readBody(req);
          try {
            latestBridgeState = JSON.parse(body);
          } catch {
            latestBridgeState = { ok: false, parseError: true };
          }
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (url === "/__atelier/bridge/commands") {
          // SSE downlink stream
          const agent = classifyAgent(req.headers["user-agent"]);
          agentLedger.connections[agent] = (agentLedger.connections[agent] ?? 0) + 1;
          audit("page-connect", { agent, ua: String(req.headers["user-agent"] ?? "") }); // P2-4：结构化日志
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.writeHead(200);
          res.write("retry: 2000\n\n");
          sseClients.add(res);
          req.on("close", () => sseClients.delete(res));
          return;
        }
        if (url === "/__atelier/bridge/enqueue") {
          const body = await readBody(req);
          let op = "", args;
          try {
            const j = JSON.parse(body);
            op = String(j.op ?? "");
            args = j.args ?? {};
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "invalid json" }));
            return;
          }
          const id = `cmd-${++cmdSeq}`;
          audit("command.enqueue", { id, op, args });
          const payload = `data: ${JSON.stringify({ id, op, args })}\n\n`;
          for (const c of sseClients) c.write(payload);
          res.end(JSON.stringify({ ok: true, id, clients: sseClients.size }));
          return;
        }
        if (url === "/__atelier/bridge/ack") {
          const body = await readBody(req);
          try {
            const j = JSON.parse(body);
            resolved.set(j.id, { status: "done", ok: !!j.ok, result: j.result, error: j.error, at: new Date().toISOString() });
            if (!j.ok && j.error) agentLedger.lastError = String(j.error).slice(0, 300); // P2-4
            audit("command.ack", { id: j.id, ok: j.ok });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "invalid ack" }));
          }
          return;
        }
        if (url === "/__atelier/bridge/cmd-status") {
          const id = new URL(rawUrl, "http://x").searchParams.get("id") ?? "";
          const st = resolved.get(id);
          res.end(JSON.stringify(st ? { ...st, status: "done" } : { status: "pending" }));
          return;
        }
        next();
      });
    },
    closeBundle() {
      // 收尾兜底：httpServer close 之外的路径（如 --force 关停）；stop 幂等，双调用安全
      serverSupervisor?.stop();
      serverSupervisor = null;
    },
  };
}
