-- 002_add_priority down：补齐缺失的 down 侧（命名对齐既有 up 侧 stem）。
-- D1 口径：up 侧文件字节与其在 atelier_migrations 的 checksum **逐字节不动**——
-- down 侧不在 checksum 口径内，缺什么补什么；verify 在影子库以 force 回放 down（无真实数据可丢）。
ALTER TABLE notes DROP COLUMN priority;
