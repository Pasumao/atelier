// @atelier-generated (gen db) — 表元数据与行类型。改 src/server/db/schema.ts 后 regen（迁移为追加式，永不重写）。
// 显式 import 闭合（决策 23）：元数据单源在 schema.ts 的 table() 定义，此处仅按 TableDef 收口类型并规范命名。
import { notes } from "../../server/db/schema.ts";
import type { TableDef } from "../../vendor/atelier/server/db.ts";

export const notesTable: TableDef = notes;
export type NotesRow = {
  id: number;
  body: string;
  createdAt: number;
  priority: number;
};
export type NotesInsert = {
  id?: number;
  body: string;
  createdAt: number;
  priority: number;
};
