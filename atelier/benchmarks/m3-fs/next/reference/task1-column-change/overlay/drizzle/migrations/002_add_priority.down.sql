-- 002 down：移除 priority 列（SQLite 3.35+ 支持 DROP COLUMN；better-sqlite3 内置版本满足）
ALTER TABLE notes DROP COLUMN priority;
