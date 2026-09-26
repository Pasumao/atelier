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
import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { addNoteInput, noteListOutput, noteOutput } from "../../contract.ts";

/** 内存态存储（§4.6 诚实边界：单进程内存态，多实例需外部 pub/sub——不做清单维持） */
const notes: { id: string; text: string; time: string }[] = [];

/** live query：GET <mount>/app.notes/live 订阅；POST <mount>/app.notes 直调同型可用 */
export const noteList = defineQuery("app.notes", {
  output: noteListOutput,
  live: { invalidate: ["key:notes"] },
  handler: () => ({ notes: notes.map((n) => ({ ...n })) }),
});

/** command：POST <mount>/app.addNote——id 幂等 upsert + 审计入账 + emits 失效广播。
 *  泛型标注入参（应用规范形态，扫描器两件 2026-09-20 起同款支持 <…> 平衡跳过）：
 *  handler 的 input 直接是 { id, text } 类型，无需 cast。 */
export const addNote = defineCommand<{ id: string; text: string }, { id: string; text: string; time: string }>("app.addNote", {
  contract: addNoteInput,
  output: noteOutput,
  emits: ["key:notes"],
  idempotent: true,
  handler: (input, ctx) => {
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
