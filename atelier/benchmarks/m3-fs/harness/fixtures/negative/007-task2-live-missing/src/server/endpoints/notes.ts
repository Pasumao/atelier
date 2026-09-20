/**
 * notes.ts — notes 端点对（task2：live 对账考点，表结构零改动）。
 * notes.list：live query——显式失效键 table:notes（§4.1 键语法；读写两侧都可查），
 *   SSE 订阅 GET <mount>/notes.list/live（§4.3：首连全量 + 每次失效重算后推 data 帧）。
 * notes.create：command——id 由客户端生成随请求上行（§4.5 对账前提），服务端按 id
 *   幂等 upsert（同 id 重放 = 更新）；显式 emits: ["table:notes"]（显式声明优先于写捕获
 *   自动表名启发式）；idempotent: true 元数据与 upsert 行为一致。
 * 失效-重算-推送：提交成功（journal 入账）→ emits × live.invalidate 求交命中 →
 *   coalesce 合并窗口重算 → 全体订阅者收到含新行的全量 data 帧（≤1s 内，§4.2）。
 */
import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { noteCreateInput, noteListOutput, noteSchema } from "../../contract.ts";

type NoteRow = { id: number; body: string; createdAt: number };

/** live query：GET <mount>/notes.list/live 订阅；POST <mount>/notes.list 直调同型可用 */
export const noteList = defineQuery("notes.list", {
  output: noteListOutput,
  handler: (_input, ctx) => {
    const notes = ctx.db.prepare("SELECT id, body, createdAt FROM notes ORDER BY id ASC").all() as NoteRow[];
    return { notes };
  },
});

/** command：POST <mount>/notes.create——客户端 id 幂等 upsert + 审计入账 + emits 失效广播 */
export const noteCreate = defineCommand<{ id: number; body: string }, NoteRow>("notes.create", {
  contract: noteCreateInput,
  output: noteSchema,
  auth: { type: "none" }, // 显式声明（struct 层 7 消警口径）：基线不设鉴权
  idempotent: true, // 同 id 重放 = 更新而非重复插入（客户端重试安全）
  handler: (input, ctx) => {
    const createdAt = Date.now();
    ctx.db
      .prepare(
        "INSERT INTO notes (id, body, createdAt) VALUES (?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET body = excluded.body, createdAt = excluded.createdAt",
      )
      .run(input.id, input.body, createdAt);
    const row: NoteRow = { id: input.id, body: input.body, createdAt };
    ctx.audit(`notes.create id=${row.id}（客户端 id 幂等 upsert，notes 共 ${String(ctx.db.prepare("SELECT COUNT(*) AS n FROM notes").get()?.n ?? "?")} 行）`);
    return row;
  },
});
