/**
 * openapi.test.ts — FS-9 OpenAPI 导出 + §2.4 扁平投影器验收。
 *   · 投影器：FlatSchema → JSON Schema（draft-2020-12 / openapi-3.0 两 target，golden 快照）
 *   · ATR-107 红检：超出扁平语义的结构（$ref/oneOf/allOf/未知键/嵌套数组…）显式 throw，绝不静默降级
 *   · 与 validateFlat 同源一致性：投影结果 round-trip（合法/非法数据两侧判定一致）
 *   · export openapi 端到端：paths/method/required/x-atelier 扩展/restful GET 映射/无 output 注记/
 *     契约引用缺失显式报错/securitySchemes/范围克制/regen 字节幂等/CLI
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectJsonSchema, projectFlatField, PROJECT_TARGETS } from "../compiler/project-json.mjs";
import { buildOpenApi, writeOpenApi, scanOpenApiEndpoints, scanContractSchemas, parseFlatSchemaLiteral } from "../gen/export-openapi.mjs";
import { validateFlat, type FlatSchema } from "../runtime/contract.ts";

const EXPORT_SCRIPT = fileURLToPath(new URL("../gen/export-openapi.mjs", import.meta.url));

function atrOf(fn: () => unknown): { code: string; message: string; context: Record<string, unknown>; fix: string } {
  try {
    fn();
  } catch (e) {
    return e as never;
  }
  throw new Error("期望投影器 throw，实际未抛");
}

/* ---------- golden fixtures（固定契约 → 两 target 快照，内联 golden） ---------- */

const GOLDEN_SCHEMA: FlatSchema = {
  type: "object",
  reqProps: {
    id: { type: "number" },
    role: { type: "string", enum: ["user", "assistant"] },
    content: { type: "string", min: 1, max: 140, pattern: "^[a-z]" },
  },
  optProps: {
    tags: { type: "array", items: { type: "string" }, min: 2, max: 10 },
    score: { type: "number", min: 0, max: 1 },
    pinned: { type: "boolean" },
  },
};

const GOLDEN_RICH = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    id: { type: "number" },
    role: { type: "string", enum: ["user", "assistant"] },
    content: { type: "string", minLength: 1, maxLength: 140, pattern: "^[a-z]" },
    tags: { type: "array", minItems: 2, maxItems: 10, items: { type: "string" } },
    score: { type: "number", minimum: 0, maximum: 1 },
    pinned: { type: "boolean" },
  },
  required: ["id", "role", "content"],
};

describe("投影器（§2.4）：两 target golden 快照 + target 校验", () => {
  it("golden：富契约 → draft-2020-12 快照（$schema + 扁平关键字定序输出）", () => {
    expect(projectJsonSchema(GOLDEN_SCHEMA, "draft-2020-12")).toEqual(GOLDEN_RICH);
  });

  it("golden：同一契约 → openapi-3.0 快照（OAS Schema Object，无 $schema）", () => {
    const { $schema: _omit, ...rest } = GOLDEN_RICH;
    expect(projectJsonSchema(GOLDEN_SCHEMA, "openapi-3.0")).toEqual(rest);
  });

  it("golden：空契约 → { type: \"object\" }（与 validateFlat 恒通过语义一致）；minItems/maxItems 为 array 项数界投影", () => {
    expect(projectJsonSchema({ type: "object" }, "draft-2020-12")).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    });
    expect(
      projectJsonSchema({ type: "object", reqProps: { a: { type: "array", items: { type: "number" }, min: 1, max: 3 } } }, "openapi-3.0").properties.a
    ).toEqual({ type: "array", minItems: 1, maxItems: 3, items: { type: "number" } });
  });

  it("未知 target / 非法输入显式报错；PROJECT_TARGETS 两官方 target", () => {
    expect(PROJECT_TARGETS).toEqual(["draft-2020-12", "openapi-3.0"]);
    expect(() => projectJsonSchema({ type: "object" }, "draft-07" as never)).toThrow(/未知投影 target/);
    expect(() => projectJsonSchema(null as never, "draft-2020-12")).toThrow(/ATR-107/);
    expect(() => projectJsonSchema({ type: "string" } as never, "draft-2020-12")).toThrow(/ATR-107/);
    expect(() => projectJsonSchema({ type: "object", reqProps: { a: { type: "string" } }, optProps: { a: { type: "string" } } } as never, "openapi-3.0")).toThrow(/同时出现/);
  });

  it("projectFlatField 叶子投影（restful GET parameters 与根 schema 同管线）+ label 进 ATR-107 context", () => {
    expect(projectFlatField({ type: "number", min: 1 }, "openapi-3.0")).toEqual({ type: "number", minimum: 1 });
    const err = atrOf(() => projectFlatField({ type: "object" } as never, "openapi-3.0", { label: "mySchema.reqProps.x" }));
    expect(err.code).toBe("ATR-107");
    expect(err.context.at).toBe("mySchema.reqProps.x");
  });
});

describe("投影器 ATR-107 红检（§2.4：超出扁平语义显式 throw，先红后绿）", () => {
  it("$ref / oneOf / allOf / not → ATR-107 四段式，fix 指路扁平形态", () => {
    for (const key of ["$ref", "oneOf", "allOf", "not"]) {
      const err = atrOf(() => projectJsonSchema({ type: "object", reqProps: { a: { type: "string" } }, [key]: {} } as never, "draft-2020-12"));
      expect(err.code, key).toBe("ATR-107");
      expect(err.fix, key).toContain("扁平");
    }
  });

  it("叶子上的 $ref/oneOf、未知键 → ATR-107；对象叶子 type → ATR-107", () => {
    const leafCases: Array<Record<string, unknown>> = [
      { type: "string", $ref: "#/x" },
      { type: "string", oneOf: [{ type: "string" }] },
      { type: "string", unknownKey: 1 },
      { type: "object" },
      { type: "integer" },
    ];
    for (const leaf of leafCases) {
      const err = atrOf(() => projectJsonSchema({ type: "object", reqProps: { a: leaf } } as never, "draft-2020-12"));
      expect(err.code, JSON.stringify(leaf)).toBe("ATR-107");
    }
  });

  it("嵌套数组（items 为 array）与 items 携带约束 → ATR-107（validateFlat 只对元素做类型检查）", () => {
    const nested = atrOf(() =>
      projectJsonSchema({ type: "object", reqProps: { a: { type: "array", items: { type: "array" } } } } as never, "draft-2020-12")
    );
    expect(nested.code).toBe("ATR-107");
    const constrained = atrOf(() =>
      projectJsonSchema({ type: "object", reqProps: { a: { type: "array", items: { type: "string", min: 1 } } } } as never, "draft-2020-12")
    );
    expect(constrained.code).toBe("ATR-107");
  });

  it("boolean 挂 min/max、非 string 挂 pattern、空 enum、非法正则 → ATR-107", () => {
    const cases: Array<{ type: "object"; reqProps: Record<string, unknown> }> = [
      { type: "object", reqProps: { a: { type: "boolean", min: 1 } } },
      { type: "object", reqProps: { a: { type: "number", pattern: "^x" } } },
      { type: "object", reqProps: { a: { type: "string", enum: [] } } },
      { type: "object", reqProps: { a: { type: "string", pattern: "[" } } },
    ];
    for (const flat of cases) {
      const err = atrOf(() => projectJsonSchema(flat as never, "draft-2020-12"));
      expect(err.code, JSON.stringify(flat)).toBe("ATR-107");
    }
  });
});

/* ---------- round-trip sanity：投影结果能被自家消费（与 validateFlat 同源一致性） ---------- */

/** 迷你 JSON Schema 校验器（只支持本投影器输出的关键字集——消费端最小实现） */
function jsValidate(s: ReturnType<typeof projectJsonSchema>, v: unknown): boolean {
  const t = s.type;
  if (t === "object") {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const obj = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in obj)) return false;
    for (const [k, sub] of Object.entries(s.properties ?? {})) {
      if (k in obj && !jsValidate(sub as never, obj[k])) return false;
    }
    return true;
  }
  if (t === "array") {
    if (!Array.isArray(v)) return false;
    if (s.minItems != null && v.length < s.minItems) return false;
    if (s.maxItems != null && v.length > s.maxItems) return false;
    if (s.items && !v.every((x) => jsValidate(s.items as never, x))) return false;
    return true;
  }
  if (t === "string") {
    if (typeof v !== "string") return false;
    if (s.minLength != null && v.length < s.minLength) return false;
    if (s.maxLength != null && v.length > s.maxLength) return false;
    if (s.pattern != null && !new RegExp(s.pattern).test(v)) return false;
  } else if (t === "number") {
    if (typeof v !== "number" || Number.isNaN(v)) return false;
    if (s.minimum != null && v < s.minimum) return false;
    if (s.maximum != null && v > s.maximum) return false;
  } else if (t === "boolean") {
    if (typeof v !== "boolean") return false;
  }
  if (s.enum && !s.enum.includes(v as never)) return false;
  return true;
}

describe("投影器与 validateFlat 同源一致性（round-trip sanity，§2.4 golden 判据）", () => {
  const schemas: FlatSchema[] = [
    GOLDEN_SCHEMA,
    { type: "object" },
    { type: "object", reqProps: { n: { type: "number", min: -2.5, max: 2.5 } }, optProps: { s: { type: "string", pattern: "^b" } } },
    { type: "object", reqProps: { rows: { type: "array", items: { type: "boolean" }, min: 0, max: 2 } } },
  ];
  const payloads: Array<Record<string, unknown>> = [
    {},
    { id: 1, role: "user", content: "hi" },
    { id: 1, role: "user", content: "hi", tags: ["a", "b"], score: 0.5, pinned: true },
    { id: 1, role: "mod", content: "hi" }, // enum 违约
    { id: 1, role: "user", content: "" }, // minLength 违约
    { id: 1, role: "user", content: "hi", tags: ["a"] }, // minItems 违约
    { id: 1, role: "user", content: "hi", score: 3 }, // maximum 违约
    { id: "1", role: "user", content: "hi" }, // 类型违约
    { n: 3 },
    { n: -3 },
    { n: 0, s: "bad" }, // pattern 违约
    { rows: [true, false, true] }, // maxItems 违约
    { rows: [] },
    { extra: 1 }, // 未知键：validateFlat 与 JSON Schema 同为宽松
  ];

  it("逐 schema × 逐 payload：validateFlat(ok) === 投影 JSON Schema(valid)（两 target 同判）", () => {
    for (const schema of schemas) {
      for (const target of PROJECT_TARGETS) {
        const projected = projectJsonSchema(schema, target);
        for (const p of payloads) {
          const flatOk = validateFlat(schema, p).ok;
          const jsOk = jsValidate(projected, p);
          expect(jsOk, `${target} ${JSON.stringify(schema)} × ${JSON.stringify(p)}`).toBe(flatOk);
        }
      }
    }
  });

  it("顶层非对象：JSON Schema type:object 拒绝（validateFlat 由 ~standard 包装拦截，同口径）", () => {
    expect(jsValidate(projectJsonSchema(GOLDEN_SCHEMA, "draft-2020-12"), "str")).toBe(false);
    expect(jsValidate(projectJsonSchema(GOLDEN_SCHEMA, "draft-2020-12"), [1, 2])).toBe(false);
    expect(jsValidate(projectJsonSchema(GOLDEN_SCHEMA, "draft-2020-12"), null)).toBe(false);
  });
});

/* ---------- export openapi 端到端（临时目录应用 fixture） ---------- */

const tmpRoots: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-openapi-"));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

function w(root: string, rel: string, text: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text, "utf8");
}

function makeApp(): string {
  const root = makeRoot();
  w(
    root,
    "src/contract.ts",
    `// 契约单源（fixture）：扁平 schema 常量
export const chatInputSchema = {
  type: "object",
  reqProps: { content: { type: "string", min: 1, max: 140 } },
};
export const chatMessageSchema: FlatSchema = {
  type: "object",
  reqProps: { id: { type: "number" }, role: { type: "string", enum: ["user", "assistant"] } },
  optProps: { tags: { type: "array", items: { type: "string" }, max: 10 } },
};
export const listInputSchema = {
  type: "object",
  reqProps: { chatId: { type: "number", min: 1 } },
  optProps: { limit: { type: "number", max: 100 } },
} satisfies FlatSchema;
export const unusedSchema = { type: "object", reqProps: { x: { type: "string" } } };
`
  );
  w(
    root,
    "src/server/endpoints/chat.ts",
    `export const chatAsk = defineCommand("chat.ask", {
  contract: chatInputSchema,
  output: chatMessageSchema,
  auth: { type: "session" },
  idempotent: true,
  timeoutMs: 10_000,
  handler: async () => ({}),
});

export const chatList = defineQuery("chat.list", {
  contract: listInputSchema,
  output: chatMessageSchema,
  live: { invalidate: ["table:messages"] },
  handler: () => ({}),
});

export const chatRemove = defineCommand("chat.remove", {
  contract: chatInputSchema,
  handler: async () => ({}),
});

export const chatPing = defineQuery("chat.ping", {
  handler: () => ({}),
});
`
  );
  w(
    root,
    "src/server/endpoints/browse.ts",
    `export const browseList = defineQuery("browse.list", {
  contract: listInputSchema,
  restful: true,
  handler: () => ({}),
});
`
  );
  return root;
}

/* ---------- R1-C（扫描器掩码单一真相 / 数值枚举投影 / 重名 die / 名字闸） ---------- */

describe("R1-C P1-4：export-openapi 扫描面注释/字符串掩码（复用 gen-endpoint findEndpointCalls 单一真相）", () => {
  const MASKED_SRC = `// export const gone = defineQuery("ghost.y", { handler: () => 1 });
const hint = "defineQuery('ghost.z', { handler: () => 1 })";
export function legacy() {
  /*
  defineQuery("ghost.y", {
  */
  return defineQuery("real.x", { handler: () => 2 });
}
`;
  it("①② 注释掉的/字符串里的 defineQuery 不进导出面；③ 注释区间内的真实端点必须进（吞端点负例）", () => {
    expect(scanOpenApiEndpoints(MASKED_SRC).map((e) => e.name)).toEqual(["real.x"]);
  });

  it("掩码修复后导出面元数据照常提取（真实端点的 auth/timeoutMs/live 不受掩码影响）", () => {
    const src = `export const a = defineQuery("x.y", {
  live: { invalidate: ["table:m"] },
  timeoutMs: 10_000,
  auth: { type: "session" },
  handler: () => ({}),
});
`;
    const eps = scanOpenApiEndpoints(src);
    expect(eps[0]).toMatchObject({ name: "x.y", live: true, invalidate: ["table:m"], timeoutMs: 10000, auth: { type: "session" } });
  });
});

describe("R1-C：数值枚举投影（§2.4 放行 (string|number)[]——validateFlat includes 同源，消除跨消费面分叉）", () => {
  it("number 叶子数值枚举：enum 原样投影（修复前 ATR-107「enum 取值必须是字符串」——db.ts rowSchema 数值枚举消费链直接失败）", () => {
    expect(projectFlatField({ type: "number", enum: [1, 2, 3] }, "openapi-3.0")).toEqual({ type: "number", enum: [1, 2, 3] });
    expect(projectJsonSchema({ type: "object", reqProps: { level: { type: "number", enum: [1, 2, 3] } } }, "draft-2020-12").properties?.level).toEqual({
      type: "number",
      enum: [1, 2, 3],
    });
  });

  it("投影与 validateFlat 同判：数值枚举合法值过投影校验、非法值两侧同拒（round-trip）", () => {
    const flat = { type: "object", reqProps: { level: { type: "number", enum: [1, 2, 3] } } } as never;
    const projected = projectJsonSchema(flat, "openapi-3.0");
    expect(validateFlat(flat, { level: 2 }, "t").ok).toBe(true);
    expect(jsValidate(projected, { level: 2 })).toBe(true);
    expect(validateFlat(flat, { level: 9 }, "t").ok).toBe(false);
    expect(jsValidate(projected, { level: 9 })).toBe(false);
    expect(validateFlat(flat, { level: "2" }, "t").ok).toBe(false);
    expect(jsValidate(projected, { level: "2" })).toBe(false);
  });

  it("同质闸回归（对齐 db.ts table() 口径）：混质/布尔成员 → ATR-107 绝不静默", () => {
    for (const leaf of [{ type: "number", enum: [1, "a"] }, { type: "string", enum: ["a", 1] }, { type: "boolean", enum: [true] }]) {
      const err = atrOf(() => projectFlatField(leaf as never, "openapi-3.0"));
      expect(err.code, JSON.stringify(leaf)).toBe("ATR-107");
      expect(err.fix, JSON.stringify(leaf)).toBeTruthy();
    }
  });

  it("端到端：数值枚举契约（db.ts rowSchema pick 投影形态）的 openapi 导出不再失败、enum 原样进文档", () => {
    const root = makeRoot();
    w(
      root,
      "src/contract.ts",
      `export const chatLevelInput = {
  type: "object",
  reqProps: { level: { type: "number", enum: [1, 2, 3] } },
};
`
    );
    w(
      root,
      "src/server/endpoints/level.ts",
      `export const levelGet = defineQuery("level.get", {
  contract: chatLevelInput,
  output: chatLevelInput,
  handler: () => ({ level: 1 }),
});
`
    );
    const { doc } = buildOpenApi(root);
    expect(doc.components.schemas.chatLevelInput.properties.level).toEqual({ type: "number", enum: [1, 2, 3] });
  });
});

describe("R1-C：端点重名 die（ATR-313 镜像——paths[pathKey] 静默后者覆盖已废除）", () => {
  it("重名端点 → 聚合报错含 ATR-313 与端点名，绝不静默覆盖", () => {
    const root = makeApp();
    w(root, "src/server/endpoints/dupe.ts", `export const dupeCall = defineQuery("chat.ask", { handler: () => ({}) });\n`);
    let msg = "";
    let fix = "";
    try {
      buildOpenApi(root);
    } catch (e) {
      msg = (e as Error).message;
      fix = String((e as { fix?: string }).fix ?? "");
    }
    expect(msg).toContain("ATR-313");
    expect(msg).toContain("chat.ask");
    expect(fix).toBeTruthy();
  });
});

describe("R1-C：端点名字符集闸（ATR-342 同集——坏名字 die 而非静默导出坏路径）", () => {
  it("端点名含双引号 → ATR-342 die（修复前：paths 键静默携带坏字符导出）", () => {
    const root = makeApp();
    w(root, "src/server/endpoints/bad.ts", `export const badCall = defineQuery("we\\"ird", { handler: () => ({}) });\n`);
    let err: (Error & { code?: string; fix?: string }) | null = null;
    try {
      buildOpenApi(root);
    } catch (e) {
      err = e as Error & { code?: string; fix?: string };
    }
    expect(err, "坏名字必须在导出侧 die").toBeTruthy();
    expect(err!.code ?? err!.message).toContain("ATR-342");
    expect(err!.fix).toBeTruthy();
  });
});

describe("export openapi 端到端（§13：paths / x-atelier / restful / 注记 / 报错）", () => {
  it("文档结构：5 端点 5 paths / 默认 POST / operationId+tags / requestBody required 由 reqProps 推导", () => {
    const { doc } = buildOpenApi(makeApp());
    expect(doc.openapi).toBe("3.0.3");
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/api/browse.list",
      "/api/chat.ask",
      "/api/chat.list",
      "/api/chat.ping",
      "/api/chat.remove",
    ]);
    const ask = doc.paths["/api/chat.ask"].post;
    expect(ask.operationId).toBe("chat.ask");
    expect(ask.tags).toEqual(["chat"]);
    expect(ask.requestBody.required).toBe(true);
    expect(ask.requestBody.content["application/json"].schema).toEqual({ $ref: "#/components/schemas/chatInputSchema" });
    // 输出契约 → 200 响应投影（$ref 指向契约单源常量名）
    expect(ask.responses["200"].content["application/json"].schema).toEqual({ $ref: "#/components/schemas/chatMessageSchema" });
    // optProps-only 契约的 requestBody required:false（fixture 无此端点——用组件 schema required 断言替代）
    expect(doc.components.schemas.chatMessageSchema.required).toEqual(["id", "role"]);
    expect(doc.components.schemas.chatMessageSchema.optProps).toBeUndefined();
  });

  it("x-atelier-* 扩展：kind/idempotent/timeoutMs/live；live 端点 SSE 通道注记、/live 不进 paths", () => {
    const { doc } = buildOpenApi(makeApp());
    const ask = doc.paths["/api/chat.ask"].post;
    expect(ask["x-atelier-kind"]).toBe("command");
    expect(ask["x-atelier-idempotent"]).toBe(true);
    expect(ask["x-atelier-timeout-ms"]).toBe(10000);
    expect(ask["x-atelier-live"]).toBeUndefined();
    const list = doc.paths["/api/chat.list"].post;
    expect(list["x-atelier-kind"]).toBe("query");
    expect(list["x-atelier-live"]).toBe(true);
    expect(list.description).toContain("live SSE");
    expect(list.description).toContain("/api/chat.list/live");
    expect(Object.keys(doc.paths).some((p) => p.endsWith("/live"))).toBe(false); // SSE 引擎归 FS-7——不导出未实现传输
  });

  it("restful GET 映射（§3.4 互操作位）：reqProps→required 参数、optProps→可选参数、无 requestBody、注记运行时 GET 分发已启用（决策 34）", () => {
    const { doc } = buildOpenApi(makeApp());
    const item = doc.paths["/api/browse.list"];
    expect(item.get).toBeDefined();
    expect(item.post).toBeUndefined();
    expect(item.get["x-atelier-restful"]).toBe(true);
    expect(item.get.description).toContain("运行时 GET 分发已启用（决策 34）"); // A7 连带：旧注记「运行时传输仍为 POST」已随运行时 GET 分发落地改写
    expect(item.get.description).toContain("POST 通道保留");
    const params = item.get.parameters;
    expect(params).toEqual([
      { name: "chatId", in: "query", required: true, schema: { type: "number", minimum: 1 } },
      { name: "limit", in: "query", required: false, schema: { type: "number", maximum: 100 } },
    ]);
    // 契约未声明 output → 响应 schema 省略 + 注记
    expect(item.get.responses["200"].content).toBeUndefined();
    expect(item.get.responses["200"].description).toContain("未声明 output 契约");
    expect(item.get.responses["200"]["x-atelier-output-contract"]).toBe(false);
  });

  it("无 output 契约端点：响应 schema 省略 + description 注记 + x-atelier-output-contract:false（requestBody 仍在）", () => {
    const { doc } = buildOpenApi(makeApp());
    const remove = doc.paths["/api/chat.remove"].post;
    expect(remove.requestBody.required).toBe(true);
    expect(remove.responses["200"].content).toBeUndefined();
    expect(remove.responses["200"].description).toContain("响应 schema 省略");
    expect(remove.responses["200"]["x-atelier-output-contract"]).toBe(false);
    const ping = doc.paths["/api/chat.ping"].post;
    expect(ping.requestBody).toBeUndefined(); // 无输入契约 → 无 requestBody
  });

  it("securitySchemes：session → cookie apiKey 位 + security 引用；oauth 预留占位（x-atelier-reserved）不实现", () => {
    const root = makeApp();
    w(
      root,
      "src/server/endpoints/browse.ts",
      `export const browseList = defineQuery("browse.list", {
  contract: listInputSchema,
  restful: true,
  auth: { type: "oauth" },
  handler: () => ({}),
});
`
    );
    const { doc } = buildOpenApi(root);
    expect(doc.components.securitySchemes.session).toMatchObject({ type: "apiKey", in: "cookie", name: "session" });
    expect(doc.paths["/api/chat.ask"].post.security).toEqual([{ session: [] }]);
    expect(doc.components.securitySchemes.oauth).toMatchObject({ type: "apiKey", in: "header", "x-atelier-reserved": true });
    expect(doc.paths["/api/browse.list"].get.security).toEqual([{ oauth: [] }]);
  });

  it("securitySchemes：apikey → apiKeyAuth header 位（name = 端点 auth 声明 header ?? 缺省 x-api-key）+ security 引用；session/oauth 投影零变化（A6 决策 30）", () => {
    const root = makeApp();
    w(
      root,
      "src/server/endpoints/robot.ts",
      `export const robotPull = defineQuery("robot.pull", {
  auth: { type: "apikey" },
  handler: () => ({}),
});
export const robotPush = defineCommand("robot.push", {
  auth: { type: "apikey", header: "x-robot-key" },
  handler: () => ({}),
});
`
    );
    const { doc } = buildOpenApi(root);
    // apiKeyAuth 位：首声明定名（robot.pull 无 header 字段 → 缺省 x-api-key）；description 明示装配点为实际头名权威
    expect(doc.components.securitySchemes.apiKeyAuth).toMatchObject({ type: "apiKey", in: "header", name: "x-api-key" });
    expect(doc.components.securitySchemes.apiKeyAuth.description).toContain("createHandler({ apiKeys: { header } })");
    expect(doc.paths["/api/robot.pull"].post.security).toEqual([{ apiKeyAuth: [] }]);
    expect(doc.paths["/api/robot.push"].post.security).toEqual([{ apiKeyAuth: [] }]);
    // session/oauth 投影现状零变化（golden 对照）
    expect(doc.components.securitySchemes.session).toMatchObject({ type: "apiKey", in: "cookie", name: "session" });
    expect(doc.components.securitySchemes.oauth).toBeUndefined();
  });

  it("范围克制（§13）：components.schemas 只含端点引用的契约常量（unusedSchema 不进）；未声明契约端点无 requestBody", () => {
    const { doc, schemaIdents } = buildOpenApi(makeApp());
    expect(schemaIdents).toEqual(["chatInputSchema", "chatMessageSchema", "listInputSchema"]);
    expect(Object.keys(doc.components.schemas)).toEqual(["chatInputSchema", "chatMessageSchema", "listInputSchema"]);
    expect(JSON.stringify(doc)).not.toContain("unusedSchema");
  });

  it("契约引用不存在 → 聚合显式报错不静默（message 含常量名与 fix）；行内契约字面量 → 显式报错指路契约单源", () => {
    const root = makeApp();
    w(root, "src/server/endpoints/ghost.ts", `export const ghostCall = defineCommand("ghost.call", { contract: ghostSchema, handler: async () => ({}) });\n`);
    let msg = "";
    try {
      buildOpenApi(root);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("ghostSchema");
    expect(msg).toContain("src/contract.ts");

    const root2 = makeApp();
    w(
      root2,
      "src/server/endpoints/inline.ts",
      `export const inlineCall = defineCommand("inline.call", { contract: { type: "object", reqProps: { a: { type: "string" } } }, handler: async () => ({}) });\n`
    );
    expect(() => buildOpenApi(root2)).toThrow(/行内契约对象字面量/);
  });

  it("auth 非法类型 / command 声明 restful / 非法 timeoutMs → 显式报错", () => {
    const mk = (kind: "Command" | "Query", def: string): string => {
      const root = makeApp();
      w(root, "src/server/endpoints/extra.ts", `export const extraCall = define${kind}("extra.call", ${def});\n`);
      return root;
    };
    expect(() => buildOpenApi(mk("Query", `{ auth: { type: "mtls" }, handler: async () => ({}) }`))).toThrow(/不支持的 auth 类型/);
    expect(() => buildOpenApi(mk("Command", `{ contract: chatInputSchema, restful: true, handler: async () => ({}) }`))).toThrow(/restful/);
    expect(() => buildOpenApi(mk("Query", `{ timeoutMs: "soon", handler: async () => ({}) }`))).toThrow(/数字字面量/);
  });

  it("info.title 取 --name > package.json name > 目录名；--mount 前缀进路径；--out 子目录落盘", () => {
    const root = makeApp();
    const r = writeOpenApi(root, { name: "ChatApp", mount: "/rpc/v1", out: "doc/openapi.json" });
    expect(r.doc.info.title).toBe("ChatApp");
    expect(Object.keys(r.doc.paths)).toEqual(["/rpc/v1/browse.list", "/rpc/v1/chat.ask", "/rpc/v1/chat.list", "/rpc/v1/chat.ping", "/rpc/v1/chat.remove"]);
    expect(r.file).toBe("doc/openapi.json");
    expect(fs.existsSync(path.join(root, "doc", "openapi.json"))).toBe(true);
  });

  it("regen 字节幂等（§7.3 门禁 2 同款）：连续两次写盘第二次 changed=false、内容逐字节一致", () => {
    const root = makeApp();
    const a = writeOpenApi(root);
    const b = writeOpenApi(root);
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
    expect(a.content).toBe(b.content);
    expect(fs.readFileSync(path.join(root, "openapi.json"), "utf8")).toBe(a.content);
  });

  it("CLI 直跑：stdout 诚实清单 + openapi.json 落盘；坏契约 → exit 1 + error/fix 两行", () => {
    const root = makeApp();
    const out = execFileSync(process.execPath, [EXPORT_SCRIPT, "--root", root, "--name", "CliApp"], { encoding: "utf8" });
    expect(out).toContain("export openapi");
    expect(out).toContain("paths 5");
    expect(out).toContain("只导出端点面");
    expect(fs.existsSync(path.join(root, "openapi.json"))).toBe(true);

    const bad = makeApp();
    w(bad, "src/server/endpoints/ghost.ts", `export const ghostCall = defineCommand("ghost.call", { contract: ghostSchema, handler: async () => ({}) });\n`);
    let stderr = "";
    let status = 0;
    try {
      execFileSync(process.execPath, [EXPORT_SCRIPT, "--root", bad], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      stderr = (e as { stderr?: string }).stderr ?? "";
      status = (e as { status?: number }).status ?? 1;
    }
    expect(status).toBe(1);
    expect(stderr).toContain("error:");
    expect(stderr).toContain("ghostSchema");
    expect(stderr).toContain("fix:");
  });
});

describe("export-openapi 扫描器（复用 gen-endpoint 原语：超集元数据 / 契约字面量纪律）", () => {
  it("泛型标注形态 defineCommand<Input, Output>(…)（模板 example.ts 规范形态）整提取——golden 先红后绿钉住", () => {
    const src = `export const echo = defineCommand<{ message: string }, { echoed: string; time: string }>("app.echo", {
  contract: s1,
  output: s2,
  live: { invalidate: ["table:messages"] },
  timeoutMs: 10_000,
  auth: { type: "session" },
  handler: () => ({}),
});
export const call = defineCommand("app.call", { handler: () => ({}) });
`;
    const eps = scanOpenApiEndpoints(src);
    expect(eps.map((e) => e.name)).toEqual(["app.echo", "app.call"]);
    expect(eps[0]).toMatchObject({ kind: "command", contract: "s1", output: "s2", live: true, invalidate: ["table:messages"], timeoutMs: 10000, auth: { type: "session" } });
    // 泛型段内的引号/箭头类型不干扰扫描（字符串字面量联合、箭头类型不当 <…> 闭合）
    const tricky = `export const t = defineQuery<Input = { kind: "a" | "b" }, Fn = (x: string) => Promise<number>>("app.tricky", { handler: () => ({}) });`;
    expect(scanOpenApiEndpoints(tricky).map((e) => e.name)).toEqual(["app.tricky"]);
  });

  it("scanOpenApiEndpoints：name/kind/contract/output/live/invalidate/emits/idempotent/timeoutMs(10_000)/auth/restful 全提取", () => {
    const src = `export const a = defineQuery("x.y", {
  contract: s1,
  output: s2,
  live: { invalidate: ["table:messages", "key:chat:1"] },
  emits: ["table:messages"],
  idempotent: true,
  timeoutMs: 10_000,
  auth: { type: "session", role: "admin" },
  restful: true,
  handler: () => ({}),
});
export const b = defineCommand("x.z", { handler: () => ({}) });
`;
    const eps = scanOpenApiEndpoints(src);
    expect(eps).toHaveLength(2);
    expect(eps[0]).toMatchObject({
      name: "x.y",
      kind: "query",
      contract: "s1",
      output: "s2",
      live: true,
      invalidate: ["table:messages", "key:chat:1"],
      emits: ["table:messages"],
      idempotent: true,
      timeoutMs: 10000,
      restful: true,
    });
    expect(eps[0].auth).toEqual({ type: "session", role: "admin" });
    expect(eps[1]).toMatchObject({ name: "x.z", kind: "command", contract: null, output: null, live: false, restful: false, timeoutMs: null, auth: null });
  });

  it("scanContractSchemas：export const 三形态（裸字面量 / : FlatSchema 注解 / satisfies 后缀）；坏常量惰性留存", () => {
    const root = makeRoot();
    w(
      root,
      "src/contract.ts",
      `export const a = { type: "object", reqProps: { x: { type: "string" } } };
export const b: FlatSchema = { type: "object", reqProps: { y: { type: "number" } } };
export const c = { type: "object", reqProps: { z: { type: "boolean" } } } satisfies FlatSchema;
export const broken = { type: "object", reqProps: { w: badIdent } };
export const notSchema = "just a string";
`
    );
    const sc = scanContractSchemas(root);
    expect(sc.idents).toEqual(["a", "b", "c", "broken"]);
    expect(sc.byIdent.a.value).toEqual({ type: "object", reqProps: { x: { type: "string" } } });
    expect(sc.byIdent.b.value.reqProps.y).toEqual({ type: "number" });
    expect(sc.byIdent.c.value.reqProps.z).toEqual({ type: "boolean" });
    expect(sc.byIdent.broken.error).toBeDefined(); // 惰性——只有被端点引用才报错
    expect(sc.idents.includes("notSchema")).toBe(false); // 非对象字面量不收（scanContracts 同口径）
  });

  it("parseFlatSchemaLiteral：嵌套对象/数组/enum/数字分隔符/布尔/null；标识符引用与插值 → 显式错（§2.1 纪律）", () => {
    expect(
      parseFlatSchemaLiteral(`{ type: "object", reqProps: { a: { type: "array", items: { type: "string" }, min: 1 } }, optProps: { n: { type: "number" } } }`, "t")
    ).toEqual({ type: "object", reqProps: { a: { type: "array", items: { type: "string" }, min: 1 } }, optProps: { n: { type: "number" } } });
    expect(parseFlatSchemaLiteral(`{ type: "object", reqProps: { big: { type: "number", max: 10_000 } } }`, "t").reqProps.big.max).toBe(10000);
    expect(parseFlatSchemaLiteral(`{ type: "object", reqProps: { f: { type: "boolean", enum: ["true"] } } }`, "t").reqProps.f.type).toBe("boolean");
    expect(() => parseFlatSchemaLiteral(`{ type: "object", reqProps: { w: badIdent } }`, "契约 bad")).toThrow(/无法静态解析/);
    expect(() => parseFlatSchemaLiteral("{ type: \"object\", reqProps: { s: `x${1}` } }", "t")).toThrow(/插值/);
    expect(() => parseFlatSchemaLiteral("{ ...spread }", "t")).toThrow(/无法解析的对象条目/);
  });
});

/* ---------------- P2-G4：plain-object 原型键族（第三遍架构复校 §2.6） ----------------
 * __proto__ 显式拒绝（解析产物统一口径——普通对象上该键静默改原型，字段无声消失）；
 * `in` 改 Object.hasOwn（toString 等继承键不再误判重复声明 / 误报声明冲突）。 */
describe("P2-G4：原型键与继承键（解析器 / 契约扫描 / 投影器三面）", () => {
  it("红检：parseFlatSchemaLiteral 的 __proto__ 键 → 显式拒绝（修前静默改原型，reqProps 无声消失）", () => {
    expect(() => parseFlatSchemaLiteral('{ type: "object", reqProps: { __proto__: { type: "string" } } }', "契约 X")).toThrow(/__proto__/);
  });

  it("红检：scanContractSchemas 对继承键（toString）不再误判重复声明——契约名 toString 正常入册", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-openapi-proto-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "contract.ts"), 'export const toString = { type: "object", reqProps: {} };\n', "utf8");
      const sc = scanContractSchemas(root);
      expect(sc.idents, "修前：'toString' in byIdent 撞继承键 → 误判重复声明被跳过").toContain("toString");
      expect(sc.byIdent.toString?.value).toMatchObject({ type: "object" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("红检：projectJsonSchema 的 reqProps toString 不再被 `k in opt` 误报声明冲突", () => {
    const out = projectJsonSchema({ type: "object", reqProps: { toString: { type: "string" } }, optProps: {} } as FlatSchema);
    expect((out.properties as Record<string, unknown>)?.toString).toBeTruthy();
  });
});
