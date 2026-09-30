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
 * transform：.atr.ts 注入 HMR 边界（P0-5）+ props 注解 schema 提取注册（决策 26，prepend
 *           registerExtractedSchemas——提取器 compiler/extract-schema.mjs，vendor 名单内）
 * 安全：/__atelier/* 一律校验 token——三通道：x-atelier-token 头 / token 查询参数（工具链 curl·MCP
 *       直连保留）/ 一次性 cookie（浏览器首访 ?token= → HttpOnly+SameSite=Strict cookie + 302 清洗
 *       URL，token 不再内嵌 HTML——P1-12）；token 落盘 .atelier/dev-token 即 0600。另设 Origin/Host
 *       白名单闸（伪造来源页驱动的浏览器请求在此拦断）与 JSON 体路由 content-type 收紧（封 no-cors
 *       text/plain 伪装 JSON 体跨站写）。
 * 审计：非 GET 的 /__atelier/* 与命令回执均追加 .atelier/audit.jsonl。
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { capturePagePersistent as capturePage, captureA11yPersistent } from "./dev-screenshot.mjs";
import { createServerSupervisor, originAllowlist, originAllowed, resolveServerConfig } from "./dev-server-host.mjs";
/* FS-M6 尾件批（D-F16/§11.2/§11.3）：路由逻辑在独立模块——本文件只做接线注册 */
import { buildReviewDataAsync } from "./dev-review-data.mjs";
import { endpointsPageHtml, reviewExtScript } from "./dev-review-pages.mjs";

/* P1 #3 起 Origin/Host 白名单原语单源 dev-server-host.mjs（反代闸与 P1-12 闸共用同一实现）——
 * 此处 re-export 保持 P1-12 既有导出面（tests/dev-face-security 与应用侧消费）不变。 */
export { originAllowlist, originAllowed };

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

/* ---- P1-12 ①：dev 面 Origin/Host 白名单 + JSON content-type 原语（导出=单元红检可达；闭包内只能整链黑盒）----
 * 威胁模型一句话：dev-token 是 dev 面唯一信任锚，而浏览器对跨站 no-cors 请求仍会打到 /__atelier/*——
 * 无来源闸时，token 门挡不住「伪造来源页驱动浏览器直接跨站写」这一族 CSRF（P1-12）。
 * P1 #3 起 originAllowlist/originAllowed 单源下沉 dev-server-host.mjs（文件顶部 re-export）。 */
export const DEV_COOKIE = "atelier_dev_token";

/** JSON 体路由 content-type 收紧：仅 application/json（可带参数）受理——封 no-cors text/plain 伪装。 */
export function isJsonContentType(ct) {
  return /^application\/json\s*(?:;|$)/i.test(String(ct ?? "").trim());
}

/** token 比较：先哈希到定长再做 timing-safe 对比（不泄长度；通道覆盖 header/查询参数/cookie）。 */
function tokenEq(a, b) {
  const h = (s) => createHash("sha256").update(String(s ?? ""), "utf8").digest();
  return timingSafeEqual(h(a), h(b));
}

/** 浏览器导航判别：Sec-Fetch-Mode 优先（现代浏览器导航全带），缺省回退 Accept: text/html。
 *  工具链 fetch/EventSource 不属导航——token→cookie 一次性交换只应发生在页面导航上。 */
function isNavigation(req) {
  const sfm = String(req.headers["sec-fetch-mode"] ?? "");
  if (sfm) return sfm === "navigate";
  return String(req.headers.accept ?? "").includes("text/html");
}

function cookieValue(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i >= 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/* ---- R3 结构债（评审 §2.2 风险 2 / §4.6）：路由匹配原语导出（可直测）----
 * P1-14 教训：mount 前缀边界 bug 能活到今天，正说明路由匹配逻辑无法被单独测试——atelierFace
 * 原为约 470 行 if-chain（20+ 路由整链黑盒）。匹配三原语抽成模块级纯函数（tests/dev-face-routes
 * 直测），分派面 = configureServer 期的路由表（插件实例 __atelierRouteTable 直测面）。 */

/** dev 面 mount 前缀（尾斜杠是语义的一部分：裸 "/__atelier" 不属 dev 面，交还 Vite）。 */
export const ATELIER_FACE_PREFIX = "/__atelier/";

/** mount 边界判别：原始 URL（含 query）是否进入 dev 面闸门链。前缀吞噬防线：/、/__atelier、
 * /__atelierEvil、/api/__atelier/* 一律 false。 */
export function isAtelierFace(rawUrl) {
  return String(rawUrl ?? "").startsWith(ATELIER_FACE_PREFIX);
}

/** 路由键归一：query 剥离（首个 ? 起）。与原 `rawUrl.split("?")[0]` 逐字节同语义。 */
export function stripQuery(rawUrl) {
  return String(rawUrl ?? "").split("?")[0];
}

/** 路由表匹配（exact-match）：完整路径相等才命中，绝不前缀吞噬（/__atelier/review ≠
 * /__atelier/review-data）。query 必须已由 stripQuery 剥离；同路径重复登记首条胜（find 语义）。 */
export function matchRoute(table, url) {
  return table.find((r) => r.path === url) ?? null;
}

/** 路由表项构造（可读性标签）。handle 签名 (req, res, rawUrl)——rawUrl 为含 query 的原始 URL。 */
function devRoute(path, handle) {
  return { path, handle };
}

/** resolved 命令回执台账上限（§4.6：Map 永不清理 → 有界 FIFO 逐出；dev server 长跑不无界增长）。 */
export const MAX_RESOLVED = 200;

/** 有界修剪（纯函数，可直测）：超 cap 按插入序逐出最旧条目（Map 迭代序 = 插入序）；cap 内零变化。 */
export function pruneResolved(map, cap = MAX_RESOLVED) {
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return map;
}

export function atelierDevPlugin() {
  const require = createRequire(import.meta.url);
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const ROOT = process.cwd();

  const TOKEN = crypto.randomUUID();
  fs.mkdirSync(path.join(ROOT, ".atelier"), { recursive: true });
  // P1-12 ②：dev-token 是 dev 面唯一信任锚，落盘即 0600（写时 mode + chmod 兜底）。
  // 平台语义：POSIX 完整；win32 的 chmod 只映射 read-only 位（0o600 含写位 → 可写文件），尽力而为。
  fs.writeFileSync(path.join(ROOT, ".atelier", "dev-token"), TOKEN, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(path.join(ROOT, ".atelier", "dev-token"), 0o600); } catch { /* 平台不支持时写时 mode 已尽力 */ }
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

  /* ---------- 决策 26：schema 编译期提取 v1 —— .atr.ts transform 注入 ----------
   * 提取器 = <app>/compiler/extract-schema.mjs（零依赖自包含，init/sync vendor 名单内；
   * 框架源 atelier/compiler/extract-schema.mjs ↔ 应用 scripts/ 同构映射）。运行时按
   * ROOT（process.cwd() = 应用根，与 dev-token/audit/manifest 同一约定）惰性动态 import：
   *   · 静态顶层 import 不可取——旧应用未 sync（缺提取器件）时整个插件模块加载即炸，dev 面全灭；
   *     惰性 + 诚实降级（通知一次 + 跳过注入）与 /__atelier/mcp 503 指路同一分寸。结果按插件
   *     实例缓存（失败也缓存）：sync 属 vendor 变更，本就要求重启 dev 生效。
   *   · <rel> = 该 .atr.ts 所在目录 → src/runtime/index.ts（init vendor 布局的桶出口）的相对
   *     import 说明符（posix 斜杠；无 ./ 前缀的相对 import 补 ./——Vite/ESM 语义）；文件在 src 外
   *     → 解析失败，跳过注入 + console.warn（诚实不静默）。
   *   · **prepend 而非 append**：component() 在模块求值期执行，sink 注册必须先于它——append 到
   *     文件尾时组件已带着 schema=undefined 完成注册；prepend 段在 HMR 模块重求值时随之重跑，
   *     sink 覆盖刷新（决策 26）。提取的 schema 与 dump 工件同源同函数（extractPropsSchemas），
   *     单一真相不漂移；显式手写 schema 仍优先（sink 不覆盖 opts.schema，决策 26 ③）。
   *   · extractPropsSchemas 抛 ATR-102（注解类型超出映射面）→ 原样上抛，Vite overlay 即红，
   *     作者当场看到四段式；既有 HMR 尾巴逻辑不动，非 .atr.ts 文件零影响（早退分支保持）。
   */
  let extractorPromise = null;
  function loadSchemaExtractor() {
    extractorPromise ??= (async () => {
      const file = path.join(ROOT, "compiler", "extract-schema.mjs");
      try {
        return await import(pathToFileURL(file).href);
      } catch (e) {
        // 跳过通知走 stdout（与「dev 托管跳过」同款分寸）——build 门禁钉 stderr 干净，
        // 降级通知要可见但不属于错误通道。
        console.log(
          `[atelier] schema 提取器不可达（${file} 缺失——旧应用请 node <repo>/atelier/cli.mjs sync --target <appDir> 补 vendor）：` +
            `${e?.message ?? e}；.atr.ts 注解 schema 注入跳过（诚实降级，组件开发不受阻）`,
        );
        return null;
      }
    })();
    return extractorPromise;
  }
  function runtimeRelImport(id) {
    const fileDir = path.dirname(id);
    const srcRoot = path.join(ROOT, "src");
    const fromSrc = path.relative(srcRoot, fileDir);
    if (fromSrc.startsWith("..") || path.isAbsolute(fromSrc)) return null; // 文件在 src 外 → 解析失败
    let rel = path.relative(fileDir, path.join(srcRoot, "runtime", "index.ts")).split(path.sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`; // ESM/Vite：相对 import 必须以 ./ 或 ../ 起
    return rel.replace(/\/index\.ts$/, ""); // 桶出口按目录形式引（与组件既有 from "../runtime" 同型）
  }
  async function schemaInjectPrefix(code, id) {
    const extractor = await loadSchemaExtractor();
    if (!extractor?.extractPropsSchemas) return ""; // 提取器缺失 → 已通知（stdout），跳过
    const entries = extractor.extractPropsSchemas(code); // ATR-102 → 原样上抛（Vite overlay 即红）
    const map = {};
    for (const en of entries ?? []) if (en && en.name && en.schema != null) map[en.name] = en.schema;
    if (Object.keys(map).length === 0) return ""; // 映射为空（注解缺省/全部 null）→ 注入零变化
    const rel = runtimeRelImport(id);
    if (!rel) {
      console.warn(`[atelier] ${id}: 不在 src/ 下，解析不到 src/runtime 桶出口——schema 注入跳过（诚实不静默）`);
      return "";
    }
    return `import { registerExtractedSchemas as __atelierRs } from ${JSON.stringify(rel)};\n__atelierRs(${JSON.stringify(map)});\n`;
  }

  /* R3 结构债：具名 api 对象——configureServer 期把路由表挂到实例上（__atelierRouteTable 直测面，
   * 运行时零消费；见 tests/dev-face-routes.test.ts）。 */
  const api = {
    name: "atelier-dev-plugin",
    // enforce pre：transform 必须看到**原始 TS 源**——决策 26 的 schema 注入从 (props: {...})
    // 注解提取 schema，而 Vite 7 的内部 esbuild 剥类型先于普通用户插件 transform 跑
    // （真 dev 冒烟实证：普通序拿到的已是 SchemaProbe2(props) 脱注解形态，提取恒空）。
    // pre 对非 .atr.ts 零影响（早退分支），HMR 尾巴 append 到原始源后经 esbuild 语义不变。
    enforce: "pre",
    // P1-12 ②：transformIndexHtml 的 window.__ATELIER_TOKEN__ 注入已移除——token 不再进 HTML。
    // 浏览器侧走一次性通道（首访 ?token= → HttpOnly cookie + 302 清洗，见 configureServer 顶部），
    // 页面侧 fetch/EventSource 靠同源自动携带的 cookie 过 token 门；runtime 的 devFetch/bridge
    // 读不到 __ATELIER_TOKEN__ 时发送空头，由 cookie 通道放行。
    async transform(code, id) {
      // P0-5 HMR：给组件模块注入 HMR 边界。accept 回调在新模块求值（组件已重注册）后
      // 触发 runtime 的保值重挂载——替代整页 reload，$state 不再清零。
      const p = id.replace(/\\/g, "/");
      if (!p.endsWith(".atr.ts") || p.includes("/node_modules/")) return null;
      // 决策 26：schema 注入段（prepend——理由见 schemaInjectPrefix 上方注释块）；
      // ATR-102 由此原样上抛，映射为空时注入零变化。
      const prefix = await schemaInjectPrefix(code, id);
      if (code.includes("import.meta.hot")) {
        return prefix ? { code: prefix + code, map: null } : null;
      }
      return {
        code:
          prefix +
          code +
          "\n;if (import.meta.hot) import.meta.hot.accept(() => { try { window.__ATELIER_HMR_REMOUNT__?.(); } catch (e) { console.error('[atelier] HMR remount failed', e); } });\n",
        map: null,
      };
    },
    configureServer(server) {
      /* ---------- P1 #10：actualPort 单源 ----------
       * Vite strictPort 缺省 false：配置端口被占时自动 +1，config.server.port 不变——此前 7 处硬用
       * 配置端口（fetchChildStatus host / selfPort〔cookie 名 + Origin 白名单〕/ mcp devUrl /
       * screenshot appUrl+navUrl / a11y appUrl+navUrl）在漂移后全错：截图导航打到错误端口（可能
       * 拍到另一项目）、cookie `atelier_dev_token-5173` 两实例互踩（P1-12 承诺的并行隔离恰在并行
       * 场景失效）。listen 后从 httpServer.address() 取实际端口缓存为唯一真相；configureServer 期
       * （listen 前）配置值先顶上，listening 事件里 adopt。无 httpServer（测试桩 / middlewareMode）
       * → 配置值即终值。所有消费点全部请求期求值，漂移后天然拿到实际端口。 */
      const configuredPort = server.config?.server?.port ?? 5173;
      let actualPort = configuredPort;
      const announceTokenUrl = () =>
        console.log(
          `[atelier] dev bridge：浏览器首访 http://127.0.0.1:${actualPort}/?token=${TOKEN} 建立会话（P1-12：token 已不内嵌页面；` +
          `工具链照旧读 .atelier/dev-token 走 x-atelier-token 头）`,
        );
      const devHttpServer = server.httpServer ?? null;
      if (devHttpServer) {
        const adoptActualPort = () => {
          const addr = devHttpServer.address?.();
          if (addr && typeof addr === "object" && Number.isFinite(addr.port) && addr.port > 0 && addr.port !== actualPort) {
            actualPort = addr.port;
            console.log(
              `[atelier] dev face 端口漂移：配置 ${configuredPort} 被占 → 实际 ${actualPort}（strictPort 缺省 false）——` +
              `token URL/cookie/Origin 白名单/截图/a11y 全部改用实际端口`,
            );
          }
          announceTokenUrl();
        };
        if (devHttpServer.listening) adoptActualPort();
        else devHttpServer.once("listening", adoptActualPort);
      } else {
        announceTokenUrl();
      }

      /* ---------- FS-7 dev 托管（FS-DESIGN §11.1）：server 面 = 子进程 + <mount>/* 反向代理 ----------
       * 中间件注册在 /__atelier 之前（两者路径不重叠，顺序只为清晰）；src/server/** 与 src/contract.ts
       * 不在 Vite 前端模块图，watcher 事件只喂本监督器做热重启——前端 HMR 零牵连（决策 16
       * full-reload 死循环前科不允许重演，实现注记）。入口不存在（纯前端应用）则诚实跳过，
       * 插件其余功能照旧。P1 #3：监督器带 selfPort（函数口径=actualPort，漂移后白名单跟随）与
       * 配置 host——反代 <mount>/* 与 /__atelier/* 同一 Origin 闸口径。 */
      const serverEntry = path.join(ROOT, "src", "server", "main-server.ts");
      if (fs.existsSync(serverEntry)) {
        let appCfg = {};
        try {
          appCfg = JSON.parse(fs.readFileSync(path.join(ROOT, "atelier.config.json"), "utf-8"));
        } catch { /* 读不到/坏 JSON → 全缺省（5174 / /api / .atelier/dev.db） */ }
        const sc = resolveServerConfig(appCfg, process.env);
        serverDbPath = sc.dbPath; // server-status 父进程侧补充事实（review-data 的 sqlite 兜底也用它）
        serverSupervisor = createServerSupervisor({ root: ROOT, port: sc.port, mount: sc.mount, dbPath: sc.dbPath, env: process.env, selfPort: () => actualPort, selfHosts: server.config?.server?.host });
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
          // A2 硬化5 生态位：应用若把 server 面 statusToken 装配为 dev-token 同值（双面同钥），
          // 此代理自动携带 x-atelier-token；子进程未设门禁时忽略该头，零影响。
          const r = await fetch(`http://127.0.0.1:${port}/__atelier/server-status`, {
            signal: AbortSignal.timeout(4000),
            headers: { "x-atelier-token": TOKEN },
          });
          if (!r.ok) return null;
          const child = await r.json();
          return {
            ...child,
            server: {
              ...(child.server ?? {}),
              restarts: serverRestarts,
              dbPath: serverDbPath,
              host: `127.0.0.1:${actualPort}`, // P1 #10：公共入口 = dev 面实际端口（漂移后不再是配置值）
            },
          };
        } catch {
          return null; // 握手窗口/子进程刚退出——按未就绪处理
        }
      };

      /* ---------- P1-12 ①② 闸位预置 ----------
       * selfOrigins：Origin 白名单（自身授权方集合）；cookieName 带端口后缀——cookie 不隔离端口，
       * 同机并行多只 dev server 各持各的 token，同名 cookie 会互相踩。
       * P1 #10：两者一律请求期求值 actualPort——漂移后白名单与 cookie 名跟随实际端口
       * （`atelier_dev_token-4321` 写死配置端口时，并行隔离恰在并行场景失效）。 */
      const selfOrigins = () => originAllowlist(actualPort, server.config.server.host);
      const cookieName = () => `${DEV_COOKIE}-${actualPort}`;
      // JSON 体路由统一收紧：content-type 一旦存在必须 application/json——封 no-cors text/plain
      // 族 simple-type 伪装写（P1-12）。缺失 = 非浏览器工具链（curl/MCP 直连不带头）放行：浏览器
      // 带体 POST 必有 content-type；浏览器写的主闸是 Origin 门（sendBeacon 连伪造的
      // application/json 也会携 Origin），此门是第二道。
      const rejectNonJson = (req, res) => {
        const ct = req.headers["content-type"];
        if (ct == null || isJsonContentType(ct)) return true;
        res.statusCode = 415;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "ATR-415: dev face JSON routes accept application/json only", fix: "send Content-Type: application/json（no-cors text/plain 伪装写通道已封——P1-12）" }));
        return false;
      };
      // P1 #10：就绪公告在 actualPort 单源块统一打（announceTokenUrl，漂移后重打实际端口）——
      // 此处不再重复打印配置端口版本

      /* P1 #12：async 中间件错误围栏。connect/Vite 不 await 中间件 promise——路由处理裸抛
       * （如 /__atelier/registry、/__atelier/docs 的 readFileSync ENOENT）= 请求永久悬挂 +
       * unhandledRejection 击杀 dev server。外层统一 catch → 500 ATR JSON（error 含原始原因；
       * 响应已开始改不了头 → 如实 destroy）。 */
      const atelierFace = async (req, res, next) => {
        const rawUrl = req.url ?? "";

        /* ---------- P1-12 ② token 一次性通道 ----------
         * 带有效 token 的页面导航 → Set-Cookie(HttpOnly+SameSite=Strict) + 302 清洗 URL。此后页面
         * 不再内嵌 token，API 鉴权走同源自动携带的 cookie。只认导航请求（isNavigation）：工具链
         * GET ?token= 与 EventSource 通道零影响；token 即凭证——通道本身不构成新攻击面。 */
        const u = new URL(rawUrl, "http://x");
        const qToken = u.searchParams.get("token");
        if (req.method === "GET" && qToken != null && tokenEq(qToken, TOKEN) && isNavigation(req)) {
          audit("token-exchange", { path: u.pathname, agent: classifyAgent(req.headers["user-agent"]) });
          u.searchParams.delete("token");
          res.statusCode = 302;
          res.setHeader("Location", `${u.pathname}${u.search}`);
          res.setHeader("Set-Cookie", `${cookieName()}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`);
          res.setHeader("Cache-Control", "no-store");
          res.end();
          return;
        }

        if (!isAtelierFace(rawUrl)) return next(); // mount 边界（纯函数可直测——P1-14 教训）

        /* ---------- P1-12 ① Origin/Host 闸 ----------
         * Origin 头存在且不属于自身授权方（127.0.0.1/localhost/[::1]/配置 host）也不与 Host 头同源
         * → 403：跨站页面驱动的浏览器请求（含 no-cors 写）在此拦断。无 Origin 的非浏览器客户端
         * （curl/MCP HTTP 直连）不受影响——token 仍是其凭证。 */
        if (req.headers.origin != null && !originAllowed(req.headers.origin, selfOrigins(), req.headers.host)) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "ATR-403-dev: cross-origin request to the dev face is rejected", fix: "从应用自身 origin（127.0.0.1/localhost）打开 dev 面；工具链以无 Origin 通道携 x-atelier-token 调用" }));
          return;
        }

        // token gate（决策 9/12 + P1-12）：三通道——header / 查询参数（非浏览器客户端保留）/ 一次性 cookie（浏览器）
        const hasToken =
          tokenEq(req.headers["x-atelier-token"], TOKEN) ||
          tokenEq(qToken, TOKEN) ||
          tokenEq(cookieValue(req.headers.cookie, cookieName()), TOKEN);
        if (!hasToken) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "ATR-405: invalid or missing X-Atelier-Token", fix: `tools: read ${ROOT}\\.atelier\\dev-token and send header x-atelier-token; browsers: open the page once with ?token=<token>` }));
          return;
        }

        // 审计策略：查询（GET）不入账；一切非 GET（命令/上报回执之外的实际动作）入账
        if (req.method !== "GET")
          audit("access", { method: req.method, url: rawUrl.split("?")[0], agent: classifyAgent(req.headers["user-agent"]) });

        const url = stripQuery(rawUrl);
        res.setHeader("Content-Type", "application/json; charset=utf-8");

        /* R3 结构债：表驱动分派（原约 470 行 if-chain → ROUTES 路由表）。exact-match 纯函数匹配
         * （matchRoute 可直测——P1-14 教训）；表在 atelierFace 之后定义（const 闭包：configureServer
         * 同步跑完即初始化，请求期才调用，无 TDZ 窗口）。 */
        const route = matchRoute(ROUTES, url);
        if (!route) return next();
        await route.handle(req, res, rawUrl);
      };

      /* ---------- 路由表（原 if-chain 逐条平移：条目顺序 = 原源顺序，exact-match 互斥保序只为
       * 可读性；handler 体逐字节未动，第三个参数 rawUrl = 含 query 的原始 URL）---------- */
      const ROUTES = [
        /* ---------- FS-M6（§10.2）：/__atelier/mcp —— MCP 2026-07-28 无状态 HTTP 直连端点 ----------
         * 逻辑单源 = atelier/mcp/http.mjs（handleMcpHttp，与 stdio server.mjs 同一 callTool 核心）；
         * 这里只接线：token 门之后桥接。桥模块按框架仓布局解析（dev/ 与 mcp/ 同级；应用侧由
         * init/sync vendor 同构布局——scripts/ 与 mcp/ 同级，FS-M7 起名单含 MCP 族十件），vendored
         * 拷贝按同样的相对路径直连可用；旧应用未 sync（缺 mcp/ 族）时诚实降级指路补齐 vendor /
         * stdio 通道，绝不静默。 */
        devRoute("/__atelier/mcp", async (req, res, rawUrl) => {
          if (!rejectNonJson(req, res)) return;
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
              devUrl: `http://127.0.0.1:${actualPort}`, // P1 #10：漂移后跟实际端口
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
        }),

        // P2-4：agent 体检出口（token 门内，JSON 结构化）
        devRoute("/__atelier/agent-health", async (req, res) => {
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
        }),

        /* ---------- query face ---------- */
        /* ---------- FS-M6（D-F16/§11.2/§11.3）：server 内省代理 + 调试页 + review 扩展数据 ---------- */
        devRoute("/__atelier/server-status", async (req, res) => {
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
        }),
        devRoute("/__atelier/endpoints", async (req, res) => {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(endpointsPageHtml()); // P1-12：页面不再内嵌 token——fetch 靠同源 cookie
        }),
        devRoute("/__atelier/review-data", async (req, res, rawUrl) => {
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
        }),
        devRoute("/__atelier/review-ext.js", async (req, res) => {
          // review 页 <script src> 注入件（P1-12：不再带 token 查询——脚本请求同源自动携 cookie）
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.end(reviewExtScript());
        }),
        devRoute("/__atelier/registry", async (req, res) => {
          const manifest = JSON.parse(fs.readFileSync(`${ROOT}/src/manifest.json`, "utf-8"));
          res.end(JSON.stringify({ ok: true, meta: { atelier: "v1.1", server: "dev" }, ...manifest }));
        }),
        devRoute("/__atelier/tokens", async (req, res) => {
          let groups = {};
          try {
            groups = JSON.parse(fs.readFileSync(`${ROOT}/atelier.config.json`, "utf-8")).tokens ?? {};
          } catch { /* guidance via skills layer */ }
          res.end(JSON.stringify({ ok: true, meta: { source: "atelier.config.json" }, groups }));
        }),
        devRoute("/__atelier/state-snapshot", async (req, res) => {
          res.end(JSON.stringify(latestBridgeState ?? { ok: false, note: "no browser has reported yet — open the app once in dev preview" }));
        }),
        devRoute("/__atelier/audit", async (req, res, rawUrl) => {
          const lines = Math.max(1, Math.min(500, Number(new URL(rawUrl, "http://x").searchParams.get("lines") ?? 50)));
          let rows = [];
          try {
            rows = fs.readFileSync(AUDIT_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(-lines);
          } catch { /* empty */ }
          res.end(JSON.stringify({ ok: true, rows }));
        }),
        devRoute("/__atelier/docs", async (req, res) => {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(fs.readFileSync(`${ROOT}/src/llms.txt`, "utf-8"));
        }),
        devRoute("/__atelier/screenshot", async (req, res, rawUrl) => {
          // snapshot=1 → 页面进入确定性渲染（动画冻结、流式文本一次性落定），见 index.html
          // compare=1 → P1-8 像素级对比：与 .atr/snapshots/baseline.png 同实例 canvas evaluate
          const wantsCompare = rawUrl.includes("compare=1");
          const wantsFull = rawUrl.includes("full=1"); // m11 批 C：全页捕获变体（快照门首屏盲区销账）
          const appUrl = `http://127.0.0.1:${actualPort}/?snapshot=1`;
          // P1-12：无头实例与真人浏览器同权——经 token 一次性通道换得 cookie 后再捕获（页面已不再
          // 内嵌 token）；navUrl 只用于导航，token 不进响应/审计（capturedFrom 仍报清洗后的 appUrl）
          const navUrl = `http://127.0.0.1:${actualPort}/?token=${TOKEN}&snapshot=1`;
          try {
            let compareBase64 = null;
            let threshold = 0.12;
            if (wantsCompare) {
              try {
                // compare 基线平台感知（m11 批 C 顺路修复 m10 遗留不一致：此前写死平铺
                // baseline.png——per-platform 布局武装后像素档对新基线悄悄失明）。
                // full 变体无 legacy 回退（baseline-full.png 是新变体，不存在即纯捕获）。
                const platform = process.platform;
                const baselineCandidates = wantsFull
                  ? [path.join(ROOT, ".atr", "snapshots", platform, "baseline-full.png")]
                  : [
                      path.join(ROOT, ".atr", "snapshots", platform, "baseline.png"),
                      path.join(ROOT, ".atr", "snapshots", "baseline.png"), // 旧布局只读回退（绝不自动迁移）
                    ];
                const basePath = baselineCandidates.find((p) => fs.existsSync(p));
                if (basePath) {
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
                screenshotInflight ??= capturePage({ url: navUrl, compareBase64, threshold, fullPage: wantsFull }).finally(() => { screenshotInflight = null; });
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
        }),

        /* ---------- P2-2③ a11y 快照（无障碍树文本化；agent 检视语义优先于像素）---------- */
        devRoute("/__atelier/a11y", async (req, res) => {
          const appUrl = `http://127.0.0.1:${actualPort}/`;
          const navUrl = `http://127.0.0.1:${actualPort}/?token=${TOKEN}`; // P1-12：先换 cookie 再捕获
          try {
            a11yInflight ??= captureA11yPersistent({ url: navUrl }).finally(() => { a11yInflight = null; });
            const r = await a11yInflight;
            audit("a11y", { nodes: r.nodeCount });
            res.end(JSON.stringify({ ok: true, a11y: r.a11y, nodeCount: r.nodeCount, capturedFrom: appUrl, at: Date.now() }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        }),

        /* ---------- review UI（P2-5 spec L5 最小版）---------- */
        devRoute("/__atelier/feedback", async (req, res) => {
          // 与 MCP feedback.read 同一约定：specs/feedback.jsonl 每行 {at,verdict,target,note}
          if (!rejectNonJson(req, res)) return;
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
        }),
        devRoute("/__atelier/snapshot-image", async (req, res, rawUrl) => {
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
        }),
        devRoute("/__atelier/review", async (req, res) => {
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
const $ = (id) => document.getElementById(id);
function esc(s){const d=document.createElement("div");d.textContent=String(s??"");return d.innerHTML;}
async function loadState(){
  try{ const j = await (await fetch("/__atelier/state-snapshot")).json();
    const tl = Array.isArray(j.timeline) ? j.timeline : [];
    $("timeline").innerHTML = tl.length ? tl.map(c=>'<li><code>'+esc(c.id)+'</code> '+esc(c.name)+' <span class="muted">'+esc(new Date(c.at).toLocaleString())+'</span></li>').join("") : "<li>(empty — store.commit 会出现在这里)</li>";
    $("meta").textContent = "signals="+(j.signalCount??0)+" · checkpoints="+(j.checkpointCount??0)+" · "+(j.href??"");
  }catch(e){ $("timeline").innerHTML = "<li>state-snapshot 不可达（页面未打开过？）</li>"; }
}
function bust(){ return "?t="+Date.now(); }
function loadImages(){ $("baseline").src = "/__atelier/snapshot-image?name=baseline"+bust(); $("current").src = "/__atelier/snapshot-image?name=current"+bust(); }
async function loadHistory(){
  try{ const j = await (await fetch("/__atelier/feedback-history")).json();
    $("history").innerHTML = (j.rows??[]).length ? j.rows.map(r=>'<li>'+esc(r.at)+' <b class="'+(r.verdict==="approve"?"ok":"bad")+'">'+esc(r.verdict)+'</b> '+esc(r.target)+(r.note?' — '+esc(r.note):'')+'</li>').join("") : "<li>(none)</li>";
  }catch(e){ $("history").innerHTML = "<li>(unreadable)</li>"; }
}
async function send(verdict){
  $("msg").textContent = "…writing";
  const r = await fetch("/__atelier/feedback",{method:"POST",headers:{"content-type":"application/json"},
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
  try{ const j = await (await fetch("/__atelier/screenshot")).json();
    if(j.ok){ $("current").src = "data:image/png;base64,"+j.imageBase64; $("msg").textContent = "fresh capture ok（落盘请用 snapshot.diff / atelier snapshot）"; }
    else $("msg").textContent = j.error ?? "capture failed";
  }catch(e){ $("msg").textContent = String(e); }
};
loadState(); loadImages(); loadHistory();
</script>
<script src="/__atelier/review-ext.js"></script>
</body></html>`);
        }),
        devRoute("/__atelier/feedback-history", async (req, res) => {
          let rows = [];
          try {
            rows = fs.readFileSync(path.join(ROOT, "specs", "feedback.jsonl"), "utf-8")
              .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
          } catch { /* none yet */ }
          res.end(JSON.stringify({ ok: true, rows }));
        }),

        /* ---------- bridge: up-push / downlink ---------- */
        devRoute("/__atelier/bridge/state", async (req, res) => {
          if (!rejectNonJson(req, res)) return;
          const body = await readBody(req);
          try {
            latestBridgeState = JSON.parse(body);
          } catch {
            latestBridgeState = { ok: false, parseError: true };
          }
          res.end(JSON.stringify({ ok: true }));
        }),
        devRoute("/__atelier/bridge/commands", async (req, res) => {
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
        }),
        devRoute("/__atelier/bridge/enqueue", async (req, res) => {
          if (!rejectNonJson(req, res)) return;
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
        }),
        devRoute("/__atelier/bridge/ack", async (req, res) => {
          if (!rejectNonJson(req, res)) return;
          const body = await readBody(req);
          try {
            const j = JSON.parse(body);
            resolved.set(j.id, { status: "done", ok: !!j.ok, result: j.result, error: j.error, at: new Date().toISOString() });
            pruneResolved(resolved); // §4.6：有界修剪（FIFO 逐出，上限 MAX_RESOLVED）——长跑不无界增长
            if (!j.ok && j.error) agentLedger.lastError = String(j.error).slice(0, 300); // P2-4
            audit("command.ack", { id: j.id, ok: j.ok });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "invalid ack" }));
          }
        }),
        devRoute("/__atelier/bridge/cmd-status", async (req, res, rawUrl) => {
          const id = new URL(rawUrl, "http://x").searchParams.get("id") ?? "";
          const st = resolved.get(id);
          res.end(JSON.stringify(st ? { ...st, status: "done" } : { status: "pending" }));
        }),
      ];
      // 直测面（P1-14 教训：mount 前缀边界 bug 活到今天正因匹配逻辑无法单测）；运行时零消费
      api.__atelierRouteTable = ROUTES;

      server.middlewares.use((req, res, next) =>
        atelierFace(req, res, next).catch((e) => {
          try {
            if (res.headersSent) {
              res.destroy?.();
              return;
            }
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                ok: false,
                error: `ATR-500: dev face route error: ${e?.message ?? e}`,
                fix: "多为应用模板件缺失/损坏（src/manifest.json、src/llms.txt、atelier.config.json）——补齐文件或 node <repo>/atelier/cli.mjs sync --target <appDir> 拉齐 vendor；error 字段含原始原因",
              }),
            );
          } catch { /* 响应已终结——如实放弃，绝不二次抛出击穿 dev server */ }
        }));
    },
    closeBundle() {
      // 收尾兜底：httpServer close 之外的路径（如 --force 关停）；stop 幂等，双调用安全
      serverSupervisor?.stop();
      serverSupervisor = null;
    },
  };
  return api;
}
