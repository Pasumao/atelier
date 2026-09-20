import { z } from "zod";

// 契约单源：notes 的输入/输出契约（Route Handler 的唯一解析器来源，等价 atelier 臂 src/contract.ts）
// task2：id 改由客户端生成并随请求上行——JSON number 正整数（钉死类型：表主键 INTEGER，
// 字符串 id 落不了库，属契约违规 → 400）；服务端按同 id 幂等合并（§4.5 对账协议的前提）。
export const createNoteInput = z.object({
  id: z.number().int().min(1),
  body: z.string().trim().min(1),
});

export const noteRow = z.object({
  id: z.number(),
  body: z.string(),
  createdAt: z.number(),
});

export const noteList = z.object({
  notes: z.array(noteRow),
});

export type CreateNoteInput = z.infer<typeof createNoteInput>;
export type NoteRow = z.infer<typeof noteRow>;
