// @atelier-generated（gen endpoint）—— regen 全量重写，手改会被覆盖（FS-DESIGN §7.2 产物纪律）
// 类型全部投影自契约单源（FlatOf）+ 端点注册表元数据；本文件零手写业务类型（双源 = ERROR）。
// 诚实边界：call 只做传输与错误透传（非 2xx 直接抛响应体 = ATR 四段式，fix 可执行）；
// live 失效-重算-推送的服务端引擎归 FS-7——本客户端按 §4.3 SSE 线协议消费。

import { echoInput, echoOutput, noteCreateInput, noteListOutput, noteSchema } from "../contract.ts";
import type { FlatOf } from "../vendor/atelier/server/index.ts";
import { streamValue } from "../vendor/atelier/runtime/index.ts";

type AppEchoInput = FlatOf<typeof echoInput>;
type AppEchoOutput = FlatOf<typeof echoOutput>;
type NotesCreateInput = FlatOf<typeof noteCreateInput>;
type NotesCreateOutput = FlatOf<typeof noteSchema>;
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

/** notes.list（query·live）—— POST /api/notes.list；live SSE GET /api/notes.list/live（§4.3） */
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
  /** live 订阅：SSE data → streamValue 三态原语直通；error 事件 = ATR-321（订阅保持，不断流） */
  live(input: Record<string, unknown>) {
    const sv = streamValue<NotesListOutput>();
    const es = new EventSource("/api/notes.list/live?input=" + encodeURIComponent(JSON.stringify(input)));
    es.addEventListener("data", (e) => {
      sv.push(JSON.parse((e as MessageEvent).data) as NotesListOutput);
    });
    es.addEventListener("error", (e) => {
      // ATR-321 四段式随 error 事件下行；streamValue v1 无 error 位（§8.3 议），先 console 呈现；
      // 订阅保持——下轮写后重算继续推 data。无 data 的 error = 连接级中断，EventSource 自动重连。
      const d = (e as MessageEvent).data;
      if (typeof d === "string" && d.length > 0) {
        try {
          const atr = JSON.parse(d) as { code?: string; message?: string; fix?: string };
          console.error("[atelier] " + (atr.code ?? "ATR-321") + ": " + (atr.message ?? "") + "\nfix: " + (atr.fix ?? ""));
        } catch {
          // 非 JSON error 帧——忽略（连接级错误的自动重连由 EventSource 承担）
        }
      }
    });
    return Object.freeze({
      get values() {
        return sv.values;
      },
      get value() {
        return sv.value;
      },
      get done() {
        return sv.done;
      },
      push: (v: NotesListOutput) => sv.push(v),
      finish: () => sv.finish(),
      dispose: () => es.close(),
    });
  },
});
