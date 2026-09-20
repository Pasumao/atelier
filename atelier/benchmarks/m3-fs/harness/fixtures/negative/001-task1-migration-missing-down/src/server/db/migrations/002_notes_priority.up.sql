-- 002_notes_priority.up.sql — notes 增加优先级列（整数、非空；既有行缺省 0——
-- 对已有数据的表加 NOT NULL 列必须带 DEFAULT，否则 up 失败回滚，ATR-334）
ALTER TABLE notes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
