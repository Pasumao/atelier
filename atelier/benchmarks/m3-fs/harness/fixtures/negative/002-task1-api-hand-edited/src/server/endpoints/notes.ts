/**
 * notes.ts — notes 端点对（task1：priority 全链路贯通）。
 * notes.list：query——全部行按 id 升序，行含 priority（SELECT 显式列出全部列）。
 * notes.create：command——入参 { body, priority? }；priority 契约约束 0-9（越界 → ATR-201）、
 *   可省略按 0、整数性在 handler 归一（Math.trunc）；id 由服务端生成（自增主键）。
 * 端点命名惯例：notes. 点分命名空间；注册去哪？见 ../main-server.ts 装配点。
 */
import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { noteCreateInput, noteListOutput, noteSchema } from "../../contract.ts";

type NoteRow = { id: number; body: string; createdAt: number; priority: number };

/** query：POST <mount>/notes.list——全量列表（含 priority），id 升序 */
export const noteList = defineQuery("notes.list", {
  output: noteListOutput,
  handler: (_input, ctx) => {
    const notes = ctx.db.prepare("SELECT id, body, createdAt, priority FROM notes ORDER BY id ASC").all() as NoteRow[];
    return { notes };
  },
});

/** command：POST <mount>/notes.create——参数化插入（决策 19 红线），服务端生成 id */
export const noteCreate = defineCommand<{ body: string; priority?: number }, NoteRow>("notes.create", {
  contract: noteCreateInput,
  output: noteSchema,
  auth: { type: "none" }, // 显式声明（struct 层 7 消警口径）：基线不设鉴权
  handler: (input, ctx) => {
    const createdAt = Date.now();
    const priority = Math.trunc(input.priority ?? 0);
    const r = ctx.db
      .prepare("INSERT INTO notes (body, createdAt, priority) VALUES (?, ?, ?)")
      .run(input.body, createdAt, priority);
    const row: NoteRow = { id: Number(r.lastInsertRowid), body: input.body, createdAt, priority };
    ctx.audit(`notes.create id=${row.id} priority=${row.priority}（notes 共 ${String(ctx.db.prepare("SELECT COUNT(*) AS n FROM notes").get()?.n ?? "?")} 行）`);
    return row;
  },
});
