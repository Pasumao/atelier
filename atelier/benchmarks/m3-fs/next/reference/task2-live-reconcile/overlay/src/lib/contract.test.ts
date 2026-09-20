import { describe, expect, it } from "vitest";
import { createNoteInput, noteList } from "./contract";

// 基线契约守卫测试（task2：id 客户端生成——JSON number 正整数，随请求上行）
describe("contract: notes", () => {
  it("createNoteInput 拒绝空 body", () => {
    expect(createNoteInput.safeParse({ id: 1, body: "" }).success).toBe(false);
    expect(createNoteInput.safeParse({ id: 1, body: "   " }).success).toBe(false);
  });

  it("createNoteInput 接受非空 body + 正整数 id", () => {
    expect(createNoteInput.safeParse({ id: 1, body: "hello" }).success).toBe(true);
    expect(createNoteInput.safeParse({ id: Date.now(), body: "hello" }).success).toBe(true);
  });

  it("createNoteInput 拒绝缺 id / 字符串 id / 非正整数 id（客户端 id 钉死 JSON number 正整数）", () => {
    expect(createNoteInput.safeParse({ body: "hello" }).success).toBe(false);
    expect(createNoteInput.safeParse({ id: "x", body: "hello" }).success).toBe(false);
    expect(createNoteInput.safeParse({ id: 0, body: "hello" }).success).toBe(false);
    expect(createNoteInput.safeParse({ id: 1.5, body: "hello" }).success).toBe(false);
  });

  it("noteList 接受合法列表帧", () => {
    expect(noteList.safeParse({ notes: [{ id: 1, body: "x", createdAt: 0 }] }).success).toBe(true);
  });
});
