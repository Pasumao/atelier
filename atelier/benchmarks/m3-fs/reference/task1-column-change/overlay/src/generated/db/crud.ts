// @atelier-generated (gen db) — 极薄参数化 CRUD（§5.2：四原语量级，SQL 字面量内联可读）。
// 红线（决策 19）：全参数化、零值拼接——值一律 ? 绑定；UPDATE 的 SET 列名来自下方生成时允许清单
// （contract 定义，非运行时输入）。手写 SQL（join/聚合）一等公民：ctx.db.prepare 直用（§5.3）。
import type { SqliteDb, SqliteRunResult } from "../../vendor/atelier/server/sqlite.ts";
import type { NotesInsert, NotesRow } from "./tables.ts";

// —— notes ——

export function notesGetByPk(db: Pick<SqliteDb, "prepare">, pk: { id: number }): NotesRow | undefined {
  return db.prepare("SELECT id, body, createdAt, priority FROM notes WHERE id = ?").get(pk.id) as NotesRow | undefined;
}

export function notesInsert(db: Pick<SqliteDb, "prepare">, values: NotesInsert): SqliteRunResult {
  return db.prepare("INSERT INTO notes (id, body, createdAt, priority) VALUES (?, ?, ?, ?)").run(values.id ?? null, values.body, values.createdAt, values.priority);
}

const notesUpdateColumns: Record<string, true> = { body: true, createdAt: true, priority: true };

/**
 * 更新按主键 + 显式列集（partial 输入）：SET 列名过滤自 notesUpdateColumns 允许清单——
 * 拼进 SQL 的只是 contract 定义的列名（非运行时输入），值全参数化，零值拼接（决策 19 红线）。
 * 空补丁 = no-op（不生成裸 UPDATE）。
 */
export function notesUpdate(db: Pick<SqliteDb, "prepare">, pk: { id: number }, patch: Partial<Omit<NotesInsert, "id">>): SqliteRunResult {
  const keys = Object.keys(patch).filter((k) => notesUpdateColumns[k]);
  if (keys.length === 0) return { changes: 0, lastInsertRowid: 0 };
  return db.prepare(`UPDATE notes SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
    ...keys.map((k) => (patch as Record<string, unknown>)[k]), pk.id,
  );
}

export function notesDelete(db: Pick<SqliteDb, "prepare">, pk: { id: number }): SqliteRunResult {
  return db.prepare("DELETE FROM notes WHERE id = ?").run(pk.id);
}
