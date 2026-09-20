/**
 * contract.ts — 端点契约单源（决策 6 扁平 schema；§2.1 三域契约统一形态）。
 * gen endpoint 扫描本文件的 export const 常量 + 端点声明，生成 src/generated/api.ts
 * 类型化客户端（FlatOf 投影以这里的常量为单源）——端点文件只 import、不内联契约。
 * 组件 props 契约不在此（组件 schema 跟组件走，三元共置）。
 */
import type { FlatSchema } from "./vendor/atelier/server/index.ts";

/* ---------- example.ts：app.ping（无契约）/ app.echo ---------- */

/** app.echo 输入契约（违规 → ATR-201 400） */
export const echoInput = {
  type: "object",
  reqProps: { message: { type: "string", min: 1 } },
} satisfies FlatSchema;

/** app.echo 输出契约（§2.3）：客户端 FlatOf 投影 + dev 态运行时校验 + OpenAPI 响应 schema 三用 */
export const echoOutput = {
  type: "object",
  reqProps: { echoed: { type: "string" }, length: { type: "number" }, time: { type: "string" } },
} satisfies FlatSchema;

/* ---------- notes.ts：notes.list / notes.create（M3-FS 基线链路） ---------- */

/** notes.create 输入契约：id 为客户端生成正整数（brief v2：JSON number，如 Date.now()——§4.5 对账前提）+ body 非空 */
export const noteCreateInput = {
  type: "object",
  reqProps: { id: { type: "number", min: 1 }, body: { type: "string", min: 1 } },
  optProps: { priority: { type: "number", min: 0, max: 9 } },
} satisfies FlatSchema;

/** notes.create 输出契约：回显存后的行（createdAt 服务端钟为准） */
export const noteRowOutput = {
  type: "object",
  reqProps: { id: { type: "number" }, body: { type: "string" }, createdAt: { type: "number" }, priority: { type: "number" } },
} satisfies FlatSchema;

/** notes.list 输出契约（§2.3 扁平 schema）：顶层必须是对象，列表收在 notes 数组属性里；
 *  array 元素为对象的元素级结构契约 v1 不表——元素结构由 notes.ts 单点构造保证。 */
export const noteListOutput = {
  type: "object",
  reqProps: { notes: { type: "array" } },
} satisfies FlatSchema;
