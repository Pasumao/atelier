import { defineConfig, type Plugin } from "vite";
import { createRequire } from "node:module";
import { capturePage } from "./scripts/dev-screenshot.mjs";

/**
 * Atelier prototype dev 插件（v0.1 最小版）：
 * 模拟决策 7「内建 MCP Server 查询面」的 HTTP 面（完整 MCP 协议接入为下一步）：
 *  - GET /__atelier/registry   → 组件注册表（名称/schema/源码路径），供代理自查询
 *  - GET /__atelier/docs       → 框架 API 速查（llms.txt 雏形）
 *  - GET /__atelier/stream-intro → 流式文本模拟（SSE），接 streamValue 原语
 */
function atelierDevPlugin(): Plugin {
  const require = createRequire(import.meta.url);
  const fs = require("node:fs") as typeof import("node:fs");
  const ROOT = process.cwd();
  let latestBridgeState: unknown; // 页面状态桥最近一次上报（决策 7 状态可检视性）
  let screenshotInflight: Promise<string> | null = null; // ui.screenshot 并发互斥

  return {
    name: "atelier-dev-plugin",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (url === "/__atelier/registry") {
          const manifest = JSON.parse(fs.readFileSync(`${ROOT}/src/manifest.json`, "utf-8"));
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: true, meta: { atelier: "v0.1-prototype", server: "dev" }, ...manifest }));
          return;
        }
        if (url === "/__atelier/tokens") {
          // semantic design tokens (atelier.config.json SSOT) — feeds the MCP tool `tokens.list`
          let groups: unknown = {};
          try {
            const cfg = JSON.parse(fs.readFileSync(`${ROOT}/atelier.config.json`, "utf-8"));
            groups = cfg.tokens ?? {};
          } catch {
            // config missing/unreadable → empty surface; guidance comes from the skills layer
          }
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: true, meta: { source: "atelier.config.json" }, groups }));
          return;
        }
        if (url === "/__atelier/bridge/state") {
          // 页面状态桥上报入口：缓存最近快照，供 /__atelier/state-snapshot（MCP state.snapshot）读取
          let body = "";
          req.on("data", (c: Buffer) => (body += c.toString("utf-8")));
          req.on("end", () => {
            try {
              latestBridgeState = JSON.parse(body);
            } catch {
              latestBridgeState = { ok: false, parseError: true };
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }
        if (url === "/__atelier/state-snapshot") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify(
              latestBridgeState ?? { ok: false, note: "no browser has reported yet — open the app once in dev preview" },
            ),
          );
          return;
        }
        if (url === "/__atelier/screenshot") {
          // 决策 12 视觉真相：瞬态无头实例拍当前应用页（bridge 亦随之刷新 → 检视面一致）
          const appUrl = `http://127.0.0.1:${server.config.server.port ?? 5173}/`;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            screenshotInflight ??= capturePage({ url: appUrl }).finally(() => { screenshotInflight = null; });
            const imageBase64 = await screenshotInflight;
            res.end(JSON.stringify({ ok: true, format: "png", imageBase64, capturedFrom: appUrl, at: Date.now() }));
          } catch (e) {
            res.statusCode = 500;
            const msg = e instanceof Error ? e.message : String(e);
            res.end(JSON.stringify({ ok: false, error: msg }));
          }
          return;
        }
        if (url === "/__atelier/docs") {
          const docs = fs.readFileSync(`${ROOT}/src/llms.txt`, "utf-8");
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(docs);
          return;
        }
        if (url === "/__atelier/stream-intro") {
          const intro =
            "DeepSeek 是一家人工智能公司，专注于通用人工智能（AGI）的研究与工程实践。" +
            "其开源大语言模型 DeepSeek-V3 与 DeepSeek-R1 以极低的推理成本对标一线闭源模型，" +
            "并保持 API 与 OpenAI 格式兼容，支持 128K 上下文与原生工具调用。";
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
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
      // 忽略工具链临时文件，避免 Windows 上 EBUSY 崩溃（write 工具的 .tmpdir 机制）
      ignored: ["**/.debug*", "**/*.tmpdir", "**/*.tmp", "**/.edge-debug"],
    },
  },
  resolve: {
    // .atr.ts 为 Atelier 组件扩展名（决策 3：仅组件文件走编译管线）
    extensions: [".atr.ts", ".ts", ".mts", ".js", ".mjs", ".json"],
  },
  plugins: [atelierDevPlugin()],
});
