/**
 * Atelier prototype — 契约校验（决策 6/9 雏形）。
 * 扁平 schema（无 $ref/oneOf）→ AtrError 四段式。叶子字段约束：enum / min / max / pattern
 * （2026-08-30 设计备忘扩充；扁平红线不动——约束只挂叶子，不引入嵌套定义）。
 * 完整版差异：schema 由编译器从 TS 类型 AST 提取（本原型为组件元数据中手写）。
 * 2026-09-19（FS-2，决策 22）：抽出 collectFlatIssues 供 Standard Schema `~standard`
 * 互操作口复用——错误文案保持逐字一致，validateFlat 行为不变（纯抽取重构）。
 */

export type FlatField = {
  type: "string" | "number" | "boolean" | "array";
  items?: FlatField;
  enum?: string[];
  /** number: 数值下限（含）；string/array: 长度下限 */
  min?: number;
  /** number: 数值上限（含）；string/array: 长度上限 */
  max?: number;
  /** string: 正则（JSON Schema 语义，非锚定全匹配） */
  pattern?: string;
};
export type FlatSchema = { type: "object"; reqProps: Record<string, FlatField>; optProps?: Record<string, FlatField> };

export type AtrError = {
  code: string;
  message: string;
  context: { file?: string; component?: string; hints?: string[] };
  fix: string;
};

/** 单条校验问题（collectFlatIssues 产出）：message 与 validateFlat 错误文案同源，path = 叶子键 */
export type FlatIssue = { message: string; path: string };

/** 校验核心：逐字产出 validateFlat 的既有错误文案（无 schema → 空问题集 = 通过） */
export function collectFlatIssues(
  schema: FlatSchema | undefined,
  data: Record<string, unknown>
): FlatIssue[] {
  if (!schema) return [];
  const req = schema.reqProps ?? {};
  const opt = schema.optProps ?? {};
  const issues: FlatIssue[] = [];

  for (const [k, f] of Object.entries(req)) {
    if (!(k in data)) issues.push({ message: `缺少必填属性 ${k}（${f.type}）`, path: k });
  }
  for (const [k, f] of Object.entries({ ...opt, ...req })) {
    if (!(k in data)) continue;
    const v = data[k];
    if (f.type === "string" && typeof v !== "string") issues.push({ message: `${k}: 期望 string，实际 ${typeName(v)}`, path: k });
    else if (f.type === "number" && typeof v !== "number") issues.push({ message: `${k}: 期望 number，实际 ${typeName(v)}`, path: k });
    else if (f.type === "boolean" && typeof v !== "boolean") issues.push({ message: `${k}: 期望 boolean，实际 ${typeName(v)}`, path: k });
    else if (f.type === "array") {
      if (!Array.isArray(v)) issues.push({ message: `${k}: 期望 array，实际 ${typeName(v)}`, path: k });
      else if (f.items) {
        for (const it of v) {
          if (f.items.type === "string" && typeof it !== "string") issues.push({ message: `${k}[]: 期望 string 元素`, path: k });
          else if (f.items.type === "number" && typeof it !== "number") issues.push({ message: `${k}[]: 期望 number 元素`, path: k });
          else if (f.items.type === "boolean" && typeof it !== "boolean") issues.push({ message: `${k}[]: 期望 boolean 元素`, path: k });
          else if (f.items.type === "array") issues.push({ message: `${k}[][]: 嵌套数组元素不支持（扁平 schema 红线——约束只挂叶子）`, path: k });
        }
      }
    }
    if (f.enum && !f.enum.includes(v as string)) issues.push({ message: `${k}: 期望 ${f.enum.join("|")} 之一，实际 "${v}"`, path: k });
    // min/max/pattern（设计备忘 2026-08-30：仍扁平——无 $ref/oneOf，约束只挂在叶子字段上）
    if (f.type === "number" && typeof v === "number") {
      if (f.min != null && v < f.min) issues.push({ message: `${k}: ${v} 小于下限 ${f.min}`, path: k });
      if (f.max != null && v > f.max) issues.push({ message: `${k}: ${v} 超过上限 ${f.max}`, path: k });
    }
    if (f.type === "string" && typeof v === "string") {
      if (f.min != null && v.length < f.min) issues.push({ message: `${k}: 长度 ${v.length} 小于最小 ${f.min}`, path: k });
      if (f.max != null && v.length > f.max) issues.push({ message: `${k}: 长度 ${v.length} 超过最大 ${f.max}`, path: k });
      if (f.pattern != null) {
        let re: RegExp;
        try {
          re = new RegExp(f.pattern);
        } catch (e) {
          issues.push({ message: `${k}: schema pattern 无效（/${f.pattern}/ — ${(e as Error).message}）`, path: k });
          re = /(?:)/;
        }
        if (!re.test(v)) issues.push({ message: `${k}: "${v}" 不匹配 pattern /${f.pattern}/`, path: k });
      }
    }
    if (f.type === "array" && Array.isArray(v)) {
      if (f.min != null && v.length < f.min) issues.push({ message: `${k}: ${v.length} 项少于最小 ${f.min}`, path: k });
      if (f.max != null && v.length > f.max) issues.push({ message: `${k}: ${v.length} 项超过最大 ${f.max}`, path: k });
    }
  }
  return issues;
}

export function validateFlat(
  schema: FlatSchema | undefined,
  data: Record<string, unknown>,
  component = "?"
): { ok: boolean; error?: AtrError } {
  if (!schema) return { ok: true };
  const req = schema.reqProps ?? {};
  const opt = schema.optProps ?? {};
  const allKeys = [...Object.keys(req), ...Object.keys(opt)];

  const issues = collectFlatIssues(schema, data);
  if (issues.length > 0) {
    const messages = issues.map((i) => i.message);
    return {
      ok: false,
      error: {
        code: "ATR-201",
        message: messages[0],
        context: { component, hints: allKeys },
        fix: `按契约修正 props：${messages.join("；")}。可用属性：${allKeys.join(", ")}`,
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
        code: "ATR-205",
        message: "输入必须是 JSON 对象",
        context: { component },
        fix: "粘贴一个 JSON 对象，例如 {\"name\": \"deepseek-chat\"}",
      },
    };
  }
  return validateFlat(schema as FlatSchema, data as Record<string, unknown>, component);
}
