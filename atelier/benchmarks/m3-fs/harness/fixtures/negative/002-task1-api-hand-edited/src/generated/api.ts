// @atelier-generated（gen endpoint）—— regen 全量重写，手改会被覆盖（FS-DESIGN §7.2 产物纪律）
// 类型全部投影自契约单源（FlatOf）+ 端点注册表元数据；本文件零手写业务类型（双源 = ERROR）。
// 诚实边界：call 只做传输与错误透传（非 2xx 直接抛响应体 = ATR 四段式，fix 可执行）；
// live 失效-重算-推送的服务端引擎归 FS-7——本客户端按 §4.3 SSE 线协议消费。

import { echoInput, echoOutput, noteCreateInput, noteListOutput, noteRowOutput } from "../contract.ts";
import type { FlatOf } from "../vendor/atelier/server/index.ts";

type AppEchoInput = FlatOf<typeof echoInput>;
type AppEchoOutput = FlatOf<typeof echoOutput>;
type NotesCreateInput = FlatOf<typeof noteCreateInput>;
type NotesCreateOutput = FlatOf<typeof noteRowOutput>;
type NotesListOutput = FlatOf<typeof noteListOutput>;

/** app.echo（command）—— POST /api/app.echo */
export const appEcho = Object.freeze({
  name: "app.echo" as const,
  async call(input: AppEchoInput): Promise<AppEchoOutput> {
    const res = await fetch("/api/app.echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await res.json(); // 非 2xx = ATR 四段式 { code, message, context, fix }
    return (await res.json()) as AppEchoOutput;
  },
});

/** app.ping（query）—— POST /api/app.ping */
export const appPing = Object.freeze({
  name: "app.ping" as const,
  async call(input: Record<string, unknown>): Promise<unknown> {
    const res = await fetch("/api/app.ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await res.json(); // 非 2xx = ATR 四段式 { code, message, context, fix }
    return (await res.json()) as unknown;
  },
});

/** notes.create（command）—— POST /api/notes.create */
export const notesCreate = Object.freeze({
  name: "notes.create" as const,
  async call(input: NotesCreateInput): Promise<NotesCreateOutput> {
    const res = await fetch("/api/notes.create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await res.json(); // 非 2xx = ATR 四段式 { code, message, context, fix }
    return (await res.json()) as NotesCreateOutput;
  },
});

/** notes.list（query）—— POST /api/notes.list */
export const notesList = Object.freeze({
  name: "notes.list" as const,
  async call(input: Record<string, unknown>): Promise<NotesListOutput> {
    const res = await fetch("/api/notes.list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await res.json(); // 非 2xx = ATR 四段式 { code, message, context, fix }
    return (await res.json()) as NotesListOutput;
  },
});

// （手改补丁——负控变异：生成物零手改纪律被破坏）
export const notesCreateUrl = "/api/notes.create";
