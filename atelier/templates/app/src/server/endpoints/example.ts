/**
 * example.ts — starter 内置端点示例（FS-7 dev 托管最小全栈路径，零 db 依赖）。
 * app.ping：最简 query——无契约无状态，探活/冒烟用（端点面统一 POST，GET → ATR-311 405）。
 * app.echo：command 全形态演示——内联扁平输入契约（违规 → ATR-201 400）+ output 契约
 *   （dev 态校验，违规 → ATR-215）+ ctx.audit 业务备注（并入 command journal）。
 * 端点命名惯例：app. 前缀点分命名空间（同 gen endpoint 产物 chat.ask 形态）；
 * 注册去哪？见 ../main-server.ts 装配点。接 db 后契约挪 src/contract.ts 单源
 * （gen endpoint 扫描端点与契约常量，生成 src/generated/api.ts 类型化客户端）。
 */
import { defineCommand, defineQuery, type FlatSchema } from "../../vendor/atelier/server/index.ts";

/** app.echo 输入契约（决策 6 扁平 schema 单源；示例取内联形态，扩面后挪 src/contract.ts） */
const echoInput = {
  type: "object",
  reqProps: { message: { type: "string", min: 1 } },
} satisfies FlatSchema;

/** app.echo 输出契约（§2.3）：客户端 FlatOf 投影 + dev 态运行时校验 + OpenAPI 响应 schema 三用 */
const echoOutput = {
  type: "object",
  reqProps: { echoed: { type: "string" }, length: { type: "number" }, time: { type: "string" } },
} satisfies FlatSchema;

/** 探活端点：POST <mount>/app.ping（体缺省 {}）→ { ok: true, time } */
export const ping = defineQuery("app.ping", {
  handler: () => ({ ok: true, time: new Date().toISOString() }),
});

/** 回显 command：成功入审计 journal（status=ok + audit notes），代理调了什么可查（dev 面 journal 时间轴） */
export const echo = defineCommand<{ message: string }, { echoed: string; length: number; time: string }>("app.echo", {
  contract: echoInput,
  output: echoOutput,
  handler: (input, ctx) => {
    ctx.audit(`echo ${input.message.length} 字符`);
    return { echoed: input.message, length: input.message.length, time: new Date().toISOString() };
  },
});
