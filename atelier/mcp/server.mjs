#!/usr/bin/env node
/**
 * server.mjs — Atelier built-in MCP Server (stdio transport, zero-dependency)
 *
 * Decision 7: "framework-embedded agent layer". This server exposes the
 * Atelier tool surface (query / operation / audit faces) to any MCP-capable
 * coding agent (Claude Code, Cursor, Codex, VS Code Copilot).
 *
 * Protocol: newline-delimited JSON-RPC 2.0 over stdio (MCP spec).
 *   handled: initialize · notifications/initialized · ping · tools/list · tools/call
 *            (+ empty prompts/resources lists so hosts probe cleanly)
 *
 * Single-source discipline (scripts/check-skills.mjs enforced):
 *   tools/list is GENERATED from ../mcp/mcp-definitions.json — flat schema
 *   (reqProps/optProps) is translated to standard JSON Schema here.
 *
 * Tool execution: forwarded to the running dev surface (default
 * http://127.0.0.1:5173, override with ATELIER_DEV_URL) via ENDPOINT_MAP.
 * Tools with status != "implemented" answer with a structured, actionable
 * error (ATR style) instead of being hidden — agents see the full design.
 *
 * Security baseline (ARCHITECTURE §9): localhost only, no exec of raw model
 * strings; every mutation goes through the dev surface confirm tiers later.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import readline from "node:readline";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DEFS = JSON.parse(fs.readFileSync(path.join(HERE, "mcp-definitions.json"), "utf8"));
const SERVER_INFO = { name: "atelier", version: DEFS.$meta?.version ?? "0.1.0" };
const PROTOCOL_LATEST = "2025-06-18";
const BASE = (process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");

/** dev-surface routes used by implemented tools (extend as endpoints land) */
const ENDPOINT_MAP = {
  "registry.list_components": "/__atelier/registry",
  "registry.get_component": "/__atelier/registry", // list; filtered by args.name below
  "tokens.list": "/__atelier/tokens",
};

/* ---------- schema translation: flat (decision 6) → standard JSON Schema ---------- */
function flatToJsonSchema(params) {
  if (!params || params.type !== "object") return { type: "object", properties: {}, required: [] };
  const req = params.reqProps ?? {};
  const opt = params.optProps ?? {};
  return {
    type: "object",
    properties: { ...structuredClone(req), ...structuredClone(opt) },
    required: Object.keys(req),
    additionalProperties: false,
  };
}

const TOOLS = DEFS.tools.map((t) => ({
  name: t.name,
  description: `[${t.face}]${t.status === "pending" ? " (specified, wiring pending)" : ""} ${t.summary}`,
  inputSchema: flatToJsonSchema(t.params),
}));

/* ---------- tool error helper: every failure is actionable (SPEC §3) ---------- */
function toolError(codeText, fixText) {
  return new Error(`${codeText}\nfix: ${fixText}`);
}

async function callTool(name, args) {
  const def = DEFS.tools.find((t) => t.name === name);
  if (!def) {
    throw toolError(`ATR-404: unknown tool "${name}"`, "pick a tool from tools/list output");
  }
  if (def.status !== "implemented") {
    throw toolError(
      `ATR-4xx-dev: "${name}" is specified but not wired yet (status=pending)`,
      `implement its route in the dev plugin (see mcp-definitions.json summary), then run 'atelier dev'; usage guidance: skill "atelier-mcp-tools"`
    );
  }
  let route = ENDPOINT_MAP[name];
  if (!route) {
    throw toolError(
      `ATR-4xx-dev: no route mapped for "${name}"`,
      "add it to ENDPOINT_MAP in mcp/server.mjs once the dev endpoint exists"
    );
  }
  // fetch the route; never interpolate raw values into paths except whitelisted query params below
  const res = await fetch(BASE + route, { signal: AbortSignal.timeout(4000) }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: dev surface unreachable at ${BASE} (${e.cause?.code ?? e.name})`,
      "start the dev server ('pnpm dev' inside prototype/) or set ATELIER_DEV_URL"
    );
  });
  if (!res.ok) {
    throw toolError(`ATR-4xx-dev: dev surface returned HTTP ${res.status} for ${route}`, "check dev server logs");
  }
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch { data = body; }

  if (name === "registry.get_component") {
    const wanted = args?.name;
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.components)
        ? data.components
        : [];
    const hit = list.find((c) => c?.name === wanted || c?.id === wanted);
    if (!hit) {
      throw toolError(
        `ATR-401: component "${wanted ?? "(none)"}" not registered`,
        `registered names: ${list.map((c) => c?.name ?? c?.id).join(", ") || "(empty)"} — import the component file and pass opts.name explicitly`
      );
    }
    return hit;
  }
  return data;
}

/* ---------- stdio JSON-RPC plumbing ---------- */
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
      return;
    case "notifications/initialized":
    case "$/cancelRequest":
      return; // notifications: no reply
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      return;
    case "prompts/list":
      reply(id, { prompts: [] });
      return;
    case "resources/list":
      reply(id, { resources: [] });
      return;
    case "tools/call": {
      const name = params?.name;
      try {
        const out = await callTool(name, params?.arguments);
        reply(id, {
          content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }],
          isError: false,
        });
      } catch (e) {
        reply(id, {
          content: [{ type: "text", text: e?.message ?? String(e) }],
          isError: true,
        });
      }
      return;
    }
    default:
      if (id !== undefined) replyError(id, -32601, `method not supported: ${method}`);
  }
}

/* ---------- lifecycle ---------- */
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  Promise.resolve(handle(msg)).catch((e) => {
    // last-resort containment: an unexpected crash must not kill the session
    if (msg?.id !== undefined && msg?.id !== null) {
      replyError(msg.id, -32603, `internal error: ${e?.message ?? String(e)}`);
    }
  });
});
rl.on("close", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.on("SIGHUP", () => process.exit(0));

process.stderr.write(`[atelier-mcp] ${SERVER_INFO.name}@${SERVER_INFO.version}: ${TOOLS.length} tools, dev=${BASE}\n`);
