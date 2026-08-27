/**
 * Atelier prototype — 契约校验（决策 6/9 雏形）。
 * 扁平 schema（无 $ref/oneOf）→ AtrError 四段式。
 * 完整版差异：schema 由编译器从 TS 类型 AST 提取（本原型为组件元数据中手写）。
 */

export type FlatField = {
  type: "string" | "number" | "boolean" | "array";
  items?: FlatField;
  enum?: string[];
};
export type FlatSchema = { type: "object"; reqProps: Record<string, FlatField>; optProps?: Record<string, FlatField> };

export type AtrError = {
  code: string;
  message: string;
  context: { file?: string; component?: string; hints?: string[] };
  fix: string;
};

export function validateFlat(
  schema: FlatSchema | undefined,
  data: Record<string, unknown>,
  component = "?"
): { ok: boolean; error?: AtrError } {
  if (!schema) return { ok: true };
  const req = schema.reqProps ?? {};
  const opt = schema.optProps ?? {};
  const allKeys = [...Object.keys(req), ...Object.keys(opt)];
  const errors: string[] = [];

  for (const [k, f] of Object.entries(req)) {
    if (!(k in data)) errors.push(`缺少必填属性 ${k}（${f.type}）`);
  }
  for (const [k, f] of Object.entries({ ...opt, ...req })) {
    if (!(k in data)) continue;
    const v = data[k];
    if (f.type === "string" && typeof v !== "string") errors.push(`${k}: 期望 string，实际 ${typeName(v)}`);
    else if (f.type === "number" && typeof v !== "number") errors.push(`${k}: 期望 number，实际 ${typeName(v)}`);
    else if (f.type === "boolean" && typeof v !== "boolean") errors.push(`${k}: 期望 boolean，实际 ${typeName(v)}`);
    else if (f.type === "array") {
      if (!Array.isArray(v)) errors.push(`${k}: 期望 array，实际 ${typeName(v)}`);
      else if (f.items) {
        for (const it of v) {
          if (f.items.type === "string" && typeof it !== "string") errors.push(`${k}[]: 期望 string 元素`);
          else if (f.items.type === "number" && typeof it !== "number") errors.push(`${k}[]: 期望 number 元素`);
        }
      }
    }
    if (f.enum && !f.enum.includes(v as string)) errors.push(`${k}: 期望 ${f.enum.join("|")} 之一，实际 "${v}"`);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        code: "ATR-201",
        message: errors[0],
        context: { component, hints: allKeys },
        fix: `按契约修正 props：${errors.join("；")}。可用属性：${allKeys.join(", ")}`,
      },
    };
  }
  return { ok: true };
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** 演示用：把任意 JS 数据按 schema 校验（契约演示面板） */
export function validateUnknown(schema: unknown, data: unknown, component = "ContractDemo"): { ok: boolean; error?: AtrError } {
  if (typeof data !== "object" || data === null) {
    return {
      ok: false,
      error: {
        code: "ATR-201",
        message: "输入必须是 JSON 对象",
        context: { component },
        fix: "粘贴一个 JSON 对象，例如 {\"name\": \"deepseek-chat\"}",
      },
    };
  }
  return validateFlat(schema as FlatSchema, data as Record<string, unknown>, component);
}
