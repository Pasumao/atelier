import { describe, expect, it } from "vitest";
import { createNoteInput, noteList } from "./contract";

// 基线契约守卫测试（task1：priority 0-9 可选 + noteRow 输出面补 priority）
describe("contract: notes", () => {
  it("createNoteInput 拒绝空 body", () => {
    expect(createNoteInput.safeParse({ body: "" }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "   " }).success).toBe(false);
  });

  it("createNoteInput 接受非空 body（priority 省略合法）", () => {
    expect(createNoteInput.safeParse({ body: "hello" }).success).toBe(true);
  });

  it("createNoteInput 的 priority 拒绝越界/小数/非整数，接受 0-9 整数", () => {
    expect(createNoteInput.safeParse({ body: "x", priority: 10 }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "x", priority: 2.5 }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "x", priority: "7" }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "x", priority: -1 }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "x", priority: 9 }).success).toBe(true);
    expect(createNoteInput.safeParse({ body: "x", priority: 0 }).success).toBe(true);
  });

  it("noteList 接受合法列表帧（行含 priority）", () => {
    expect(noteList.safeParse({ notes: [{ id: 1, body: "x", createdAt: 0, priority: 0 }] }).success).toBe(true);
  });
});
