/**
 * atelier-dev-plugin.mjs — Atelier dev 面（决策 7「内建代理面」+ 决策 9/12 安全与审计基线）。
 *
 * 框架自有模块（framework-owned）；`atelier init` 会把它连同 dev-screenshot/gen-tailwind-theme
 * 一起 vendor 进应用 scripts/（应用自包含，vite.config 从 ./scripts/ 引入）。
 *
 * 查询（GET，需 token）
 *  - /__atelier/registry · tokens · docs · state-snapshot
 *  - /__atelier/screenshot                 常驻无头实例截图（P0-6：同 tab 复用，崩溃自愈；视觉真相）
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
import { createRequire } from "node:module";
import { capturePagePersistent as capturePage, captureA11yPersistent } from "./dev-screenshot.mjs";

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
</script></body></html>`);
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
