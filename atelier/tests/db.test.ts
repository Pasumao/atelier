import { describe, it, expect } from "vitest";
import { table, pick, createTableSql, dropTableSql, type TableDef } from "../server/db";
import { validateFlat } from "../runtime/contract";

// §5.1 形态示例（扁平字面量纪律——普通对象字面量，无方法链 DSL）
const messages = table(
  "messages",
  {
    id: { type: "integer", primaryKey: true },
    chatId: { type: "integer", notNull: true, references: "chats.id" },
    role: { type: "text", notNull: true, enum: ["user", "assistant"] },
    content: { type: "text", notNull: true },
    updatedAt: { type: "integer", default: 0 },
    note: { type: "text" },
    payload: { type: "blob" },
  },
  { indexes: [{ name: "idx_messages_chat", columns: ["chatId"] }] }
);

describe("数据契约 table()（FS-DESIGN §5.1，FS-M2(m2b)）", () => {
  it("产物形状：name/columns/primaryKey/indexes/rowSchema 齐备，primaryKey 提取自列定义", () => {
    expect(messages.name).toBe("messages");
    expect(messages.primaryKey).toEqual(["id"]);
    expect(messages.indexes).toEqual([{ name: "idx_messages_chat", columns: ["chatId"] }]);
    expect(Object.keys(messages.columns)).toEqual(["id", "chatId", "role", "content", "updatedAt", "note", "payload"]);
  });

  it("rowSchema 投影：integer/real→number、text/blob→string；notNull/primaryKey→reqProps，否则 optProps", () => {
    expect(messages.rowSchema.reqProps).toEqual({
      id: { type: "number" },
      chatId: { type: "number" },
      role: { type: "string", enum: ["user", "assistant"] },
      content: { type: "string" },
    });
    expect(messages.rowSchema.optProps).toEqual({
      updatedAt: { type: "number" },
      note: { type: "string" },
      payload: { type: "string" }, // 诚实边界：FlatSchema 无二进制域，blob 投影为 string 仅作形状提示
    });
  });

  it("primaryKey 隐含 notNull：列上只写 primaryKey 也归 reqProps", () => {
    const t = table("t", { id: { type: "integer", primaryKey: true } });
    expect(t.rowSchema.reqProps["id"]).toBeDefined();
    expect(t.rowSchema.optProps?.["id"]).toBeUndefined();
  });

  it("rowSchema 与端点契约同规范单源：validateFlat 直接消费（枚举违规 → ATR-201）", () => {
    expect(validateFlat(messages.rowSchema, { id: 1, chatId: 2, role: "user", content: "hi" }).ok).toBe(true);
    const bad = validateFlat(messages.rowSchema, { id: 1, chatId: 2, role: "banana", content: "hi" });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("ATR-201");
    expect(bad.error?.fix).toContain("user");
  });

  it("pick：子投影保持 req/opt 归位，仍可过 validateFlat（端点 output 引用表列子集）", () => {
    const out = pick(messages.rowSchema, ["id", "role", "note"]);
    expect(out.reqProps).toEqual({ id: { type: "number" }, role: { type: "string", enum: ["user", "assistant"] } });
    expect(out.optProps).toEqual({ note: { type: "string" } });
    expect(validateFlat(out, { id: 1, role: "assistant" }).ok).toBe(true);
    expect(validateFlat(out, { role: "user" }).ok).toBe(false); // id 缺失
  });

  it("pick：未知键硬错（拼列名不静默），fix 列出可用键", () => {
    expect(() => pick(messages.rowSchema, ["nope"])).toThrow(/nope/);
  });

  it("createTableSql：§5.1 形态的 DDL 文本（PRIMARY KEY NOT NULL/REFERENCES/索引；标识符白名单免引号）", () => {
    const sql = createTableSql(messages);
    expect(sql).toBe(
      [
        "CREATE TABLE IF NOT EXISTS messages (",
        "  id INTEGER PRIMARY KEY NOT NULL,",
        "  chatId INTEGER NOT NULL REFERENCES chats(id),",
        "  role TEXT NOT NULL,",
        "  content TEXT NOT NULL,",
        "  updatedAt INTEGER DEFAULT 0,",
        "  note TEXT,",
        "  payload BLOB",
        ");",
        "CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chatId);",
      ].join("\n")
    );
  });

  it("createTableSql：复合主键走表级 PRIMARY KEY；UNIQUE 索引；default 字符串转义与 NULL", () => {
    const t = table(
      "members",
      {
        orgId: { type: "integer", primaryKey: true },
        userId: { type: "integer", primaryKey: true },
        email: { type: "text", unique: true, default: "" },
        nick: { type: "text", default: null },
      },
      { indexes: [{ name: "uq_members_org_user", columns: ["orgId", "userId"], unique: true }] }
    );
    const sql = createTableSql(t);
    expect(sql).toContain("  orgId INTEGER NOT NULL,");
    expect(sql).toContain("  userId INTEGER NOT NULL,");
    expect(sql).toContain("  PRIMARY KEY (orgId, userId)");
    expect(sql).toContain("  email TEXT UNIQUE DEFAULT ''");
    expect(sql).toContain("  nick TEXT DEFAULT NULL");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_members_org_user ON members (orgId, userId);");
  });

  it("cascade 不隐式（§5.1）：含 references 的 DDL 绝不出现 ON DELETE CASCADE；drop 为朴素 DROP", () => {
    const sql = createTableSql(messages);
    expect(sql).toContain("REFERENCES chats(id)");
    expect(sql).not.toContain("CASCADE");
    expect(dropTableSql(messages)).toBe("DROP TABLE IF EXISTS messages;");
  });

  it("构造期硬错：非法表名/未知键/enum 混质/references 形状/未知索引列——契约错误炸在定义处", () => {
    expect(() => table("1bad", { id: { type: "integer" } })).toThrow(/表 名非法|表名非法/);
    expect(() => table("t", { id: { type: "integer", notNullable: true } as never })).toThrow(/未知键/);
    expect(() => table("t", { r: { type: "text", enum: ["a", 1] } })).toThrow(/同质/);
    expect(() => table("t", { r: { type: "text", references: "chats" } })).toThrow(/references/);
    expect(() => table("t", { id: { type: "integer" } }, { indexes: [{ name: "ix", columns: ["ghost"] }] })).toThrow(/未知列/);
    expect(() => table("t", { id: { type: "varchar" as never } })).toThrow(/类型非法/);
  });

  it("TableDef 产物可直接供 gen-db/MCP db.schema 消费（形状冻结为普通值对象）", () => {
    const t: TableDef = table("chats", { id: { type: "integer", primaryKey: true }, name: { type: "text", notNull: true } });
    expect(JSON.parse(JSON.stringify(t))).toEqual({
      name: "chats",
      columns: { id: { type: "integer", primaryKey: true }, name: { type: "text", notNull: true } },
      primaryKey: ["id"],
      indexes: [],
      rowSchema: { type: "object", reqProps: { id: { type: "number" }, name: { type: "string" } } },
    });
  });
});
