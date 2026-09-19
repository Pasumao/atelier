import { describe, it, expect } from "vitest";
import { withStandard, isStandardSchema, type StandardSchemaFace } from "../runtime/standard-schema";
import { collectFlatIssues, validateFlat, type FlatSchema } from "../runtime/contract";

const schema: FlatSchema = {
  type: "object",
  reqProps: {
    name: { type: "string" },
    status: { type: "string", enum: ["thinking", "streaming", "done"] },
  },
  optProps: {
    score: { type: "number", min: 0, max: 100 },
  },
};

describe("withStandard（决策 22，FS-2：Standard Schema V1 互操作口）", () => {
  it("挂载 ~standard：version 1 + vendor atelier，原契约字段保留（单源不变）", () => {
    const s = withStandard({ ...schema });
    expect(s["~standard"].version).toBe(1);
    expect(s["~standard"].vendor).toBe("atelier");
    // 契约单源仍可走原校验路径
    expect(validateFlat(s, { name: "c", status: "done" }).ok).toBe(true);
  });

  it("合法输入 → { value }（无变换，原样返回），无 issues", () => {
    const s = withStandard({ ...schema });
    const r = s["~standard"].validate({ name: "card", status: "done", score: 88 });
    expect(r.issues).toBeUndefined();
    expect(r.value).toEqual({ name: "card", status: "done", score: 88 });
  });

  it("非法输入 → issues 列表（含 path=叶子键），多条问题逐条产出", () => {
    const s = withStandard({ ...schema });
    const r = s["~standard"].validate({ status: "banana", score: 200 });
    expect(r.value).toBeUndefined();
    expect(r.issues!.length).toBeGreaterThanOrEqual(2);
    const msgs = r.issues!.map((i) => i.message);
    expect(msgs.some((m) => m.includes("缺少必填属性 name"))).toBe(true);
    expect(msgs.some((m) => m.includes("thinking"))).toBe(true);
    const paths = r.issues!.map((i) => i.path?.[0]);
    expect(paths).toContain("name");
    expect(paths).toContain("status");
  });

  it("非对象输入（string/array/null）→ 单条 issue「输入必须是 JSON 对象」", () => {
    const s = withStandard({ ...schema });
    for (const bad of ["nope", [1, 2], null]) {
      const r = s["~standard"].validate(bad);
      expect(r.issues!.length).toBe(1);
      expect(r.issues![0].message).toContain("输入必须是 JSON 对象");
    }
  });

  it("幂等：重复 withStandard 不换 validate 引用（原地附加）", () => {
    const raw: FlatSchema = { ...schema };
    const once = withStandard(raw);
    const twice = withStandard(once);
    expect(twice).toBe(raw);
    expect(twice["~standard"]).toBe(once["~standard"]);
  });

  it("~standard 属性 enumerable=false：契约导出/快照面不掺噪", () => {
    const raw: FlatSchema = { ...schema };
    withStandard(raw);
    expect(Object.keys(raw)).not.toContain("~standard");
    expect(JSON.parse(JSON.stringify(raw))["~standard"]).toBeUndefined();
  });

  it("isStandardSchema 守卫：仅认实现 ~standard 接口的对象", () => {
    expect(isStandardSchema(withStandard({ ...schema }))).toBe(true);
    expect(isStandardSchema({ ...schema })).toBe(false);
    expect(isStandardSchema(null)).toBe(false);
    expect(isStandardSchema({ "~standard": { version: 1 } })).toBe(false); // 无 validate
  });

  it("第三方消费端兼容：模仿 tRPC/Hono 式「任意 Standard Schema 可插」调用", () => {
    function thirdPartyConsume(std: StandardSchemaFace, input: unknown): { ok: boolean; firstIssue?: string } {
      const r = std["~standard"].validate(input);
      if (r.issues) return { ok: false, firstIssue: r.issues[0].message };
      return { ok: true };
    }
    const s = withStandard({ ...schema });
    expect(thirdPartyConsume(s, { name: "c", status: "done" }).ok).toBe(true);
    const bad = thirdPartyConsume(s, { name: 42, status: "done" });
    expect(bad.ok).toBe(false);
    expect(bad.firstIssue).toContain("期望 string");
  });

  it("collectFlatIssues：无 schema → 空；validateFlat 行为不变（抽取不改语义）", () => {
    expect(collectFlatIssues(undefined, {})).toEqual([]);
    const v = validateFlat({ ...schema }, { name: "c", status: "nope" });
    expect(v.ok).toBe(false);
    expect(v.error?.code).toBe("ATR-201");
    expect(v.error?.fix).toContain("thinking");
  });
});
