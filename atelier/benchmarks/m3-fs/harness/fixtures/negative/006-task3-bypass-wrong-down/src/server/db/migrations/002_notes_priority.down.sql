-- 002_notes_priority.down.sql —（负控变异：绕过式修复——合法 SQL 但不撤销 up 的 schema 变更）
DELETE FROM notes;
