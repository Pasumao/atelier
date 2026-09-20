import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// notes 表：与 atelier 臂基线同构列（id 自增主键 / body 非空 / createdAt epoch ms）
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  // task1 新增列：integer 非空、既有行缺省 0（002 迁移成对补列）
  priority: integer("priority").notNull().default(0),
});
