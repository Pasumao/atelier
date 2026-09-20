import { z } from "zod";

// 契约单源：notes 的输入/输出契约（Route Handler 的唯一解析器来源，等价 atelier 臂 src/contract.ts）
// task1：priority 可选（0-9 整数，省略按 0）挂输入契约；noteRow 输出契约补 priority（列表读出）
export const createNoteInput = z.object({
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
