-- 002_notes_priority.down.sql — 精确撤销 002 up（可逆性硬门槛，§5.4）
ALTER TABLE notes DROP COLUMN priority;
