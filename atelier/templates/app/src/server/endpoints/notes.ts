/**
 * notes.ts — FS-7 live 直通示例端点对（§4.5 乐观更新对账协议的 server 版示例）。
 * app.notes：live query——`live: { invalidate: ["key:notes"] }` 显式失效键（§4.1），
 *   SSE 订阅走 GET <mount>/app.notes/live（§4.3 线协议：data 帧 = 输出契约校验过的 JSON）。
 * app.addNote：command——`emits: ["key:notes"]` 显式写侧失效键，提交成功（journal 入账后）
 *   触发 app.notes 订阅者失效-重算-推送（§4.2）。**id 由客户端生成并随请求上行**：
 *   这是 §4.5 对账协议的前提（客户端 optimistic 项 commit(id) 与 live 推送同 id 幂等合并）；
 *   服务端按 id 幂等 upsert（同 id 重放 = 更新而非重复插入），与 `idempotent: true` 元数据一致。
 * 端点命名惯例：app. 前缀点分命名空间（同 example.ts）；注册去哪？见 ../main-server.ts 装配点。
 * 前端消费形态见 ../../components/LiveNotes.atr.ts（streamValue + EventSource 手写直通 +
 * optimisticList 对账，§4.4 形态与 gen endpoint 生成物 live() 同型）。
 *
 * 诚实边界：内存态（模块级数组）= server 进程热重启即清（dev 示例可接受；live 订阅侧由
 *   EventSource 自动重连 + 首连全量重算自愈）。接 db 后的改法：数据进 table:notes 表，
 *   addNote 经 ctx.db 写库（写捕获自动合成 table:notes 失效键，emits 声明可删或保留为显式优先），
 *   app.notes handler 改 ctx.db.prepare 查询——两端的键与数据面同步换，前端协议零改动。
 */
import { defineCommand, defineQuery, type FlatSchema } from "../../vendor/atelier/server/index.ts";

/** 内存态存储（§4.6 诚实边界：单进程内存态，多实例需外部 pub/sub——不做清单维持） */
const notes: { id: string; text: string; time: string }[] = [];

/** app.notes 输出契约（§2.3 扁平 schema）：顶层必须是对象（checkEndpointOutput 红线），
 *  列表收在 notes 数组属性里。扁平 schema 红线 = 约束只挂叶子（决策 6），array 元素为对象
 *  的元素级结构契约 v1 不表——元素结构由本文件单点构造保证；接 db 后可用 table().rowSchema
 *  投影补齐（§5.1 数据契约与端点契约同源）。 */
const noteListOutput = {
  type: "object",
  reqProps: { notes: { type: "array" } },
} satisfies FlatSchema;

/** app.addNote 输入契约：id 由客户端生成（§4.5 对账前提）+ text 非空 */
const addNoteInput = {
  type: "object",
  reqProps: { id: { type: "string", min: 1 }, text: { type: "string", min: 1 } },
} satisfies FlatSchema;

/** app.addNote 输出契约：回显存后的 note（id/text/time——time 服务端钟为准） */
const noteOutput = {
  type: "object",
  reqProps: { id: { type: "string" }, text: { type: "string" }, time: { type: "string" } },
} satisfies FlatSchema;

/** live query：GET <mount>/app.notes/live 订阅；POST <mount>/app.notes 直调同型可用 */
export const noteList = defineQuery("app.notes", {
  output: noteListOutput,
  live: { invalidate: ["key:notes"] },
  handler: () => ({ notes: notes.map((n) => ({ ...n })) }),
});

/** command：POST <mount>/app.addNote——id 幂等 upsert + 审计入账 + emits 失效广播。
 *  形态注记：不用 defineCommand 泛型标注入参——gen-endpoint/openapi/impact 的文本扫描器只认
 *  紧跟名字字面量的调用形态（泛型标注 = 扫描盲区，被诚实跳过）；入参类型在 handler 入口经
 *  一次显式 cast 自输入契约桥接（运行时 ATR-201 校验守在该契约上）。 */
export const addNote = defineCommand("app.addNote", {
  contract: addNoteInput,
  output: noteOutput,
  emits: ["key:notes"],
  idempotent: true,
  handler: (raw, ctx) => {
    const input = raw as { id: string; text: string }; // 契约 → 类型桥（单点，ATR-201 已守）
    const existing = notes.find((n) => n.id === input.id);
    const time = new Date().toISOString();
    if (existing) {
      existing.text = input.text; // 同 id 重放 = 更新（幂等 upsert，客户端重试安全）
      existing.time = time;
      ctx.audit(`addNote id=${input.id} 重放更新（共 ${notes.length} 条）`);
    } else {
      notes.push({ id: input.id, text: input.text, time });
      ctx.audit(`addNote id=${input.id} 入库（内存态，共 ${notes.length} 条）`);
    }
    return { id: input.id, text: input.text, time };
  },
});
