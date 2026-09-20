-- 002_add_priority：既有行缺省 0（对已有数据的表加 NOT NULL 列必须带 DEFAULT）
ALTER TABLE notes ADD priority INTEGER NOT NULL DEFAULT 0;
