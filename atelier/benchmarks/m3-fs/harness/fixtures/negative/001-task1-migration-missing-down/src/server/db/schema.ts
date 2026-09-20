/**
 * schema.ts — 数据契约单源（FS-DESIGN §5.1）：notes 表。
 * id 由客户端生成正整数随请求上行（§4.5 乐观对账「同 id 幂等合并」的前提；
 * brief v2：JSON number，如 Date.now()）→ integer 主键；
 * body 非空；createdAt = integer epoch ms。
 */
import { table } from "../../vendor/atelier/server/index.ts";

export const notesTable = table("notes", {
  id: { type: "integer", primaryKey: true },
  body: { type: "text", notNull: true },
  createdAt: { type: "integer", notNull: true },
  priority: { type: "integer", notNull: true, default: 0 },
});
