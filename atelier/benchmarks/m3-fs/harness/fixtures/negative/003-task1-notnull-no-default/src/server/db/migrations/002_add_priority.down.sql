-- 002_add_priority down：删除 priority 列（SQLite ≥3.35 支持 ALTER TABLE DROP COLUMN）。
-- 可逆性是硬门槛（ATR-331/333）：migrate verify 在影子库以 force 回放 down（无真实数据可丢）。
ALTER TABLE notes DROP COLUMN priority;
