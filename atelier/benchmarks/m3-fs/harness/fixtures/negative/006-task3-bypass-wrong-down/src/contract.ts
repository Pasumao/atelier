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

/* ---------- notes 域：notes.list / notes.create（task3：priority 贯通 + live 对账合成态） ---------- */

/** note 行契约（扁平 schema 单源）：notes 表行形状口径——notes.create 的输出契约直接引用
 *  本常量（存什么返什么）。priority 列已由 002 迁移加入（NOT NULL DEFAULT 0）→ 行内必有该字段。
 *  数组元素级的结构契约 v1 不表（扁平红线：约束只挂叶子），列表行形状由 notes.list handler
 *  单点构造保证。 */
export const noteSchema = {
  type: "object",
  reqProps: {
    id: { type: "number" },
    body: { type: "string", min: 1 },
    createdAt: { type: "number" },
    priority: { type: "number" },
  },
} satisfies FlatSchema;

/** notes.create 输入契约：id 由**客户端生成**（§4.5 对账前提——正整数随请求上行，同 id 幂等
 *  upsert）；body 非空；priority 可省略、省略按 0，传入须在 0-9（含）内——越界 = ATR-201，
 *  整数性由 handler 归一（Math.trunc，扁平 schema 无整数类型）。 */
export const noteCreateInput = {
  type: "object",
  reqProps: { id: { type: "number", min: 1 }, body: { type: "string", min: 1 } },
  optProps: { priority: { type: "number", min: 0, max: 9 } },
} satisfies FlatSchema;

/** notes.list 输出契约：顶层必须是对象（checkEndpointOutput 红线），列表收在 notes 数组属性里 */
export const noteListOutput = {
  type: "object",
  reqProps: { notes: { type: "array" } },
} satisfies FlatSchema;
