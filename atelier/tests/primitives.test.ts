import { describe, it, expect } from "vitest";
import { streamValue, optimisticList } from "../runtime/primitives";

describe("streamValue (decision 9: no manual typewriter)", () => {
  it("appends values and exposes the last one", () => {
    const s = streamValue<string>();
    expect(s.done).toBe(false);
    s.push("Deep");
    s.push("Seek");
    expect(s.values.join("")).toBe("DeepSeek");
    expect(s.value).toBe("Seek");
  });

  it("finish flips done without mutating values", () => {
    const s = streamValue<number>();
    s.push(1);
    s.finish();
    expect(s.done).toBe(true);
    expect(s.values).toEqual([1]);
  });
});

describe("streamValue error 位（FS-DESIGN §8.3：失败不断流）", () => {
  it("初始 error = null；新错误帧覆盖旧帧（新帧胜出）", () => {
    const s = streamValue<string>();
    expect(s.error).toBe(null);
    s.error = { code: "ATR-321", message: "第一帧", fix: "f1" };
    expect(s.error?.code).toBe("ATR-321");
    expect(s.error?.fix).toBe("f1");
    s.error = { message: "第二帧" }; // 残缺帧（只有 message）也合法——结构最小形态
    expect(s.error?.code).toBeUndefined();
    expect(s.error?.message).toBe("第二帧");
  });

  it("失败不断流：error 赋值不动 values/done；push/finish 也不清 error", () => {
    const s = streamValue<string>();
    s.push("a");
    s.error = { message: "boom", fix: "fix it" };
    expect(s.values).toEqual(["a"]); // error 位赋值不断流
    expect(s.done).toBe(false);
    s.push("b"); // 错误后流继续
    expect(s.values).toEqual(["a", "b"]);
    expect(s.error?.message).toBe("boom"); // push 不清 error
    s.finish();
    expect(s.done).toBe(true);
    expect(s.values).toEqual(["a", "b"]); // finish 不清 values
    expect(s.error?.message).toBe("boom"); // finish 不清 error
  });

  it("error 可显式清回 null（重试前的 UI 复位通道）", () => {
    const s = streamValue<string>();
    s.error = { message: "x" };
    s.error = null;
    expect(s.error).toBe(null);
  });
});

describe("optimisticList (pending → committed | reverted)", () => {
  it("add is pending; commit promotes by id", () => {
    const l = optimisticList<{ id: string; label: string }>();
    l.optimisticAdd({ id: "t1", label: "web_search" });
    expect(l.values[0].status).toBe("pending");
    l.commit("t1");
    expect(l.values[0].status).toBe("committed");
  });

  it("revert removes the item and records the rollback as truth", () => {
    const l = optimisticList<{ id: string }>();
    l.optimisticAdd({ id: "a" });
    l.revert("a");
    expect(l.values.length).toBe(0);
    expect(l.rollbacked).toContain("a");
  });

  it("revert of unknown id is a no-op", () => {
    const l = optimisticList<{ id: string }>();
    l.optimisticAdd({ id: "a" });
    const before = JSON.stringify(l.values);
    l.revert("ghost");
    expect(JSON.stringify(l.values)).toBe(before);
    expect(l.rollbacked).not.toContain("ghost");
  });

  it("revert(id, err) 携带错误进 revertErrors 台账；rollbacked 形状不破；无 err 的 revert 不记台账（§8.3）", () => {
    const l = optimisticList<{ id: string }>();
    l.optimisticAdd({ id: "a" });
    l.optimisticAdd({ id: "b" });
    l.revert("a"); // 旧签名（向后兼容）：只进 rollbacked，不进 revertErrors
    l.revert("b", { code: "ATR-201", message: "bad", fix: "改 text" });
    expect(l.rollbacked).toEqual(["a", "b"]); // 既有形状逐字节不破
    expect(l.values.length).toBe(0);
    expect(l.revertErrors).toEqual([{ id: "b", error: { code: "ATR-201", message: "bad", fix: "改 text" } }]);
  });

  it("revert 未知 id 的 no-op 不进 revertErrors（与 rollbacked 同门槛）", () => {
    const l = optimisticList<{ id: string }>();
    l.optimisticAdd({ id: "a" });
    l.revert("ghost", { message: "x" });
    expect(l.rollbacked).toEqual([]);
    expect(l.revertErrors).toEqual([]);
  });
});
