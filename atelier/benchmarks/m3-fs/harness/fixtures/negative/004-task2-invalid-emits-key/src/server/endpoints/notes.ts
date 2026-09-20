/**
 * notes.ts — M3-FS 端点对：notes.list（query）/ notes.create（command）。
 */
import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { noteCreateInput, noteListOutput, noteRowOutput } from "../../contract.ts";

const COLUMNS = "id, body, createdAt";

/** notes.list：live query——显式失效键（§4.1），SSE 订阅 GET /api/notes.list/live（§4.3） */
export const noteList = defineQuery("notes.list", {
  output: noteListOutput,
  live: { invalidate: ["table:notes"] },
  handler: (_input, ctx) => {
    const rows = ctx.db.prepare(`SELECT ${COLUMNS} FROM notes ORDER BY rowid`).all();
    return { notes: rows };
  },
});

/** notes.create：幂等 upsert（客户端 id）；成功载荷 = 存后行 */
export const noteCreate = defineCommand<{ id: string; body: string }, { id: string; body: string; createdAt: number }>("notes.create", {
  contract: noteCreateInput,
  output: noteRowOutput,
  idempotent: true,
  emits: ["notes"],
  handler: (input, ctx) => {
    const priority = undefined;
    ctx.db
      .prepare("INSERT INTO notes (id, body, createdAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body")
      .run(input.id, input.body, Date.now());
    const row = ctx.db.prepare(`SELECT ${COLUMNS} FROM notes WHERE id = ?`).get(input.id);
    ctx.audit(`notes.create id=${input.id}`);
    return row;
  },
});
