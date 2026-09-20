/**
 * schema.ts — 数据契约单源（FS-DESIGN §5.1）：table() 扁平字面量定义，
 * gen db 扫描本文件产出 tables/crud/迁移骨架；行形状经 rowSchema 与端点契约同规范。
 * 注记：gen-db 扫描器对字面量内部的尾注注释不识别（纯文本扫描边界）——注记写在字面量外。
 * id = INTEGER PK（rowid 别名，自增语义）；createdAt = epoch ms（§5.1：时间 = integer ms）；
 * priority = 002_add_priority 迁移新增列（NOT NULL DEFAULT 0，既有行回填 0）。
 */
import { table } from "../../vendor/atelier/server/db.ts";

export const notes = table("notes", {
  id: { type: "integer", primaryKey: true },
  body: { type: "text", notNull: true },
  createdAt: { type: "integer", notNull: true },
  priority: { type: "integer", notNull: true, default: 0 }
});
