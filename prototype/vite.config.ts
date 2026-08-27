import { defineConfig, type Plugin } from "vite";
import { createRequire } from "node:module";
import tailwindcss from "@tailwindcss/vite";
import { capturePage } from "./scripts/dev-screenshot.mjs";
import { generateThemeFile } from "./scripts/gen-tailwind-theme.mjs";

// 决策 16：token 单源 → @theme 派生（dev/build 前重生成，src/atelier-theme.css 为产物）
generateThemeFile();

/**
 * Atelier prototype dev 插件（v0.2）：决策 7「内建代理面」+ 决策 9/12 安全与审计基线。
 *
 * 查询（GET，需 token）
 *  - /__atelier/registry · tokens · docs · state-snapshot
 *  - /__atelier/screenshot                 瞬态无头实例截图（视觉真相）
 *  - /__atelier/audit?lines=N              审计日志尾读
 *  - /__atelier/bridge/commands?token=     SSE 命令下行流（页面 EventSource 订阅）
 * 桥接
 *  - POST /__atelier/bridge/state          页面状态推送（缓存给 state.snapshot）
 *  - POST /__atelier/bridge/enqueue        MCP/CLI 下发命令 {op,args} → SSE 广播
 *  - POST /__atelier/bridge/ack            页面执行结果回执
 *  - GET  /__atelier/bridge/cmd-status     命令执行状态轮询（done/pending）
 * 安全：/__atelier/* 一律校验 token（页面经 transformIndexHtml 注入；工具从 .atelier/dev-token 读取）。
 * 审计：非 GET 的 /__atelier/* 与命令回执均追加 .atelier/audit.jsonl。
 */
function atelierDevPlugin(): Plugin {
  const require = createRequire(import.meta.url);
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const ROOT = process.cwd();

  const TOKEN = crypto.randomUUID();
  fs.mkdirSync(path.join(ROOT, ".atelier"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, ".atelier", "dev-token"), TOKEN, "utf8");
  const AUDIT_FILE = path.join(ROOT, ".atelier", "audit.jsonl");
  const audit = (kind: string, detail: unknown) => {
    try {
      fs.appendFileSync(AUDIT_FILE, JSON.stringify({ kind, detail, at: new Date().toISOString() }) + "\n");
    } catch { /* audit must never break the app */ }
  };

  let latestBridgeState: unknown;
  let screenshotInflight: Promise<string> | null = null;

  /* ---- downlink (P0-1): queue → SSE broadcast → ack → status poll ---- */
  const sseClients = new Set<any>();
  const resolved = new Map<string, { status: "done"; ok: boolean; result?: unknown; error?: string; at: string }>();
  let cmdSeq = 0;
  function readBody(req: any): Promise<string> {
    return new Promise((resolve) => {
      let b = "";
      req.on("data", (c: Buffer) => (b += c.toString("utf-8")));
      req.on("end", () => resolve(b));
    });
  }

  return {
    name: "atelier-dev-plugin",
    transformIndexHtml(html) {
      // 页面注入一次性 dev token（EventSource 无法带自定义 header，走 query）
      return html.replace(/<head[^>]*>/i, (m) => `${m}\n<script>window.__ATELIER_TOKEN__=${JSON.stringify(TOKEN)};</script>`);
    },
    configureServer(server) {
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
        if (req.method !== "GET") audit("access", { method: req.method, url: rawUrl.split("?")[0] });

        const url = rawUrl.split("?")[0];
        res.setHeader("Content-Type", "application/json; charset=utf-8");

        /* ---------- query face ---------- */
        if (url === "/__atelier/registry") {
          const manifest = JSON.parse(fs.readFileSync(`${ROOT}/src/manifest.json`, "utf-8"));
          res.end(JSON.stringify({ ok: true, meta: { atelier: "v0.2-prototype", server: "dev" }, ...manifest }));
          return;
        }
        if (url === "/__atelier/tokens") {
          let groups: unknown = {};
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
          let rows: unknown[] = [];
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
          const appUrl = `http://127.0.0.1:${server.config.server.port ?? 5173}/?snapshot=1`;
          try {
            // 有界重试 ×2：无头捕获偶发瞬态失败（GPU 进程/冷启动），快速失败后重试即可吸收
            let imageBase64 = "";
            let lastErr: unknown = null;
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                screenshotInflight ??= capturePage({ url: appUrl }).finally(() => { screenshotInflight = null; });
                imageBase64 = await screenshotInflight;
                lastErr = null;
                break;
              } catch (e) {
                lastErr = e;
                await new Promise((r) => setTimeout(r, 800));
              }
            }
            if (lastErr) throw lastErr;
            audit("screenshot", { bytes: imageBase64.length });
            res.end(JSON.stringify({ ok: true, format: "png", imageBase64, capturedFrom: appUrl, at: Date.now() }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
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
          let op = "", args: unknown;
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
  };
}

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/.debug*", "**/*.tmpdir", "**/*.tmp", "**/.edge-debug"],
    },
  },
  resolve: {
    extensions: [".atr.ts", ".ts", ".mts", ".js", ".mjs", ".json"],
  },
  plugins: [atelierDevPlugin(), tailwindcss()],
});
