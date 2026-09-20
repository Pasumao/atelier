-- 002_notes_priority.up.sql —（负控变异：NOT NULL 无缺省——up 必炸，ATR-334）
ALTER TABLE notes ADD COLUMN priority INTEGER NOT NULL;
