/**
 * project-json.mjs — FlatSchema → JSON Schema 编译期投影器（FS-9 前半，FS-DESIGN §2.4，决策 22）。
 * 单管线三消费之基座：① `atelier export openapi`（§13）② MCP 工具 inputSchema（MCP 2026-07-28
 * 规范已采纳 JSON Schema 2020-12，扁平投影天然合规）③ `~standard.jsonSchema` 运行时口
 * （runtime/standard-schema.ts 的编译期同伴——validate 语义在 runtime，投影语义在此，绝不各写一套）。
 *
 * 投影规则（§2.4；min/max 语义按 runtime/contract.ts collectFlatIssues 逐条核对）：
 *   type: "object" + reqProps/optProps → type/properties/required（required 来自 reqProps，声明序）
 *   number 的 min/max   → minimum / maximum（含界，与 `v < f.min` / `v > f.max` 判定一致）
 *   string 的 min/max   → minLength / maxLength（与 length 比较一致，UTF-16 code unit 同语义）
 *   string 的 pattern   → pattern（原样输出——contract.ts 即 JSON Schema 语义，非锚定 re.test）
 *   array 的 min/max    → minItems / maxItems（§2.4 关键字清单的显式扩展：contract.ts 的 array
 *                          min/max 是项数界，minLength/maxLength 挂数组在 JSON Schema 里非法——
 *                          不投影即丢约束、错投影即偏离单源，取语义正确项并在此留档）
 *   array 的 items      → items（一层；元素只投影 type——validateFlat 对元素只做类型检查，
 *                          元素约束属扁平之外 → ATR-107）
 *   enum                → enum（validateFlat 对任意叶子类型做 includes 检查，原样投影；仅许字符串）
 *   显式不投影 additionalProperties:false——validateFlat 忽略未知键（宽松），收紧即偏离单源语义。
 *
 * 红线（决策 22）：遇到扁平语义之外的结构（$ref/oneOf/allOf/not/未知键/嵌套数组/items 携带约束/
 * boolean 挂 min/max/非 string 挂 pattern/非法正则/req-opt 重复声明/空 enum）显式 throw ATR-107
 * 四段式，绝不静默降级；fix 指路"改用扁平形态或手写 schema"。
 *
 * target ∈ { "draft-2020-12", "openapi-3.0" }（Standard Schema JSON Schema V1 的两个官方 target）：
 *   draft-2020-12 带 $schema 声明；openapi-3.0 是 OAS 3.0 Schema Object（基于 draft-04-wright，
 *   禁 $schema）——本投影器的扁平关键字集（含 minItems/maxItems）两 target 通用。
 *
 * 库形态：export projectJsonSchema(flat, target, opts?) / projectFlatField(field, target, opts?) /
 * PROJECT_TARGETS / atrProjectError——零依赖、零 eval、零 TS 解析器（compiler 侧纪律同 dump.mjs）。
 */

export const PROJECT_TARGETS = ["draft-2020-12", "openapi-3.0"];

const DRAFT_2020_12_SCHEMA_URL = "https://json-schema.org/draft/2020-12/schema";

/** ATR-107 四段式（新码：超出扁平投影能力）。Error 实例 + 四段字段随行（dump.mjs 同款形态；
 *  message 带码前缀——endpoints.ts AtrEndpointError 同惯例），绝不静默降级。 */
export function atrProjectError(message, fix, context = {}) {
  return Object.assign(new Error(`ATR-107: ${message}`), {
    code: "ATR-107",
    context: { domain: "project-json", ...context },
    fix,
  });
}

function fail(message, fix, context) {
  throw atrProjectError(message, fix, context);
}

/** 未知键检查：扁平语义之外的结构一律 ATR-107（$ref/oneOf/allOf 由这条自然拦截——不穷举） */
function checkKeys(obj, allowed, at) {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    fail(
      `${at}：扁平语义之外的键 ${unknown.map((k) => `"${k}"`).join(", ")}（$ref/oneOf/allOf 等组合形态超出扁平投影能力）`,
      "改用扁平形态（type/reqProps/optProps/enum/min/max/pattern/items）或手写 schema 消费——投影器绝不静默降级",
      { at, keys: unknown }
    );
  }
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 有限数检查（NaN/Infinity 在 JSON 里不可表达，落进 schema 即投影垃圾） */
function finiteNumberOrThrow(v, what, at) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(`${at}：${what} 必须是有限数字，实际 ${String(v)}`, "修正契约字面量（扁平纪律：直接数字字面量）", { at, value: String(v) });
  }
  return v;
}

/**
 * 叶子字段投影（FlatField → JSON Schema 片段）。projectJsonSchema 与 restful GET 的 query
 * parameters 共用本函数（单管线纪律：schema 投影只有一份）。
 */
export function projectFlatField(field, target = "draft-2020-12", opts = {}) {
  if (!PROJECT_TARGETS.includes(target)) {
    throw new Error(`未知投影 target「${String(target)}」（可用：${PROJECT_TARGETS.join(" | ")}）`);
  }
  const at = opts.label ?? "field";
  if (!isPlainObject(field)) {
    fail(`${at}：叶子定义必须是对象字面量，实际 ${field === null ? "null" : typeof field}`, "按 FlatField 形态书写（{ type, ...约束 }）", { at });
  }
  checkKeys(field, ["type", "items", "enum", "min", "max", "pattern"], at);

  const t = field.type;
  if (t !== "string" && t !== "number" && t !== "boolean" && t !== "array") {
    fail(
      `${at}：叶子 type「${String(t)}」超出扁平投影能力（只许 string/number/boolean/array；对象叶子请拆为顶层 reqProps/optProps）`,
      "改用扁平形态（嵌套对象拆平、复合结构用 array+items）或手写 schema 消费",
      { at, type: String(t) }
    );
  }

  // enum：validateFlat 对任意叶子类型做 includes 检查 → 原样投影；仅许非空字符串数组
  let enumValues;
  if (field.enum != null) {
    if (!Array.isArray(field.enum) || field.enum.length === 0) {
      fail(`${at}：enum 必须是非空字符串数组`, "删除空 enum 或补齐取值（空 enum 在 JSON Schema 中非法且 validateFlat 恒拒绝）", { at });
    }
    for (const v of field.enum) {
      if (typeof v !== "string") {
        fail(`${at}：enum 取值必须是字符串，实际 ${String(v)}`, "FlatField.enum 形态为 string[]——改用字符串取值", { at, value: String(v) });
      }
    }
    enumValues = field.enum.slice();
  }

  // min/max：按 contract.ts 语义分派（number=数值界 / string=长度界 / array=项数界 / boolean=无语义）
  let lower;
  let upper;
  if (field.min != null) {
    if (t === "number") lower = ["minimum", finiteNumberOrThrow(field.min, "min", at)];
    else if (t === "string") lower = ["minLength", nonNegativeInt(field.min, "min", at)];
    else if (t === "array") lower = ["minItems", nonNegativeInt(field.min, "min", at)];
    else fail(`${at}：boolean 挂 min 无校验语义（validateFlat 不消费）——超出扁平投影能力`, "删除该 min，或改用 number/string/array 叶子", { at, key: "min" });
  }
  if (field.max != null) {
    if (t === "number") upper = ["maximum", finiteNumberOrThrow(field.max, "max", at)];
    else if (t === "string") upper = ["maxLength", nonNegativeInt(field.max, "max", at)];
    else if (t === "array") upper = ["maxItems", nonNegativeInt(field.max, "max", at)];
    else fail(`${at}：boolean 挂 max 无校验语义（validateFlat 不消费）——超出扁平投影能力`, "删除该 max，或改用 number/string/array 叶子", { at, key: "max" });
  }

  // pattern：contract.ts 即 JSON Schema 语义（非锚定）→ 原样投影；非 string 叶子不消费 → ATR-107
  let pattern;
  if (field.pattern != null) {
    if (t !== "string") {
      fail(`${at}：pattern 只属于 string 叶子（validateFlat 只对 string 消费）`, "删除该 pattern，或把叶子改为 string", { at, type: t });
    }
    if (typeof field.pattern !== "string") {
      fail(`${at}：pattern 必须是字符串`, "写成普通字符串字面量正则", { at });
    }
    try {
      new RegExp(field.pattern);
    } catch (e) {
      fail(`${at}：pattern 非法正则（/${field.pattern}/ — ${e.message}）`, "修正正则（投影期提前拦截，validateFlat 同样判无效）", { at, pattern: field.pattern });
    }
    pattern = field.pattern;
  }

  // items：一层；元素只投影 type（validateFlat 对元素只做类型检查——元素约束属扁平之外）
  let items;
  if (field.items != null) {
    if (t !== "array") {
      fail(`${at}：items 只属于 array 叶子`, "删除 items，或把叶子改为 array", { at, type: t });
    }
    const it = field.items;
    if (!isPlainObject(it)) {
      fail(`${at}.items：元素定义必须是对象字面量`, "按 FlatField 形态书写（{ type }）", { at: `${at}.items` });
    }
    checkKeys(it, ["type"], `${at}.items`);
    if (it.type === "array") {
      fail(`${at}.items：嵌套数组超出扁平投影能力（validateFlat 判「嵌套数组元素不支持」）`, "改用扁平形态（数组只一层）或手写 schema 消费", { at: `${at}.items` });
    }
    if (it.type !== "string" && it.type !== "number" && it.type !== "boolean") {
      fail(`${at}.items：元素 type「${String(it.type)}」超出扁平投影能力`, "元素只许 string/number/boolean（validateFlat 元素检查同界）", { at: `${at}.items` });
    }
    items = { type: it.type };
  }

  // 定序输出（type → enum → min/max 映射 → pattern → items）——字节确定性供 golden 对拍
  const out = { type: t };
  if (enumValues) out.enum = enumValues;
  if (lower) out[lower[0]] = lower[1];
  if (upper) out[upper[0]] = upper[1];
  if (pattern != null) out.pattern = pattern;
  if (items) out.items = items;
  return out;
}

function nonNegativeInt(v, what, at) {
  const n = finiteNumberOrThrow(v, what, at);
  if (!Number.isInteger(n) || n < 0) {
    fail(`${at}：${what} 必须是非负整数（长度/项数界），实际 ${String(v)}`, "修正契约字面量", { at, value: String(v) });
  }
  return n;
}

/**
 * FlatSchema → JSON Schema（根投影）。
 * opts.label：错误 context 的 schema 名（契约单源常量标识符），ATR-107 可导航到具体契约。
 */
export function projectJsonSchema(flat, target = "draft-2020-12", opts = {}) {
  if (!PROJECT_TARGETS.includes(target)) {
    throw new Error(`未知投影 target「${String(target)}」（可用：${PROJECT_TARGETS.join(" | ")}）`);
  }
  const at = opts.label ?? "schema";
  if (!isPlainObject(flat)) {
    fail(`${at}：投影输入必须是 FlatSchema 对象字面量`, "按扁平形态书写（{ type: \"object\", reqProps, optProps }）", { at });
  }
  checkKeys(flat, ["type", "reqProps", "optProps"], at);
  if (flat.type !== "object") {
    fail(
      `${at}：根 type 必须是 "object"，实际「${String(flat.type)}」`,
      "FlatSchema 根形态固定为 { type: \"object\", reqProps, optProps }——叶子才挂 string/number/boolean/array",
      { at, type: String(flat.type) }
    );
  }

  const req = flat.reqProps ?? {};
  const opt = flat.optProps ?? {};
  if (!isPlainObject(req) || !isPlainObject(opt)) {
    fail(`${at}：reqProps/optProps 必须是对象字面量`, "按扁平形态书写（属性名 → FlatField）", { at });
  }

  const properties = {};
  const required = [];
  for (const [k, f] of Object.entries(req)) {
    if (k in opt) {
      fail(`${at}：属性 "${k}" 同时出现在 reqProps 与 optProps（声明冲突）`, "从 optProps 删除该属性（validateFlat 按 req 优先合并，歧义声明不投影）", { at, key: k });
    }
    properties[k] = projectFlatField(f, target, { label: `${at}.reqProps.${k}` });
    required.push(k);
  }
  for (const [k, f] of Object.entries(opt)) {
    properties[k] = projectFlatField(f, target, { label: `${at}.optProps.${k}` });
  }

  // 定序输出：$schema（仅 draft-2020-12）→ type → properties → required
  const out = {};
  if (target === "draft-2020-12") out.$schema = DRAFT_2020_12_SCHEMA_URL;
  out.type = "object";
  if (Object.keys(properties).length > 0) out.properties = properties;
  if (required.length > 0) out.required = required;
  // 空 schema（无 reqProps/optProps）= { type: "object" }：validateFlat 同样恒通过，语义一致
  return out;
}
