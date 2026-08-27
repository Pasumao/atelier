import { describe, it, expect } from "vitest";
import { streamValue, optimisticList } from "../src/primitives";

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
});
