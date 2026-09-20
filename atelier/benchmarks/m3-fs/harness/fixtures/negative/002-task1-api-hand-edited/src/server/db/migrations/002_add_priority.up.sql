-- 002_add_priority：notes 增加优先级列（改列迁移 = 手写并过 migrate verify，§5.4 边界：
-- gen db 只为新表生成骨架）。NOT NULL 必须带 DEFAULT——对已有数据的表加 NOT NULL 列
-- 不带缺省值 = up 失败事务回滚（ATR-334 面）。
ALTER TABLE notes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
