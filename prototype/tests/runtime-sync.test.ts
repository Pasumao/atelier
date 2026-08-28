/**
 * runtime-sync.test.ts — 供应商拷贝守卫（仅 workspace 内有效）。
 *
 * 框架 runtime 的真相源 = atelier/runtime/；prototype/src/runtime/ 是为
 * 「脚手架自包含」（atelier init 整拷 prototype）而存在的供应商拷贝。
 * 纪律：改 runtime 先改 atelier/runtime，再整拷同步到 prototype/src/runtime，
 * 本测试保证两边字节一致（init-project.mjs 脚手架时会排除本文件）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const VENDORED = path.resolve(__dirname, "../src/runtime");
const TRUTH = path.resolve(__dirname, "../../atelier/runtime");

const TRUTH_FILES = fs.readdirSync(TRUTH).filter((f) => f.endsWith(".ts"));
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

describe("vendored runtime sync (workspace-only guard)", () => {
  it("framework runtime files exist (8 modules incl. index)", () => {
    expect(TRUTH_FILES.length).toBeGreaterThanOrEqual(8);
  });

  it("prototype/src/runtime is byte-identical to atelier/runtime", () => {
    for (const f of TRUTH_FILES) {
      const vPath = path.join(VENDORED, f);
      expect(fs.existsSync(vPath), `供应商拷贝缺少 ${f} —— 从 atelier/runtime 整拷同步`).toBe(true);
      expect(sha(vPath), `${f} 与 atelier/runtime 不一致——先改框架侧，再整拷同步`).toBe(sha(path.join(TRUTH, f)));
    }
  });

  it("vendored copy has no extra files beyond the framework truth", () => {
    const vendored = fs.readdirSync(VENDORED).filter((f) => f.endsWith(".ts"));
    for (const f of vendored) {
      expect(TRUTH_FILES, `供应商拷贝多出 ${f}——删掉或同步进 atelier/runtime`).toContain(f);
    }
  });
});
