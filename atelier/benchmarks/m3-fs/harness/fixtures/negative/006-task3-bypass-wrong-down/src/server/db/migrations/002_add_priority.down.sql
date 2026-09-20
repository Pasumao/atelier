-- （负控变异：绕过式修复——合法 SQL 但不撤销 up 的 schema 变更；对照正解 = ALTER TABLE notes DROP COLUMN priority）
DELETE FROM notes;
