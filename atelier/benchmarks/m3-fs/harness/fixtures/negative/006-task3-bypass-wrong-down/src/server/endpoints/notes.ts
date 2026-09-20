/**
 * notes.ts — notes 端点对（task3：priority 全线贯通 + live 对账，= task1+task2 合成态）。
 * notes.list：live query——显式失效键 table:notes，行含 priority；SSE 订阅
 *   GET <mount>/notes.list/live（首连全量 + 失效重算后推送）。
 * notes.create：command——id 客户端生成（正整数，幂等 upsert），priority 契约 0-9 可省略按 0；
 *   显式 emits: ["table:notes"]；idempotent: true。
 */
import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { noteCreateInput, noteListOutput, noteSchema } from "../../contract.ts";

type NoteRow = { id: number; body: string; createdAt: number; priority: number };

/** live query：GET <mount>/notes.list/live 订阅；POST <mount>/notes.list 直调同型可用 */
export const noteList = defineQuery("notes.list", {
  output: noteListOutput,
  live: { invalidate: ["table:notes"] },
  handler: (_input, ctx) => {
    const notes = ctx.db.prepare("SELECT id, body, createdAt, priority FROM notes ORDER BY id ASC").all() as NoteRow[];
    return { notes };
  },
});

/** command：POST <mount>/notes.create——客户端 id 幂等 upsert + priority 落库 + emits 失效广播 */
export const noteCreate = defineCommand<{ id: number; body: string; priority?: number }, NoteRow>("notes.create", {
  contract: noteCreateInput,
  output: noteSchema,
  auth: { type: "none" }, // 显式声明（struct 层 7 消警口径）：基线不设鉴权
  idempotent: true, // 同 id 重放 = 更新而非重复插入（客户端重试安全）
  emits: ["table:notes"], // 显式写侧失效键（§4.1：显式声明优先于自动表名启发式）
  handler: (input, ctx) => {
    const createdAt = Date.now();
    const priority = Math.trunc(input.priority ?? 0);
    ctx.db
      .prepare(
        "INSERT INTO notes (id, body, createdAt, priority) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET body = excluded.body, createdAt = excluded.createdAt, priority = excluded.priority",
      )
      .run(input.id, input.body, createdAt, priority);
    const row: NoteRow = { id: input.id, body: input.body, createdAt, priority };
    ctx.audit(`notes.create id=${row.id} priority=${row.priority}（幂等 upsert，notes 共 ${String(ctx.db.prepare("SELECT COUNT(*) AS n FROM notes").get()?.n ?? "?")} 行）`);
    return row;
  },
});
