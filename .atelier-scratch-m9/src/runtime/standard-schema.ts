/**
 * Standard Schema V1 互操作口（决策 22，FS-2）。
 * Atelier 扁平 schema（决策 6）挂上 `~standard` 属性后，即可被 tRPC v11 / Hono
 * standard-validator / TanStack 全家 / oRPC / NestJS 12 等 Standard Schema 消费端
 * 直接使用——纯接口适配：约 60 行规范类型、零运行时依赖、不 vendor 任何 schema 库。
 * 禁 $ref/oneOf 红线不动（$ref 在 JSON Schema 世界是"允许非强制"，扁平 = 有意的
 * LLM 可读性选择，见决策 21/22）。
 * 规范：https://standardschema.dev（V1：validate 同步返回 Result；实现可 copy-paste）。
 * 边界（诚实）：Standard JSON Schema V1 接口（jsonSchema 生成器，openapi-3.0 target）
 * 是编译期投影，归 compiler 侧（FS-9 `atelier export openapi`），runtime 不承诺；
 * 本规范无正式治理结构（三位作者个人背书）——接口面积小，适配层风险可控。
 */
import { collectFlatIssues, type FlatSchema } from "./contract.ts";

/** Standard Schema Issue（规范 V1 形状的本地最小子集：path 只产顶层叶子键） */
export type StandardIssue = {
  message: string;
  path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

/** Standard Schema Result：成功带 value（无变换 → 原输入），失败带 issues 列表 */
export type StandardValidateResult =
  | { readonly value: Record<string, unknown>; readonly issues?: undefined }
  | { readonly value?: undefined; readonly issues: readonly StandardIssue[] };

/** `~standard` 属性承载的 Props（规范 V1） */
export interface StandardSchemaProps {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) => StandardValidateResult;
}

/** 挂载后的 schema 面：原 FlatSchema 字段全部保留 + `~standard` */
export type StandardSchemaFace = { readonly "~standard": StandardSchemaProps };

export const STANDARD_VENDOR = "atelier";

/**
 * 给扁平 schema 挂 `~standard` 接口。原地附加（幂等：已有 `~standard` 则直接返回），
 * 契约对象仍是同一单源——注册表/编译器/MCP 持有的引用自动获得互操作能力；
 * 属性 enumerable=false，JSON.stringify(schema) 面不变（契约导出/快照不掺噪）。
 */
export function withStandard<T extends FlatSchema>(schema: T, vendor: string = STANDARD_VENDOR): T & StandardSchemaFace {
  const existing = (schema as T & Partial<StandardSchemaFace>)["~standard"];
  if (existing) return schema as T & StandardSchemaFace;
  const props: StandardSchemaProps = {
    version: 1,
    vendor,
    validate(value: unknown): StandardValidateResult {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { issues: [{ message: "输入必须是 JSON 对象" }] };
      }
      const issues = collectFlatIssues(schema, value as Record<string, unknown>);
      if (issues.length === 0) return { value: value as Record<string, unknown> };
      return { issues: issues.map((i) => ({ message: i.message, path: [i.path] })) };
    },
  };
  Object.defineProperty(schema, "~standard", { value: props, enumerable: false, configurable: false, writable: false });
  return schema as T & StandardSchemaFace;
}

/** 类型守卫：任意对象是否实现了 Standard Schema V1（消费端兼容判定用） */
export function isStandardSchema(x: unknown): x is StandardSchemaFace {
  if (typeof x !== "object" || x === null) return false;
  const s = (x as StandardSchemaFace)["~standard"];
  return typeof s === "object" && s !== null && s.version === 1 && typeof s.validate === "function";
}
