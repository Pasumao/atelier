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

/* ---------- notes.ts：app.notes / app.addNote（live 对账示例） ---------- */

/** app.notes 输出契约（§2.3 扁平 schema）：顶层必须是对象（checkEndpointOutput 红线），
 *  列表收在 notes 数组属性里。扁平 schema 红线 = 约束只挂叶子（决策 6），array 元素为对象
 *  的元素级结构契约 v1 不表——元素结构由 notes.ts 单点构造保证；接 db 后可用 table().rowSchema
 *  投影补齐（§5.1 数据契约与端点契约同源）。 */
export const noteListOutput = {
  type: "object",
  reqProps: { notes: { type: "array" } },
} satisfies FlatSchema;

/** app.addNote 输入契约：id 由客户端生成（§4.5 对账前提）+ text 非空 */
export const addNoteInput = {
  type: "object",
  reqProps: { id: { type: "string", min: 1 }, text: { type: "string", min: 1 } },
} satisfies FlatSchema;

/** app.addNote 输出契约：回显存后的 note（id/text/time——time 服务端钟为准） */
export const noteOutput = {
  type: "object",
  reqProps: { id: { type: "string" }, text: { type: "string" }, time: { type: "string" } },
} satisfies FlatSchema;
