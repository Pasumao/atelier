import { z } from "zod";

// 契约单源：notes 的输入/输出契约（Route Handler 的唯一解析器来源，等价 atelier 臂 src/contract.ts）
// task3 合成态：
// - priority 可选（0-9 整数，省略按 0）挂输入契约；noteRow 输出契约补 priority（task1 半）；
// - id 客户端生成随请求上行（JSON number 正整数）——但本任务 M4 判据以 {body, priority}
//   省略式创建，故 id 为**可选**：省略 = 服务端自增；给则必须为正整数并按同 id 幂等合并
//   （字符串 id / 0 / 小数均属契约违规 → 400，task2 半）。
export const createNoteInput = z.object({
  id: z.number().int().min(1).optional(),
  body: z.string().trim().min(1),
  priority: z.number().int().min(0).max(9).optional(),
});

export const noteRow = z.object({
  id: z.number(),
  body: z.string(),
  createdAt: z.number(),
  priority: z.number(),
});

export const noteList = z.object({
  notes: z.array(noteRow),
});

export type CreateNoteInput = z.infer<typeof createNoteInput>;
export type NoteRow = z.infer<typeof noteRow>;
