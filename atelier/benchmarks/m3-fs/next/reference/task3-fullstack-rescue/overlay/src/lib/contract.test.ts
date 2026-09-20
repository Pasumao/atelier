import { describe, expect, it } from "vitest";
import { createNoteInput, noteList } from "./contract";

// 契约守卫测试（task3 合成态：priority 0-9 可选 + id 可选——给则须为正整数）
describe("contract: notes", () => {
  it("createNoteInput 拒绝空 body", () => {
    expect(createNoteInput.safeParse({ body: "" }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "   " }).success).toBe(false);
  });

  it("createNoteInput 接受省略式创建（body + 可选 priority）", () => {
    expect(createNoteInput.safeParse({ body: "hello" }).success).toBe(true);
    expect(createNoteInput.safeParse({ body: "hello", priority: 7 }).success).toBe(true);
  });

  it("createNoteInput 的 priority 拒绝越界/小数/非整数，接受 0-9 整数", () => {
    expect(createNoteInput.safeParse({ body: "x", priority: 10 }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "x", priority: 2.5 }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "x", priority: "7" }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "x", priority: -1 }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "x", priority: 9 }).success).toBe(true);
  });

  it("createNoteInput 的 id 可选；给则必须为正整数（字符串 id 属契约违规）", () => {
    expect(createNoteInput.safeParse({ id: Date.now(), body: "hello" }).success).toBe(true);
    expect(createNoteInput.safeParse({ id: "x", body: "hello" }).success).toBe(false);
    expect(createNoteInput.safeParse({ id: 0, body: "hello" }).success).toBe(false);
    expect(createNoteInput.safeParse({ id: 1.5, body: "hello" }).success).toBe(false);
  });

  it("noteList 接受合法列表帧（行含 priority）", () => {
    expect(noteList.safeParse({ notes: [{ id: 1, body: "x", createdAt: 0, priority: 0 }] }).success).toBe(true);
  });
});
