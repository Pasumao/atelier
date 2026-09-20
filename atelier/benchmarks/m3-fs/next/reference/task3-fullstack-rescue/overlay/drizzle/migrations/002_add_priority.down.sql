-- 002 down：移除 priority 列（SQLite 3.35+ 支持 DROP COLUMN；better-sqlite3 内置版本满足）
-- 种子缺陷最小修复：up 侧已应用且逐字节不动（checksum 口径），缺什么补什么。
ALTER TABLE notes DROP COLUMN priority;
