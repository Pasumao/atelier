/**
 * struct-layers.test.ts — R3 结构债批（B 件）：probeChecks 八层各一函数直测（评审 §6 R3
 * 「巨型函数拆分其余项：probeChecks 八层各一函数」/ §2.2 风险 2「巨型平铺函数没有可测试面」）。
 *
 * struct.mjs 原 probeChecks 约 394 行平铺 if-chain，本批拆为八个层探针函数
 * （probeEntryLayer … probeDataLayer，签名统一 (root, add)）+ LAYER_PROBES 表驱动分派。
 * 本文件钉三件事：
 *   1. 表形状：恰 8 层、层号 1..8 依序、名称唯一；
 *   2. 层隔离：每个探针直调只产本层 finding（layer 字段零越界）；
 *   3. 分派等价：LAYER_PROBES 表序直调全跑 ≡ inspectStructure 全量输出（顺序 + 完整性全等，
 *      防未来表外追加/乱序使 probeChecks 与表分叉）；
 * 另附每层可单独调用的行为样例（timeline/entry 直调）。
 * 纪律：struct 既有测试（struct-guards / mcp-vendor structure.map / checkpoint 联动）零修改全绿
 * = 行为逐字节等价门；本文件全部为新增直测面。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inspectStructure, LAYER_PROBES } from "../scripts/struct.mjs";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

let seq = 0;
function makeProject(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atelier-struct-layers-${++seq}-`));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  roots.push(root);
  return root;
}

function runProbe(entry: (typeof LAYER_PROBES)[number], root: string) {
  const f: any[] = [];
  entry.probe(root, (o: any) => f.push(o));
  return f;
}

describe("R3-B 件②：LAYER_PROBES 表形状", () => {
  it("恰 8 个探针：层号 1..8 依序、名称唯一、probe 均为 (root, add) 可调函数", () => {
    expect(Array.isArray(LAYER_PROBES)).toBe(true);
    expect(LAYER_PROBES).toHaveLength(8);
    expect(LAYER_PROBES.map((e) => e.layer)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(LAYER_PROBES.map((e) => e.name)).size).toBe(8);
    for (const e of LAYER_PROBES) expect(typeof e.probe).toBe("function");
  });
});

describe("R3-B 件②：层隔离直调（每个探针只产本层 finding）", () => {
  const MIXED = {
    "AGENTS.md": "routing table\n".repeat(10), // layer 1
    ".gitignore": "node_modules/\n", // probeChecks 尾部 global trust rule 静默（表外件——等价钉才全等）
    "llms.txt": "index\n", // layer 1（无 INFO）
    "atelier/skills/atelier/SKILL.md": "pack\n", // layer 2
    "atelier.config.json": JSON.stringify({ tokens: { c: { bg: "#fff" } }, locked: [] }), // layer 3
    "src/manifest.json": JSON.stringify({ components: [{ name: "A", file: "./a.ts" }] }), // layer 3
    "src/a.ts": "export const a = 1;\n", // manifest 目标
    "src/main.ts": `import { a } from "./a.ts";\nconsole.log(a);\n`, // layer 7（无泄漏）
    "package.json": JSON.stringify({ dependencies: {}, devDependencies: {} }), // layer 7
    ".atelier/checkpoints.jsonl": JSON.stringify({ type: "save", id: "aaa0000" }), // layer 6
    "src/server/db/migrations/001_x.up.sql": "CREATE TABLE x (id);\n", // layer 8（成对）
    "src/server/db/migrations/001_x.down.sql": "DROP TABLE x;\n",
  };

  it("每个探针直调：全部 finding 的 layer 恰为该探针层号（零越界）", () => {
    const root = makeProject(MIXED);
    for (const entry of LAYER_PROBES) {
      const findings = runProbe(entry, root);
      for (const f of findings) {
        expect(f.layer, `探针 ${entry.name} 产出了 layer ${f.layer} 的 finding（越界）`).toBe(entry.layer);
      }
      expect(findings.length, `探针 ${entry.name} 在混合夹具上应有产出（对象文件在位）`).toBeGreaterThan(0);
    }
  });

  it("表序直调全跑 ≡ inspectStructure 全量输出（顺序 + 完整性全等——分派等价钉）", () => {
    const root = makeProject(MIXED);
    const viaTable: any[] = [];
    for (const entry of LAYER_PROBES) viaTable.push(...runProbe(entry, root));
    const viaInspect = inspectStructure(root).layers.flatMap((l) => l.findings);
    expect(viaTable).toEqual(viaInspect);
  });
});

describe("R3-B 件②：单层直调行为样例", () => {
  it("layer 6（timeline）：checkpoints.jsonl 在位 → TIMELINE_STORE ok（save 行计数）", () => {
    const entry = LAYER_PROBES.find((e) => e.layer === 6)!;
    const root = makeProject({
      ".atelier/checkpoints.jsonl": [
        JSON.stringify({ type: "save", id: "aaa0000" }),
        JSON.stringify({ type: "save", id: "bbb1111" }),
        JSON.stringify({ type: "rollback", id: "rb-xx" }),
      ].join("\n"),
    });
    const f = runProbe(entry, root);
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe("TIMELINE_STORE");
    expect(f[0].severity).toBeNull();
    expect(f[0].detail).toContain("3 timeline event(s)");
    expect(f[0].detail).toContain("2 anchored checkpoint(s)");
  });

  it("layer 1（entry）：AGENTS.md 超预算 → ENTRY_AGENTS_MD_BUDGET WARN（直调即可断言，无需整链）", () => {
    const entry = LAYER_PROBES.find((e) => e.layer === 1)!;
    const slim = runProbe(entry, makeProject({ "AGENTS.md": "short\n" }));
    expect(slim.some((f) => f.id === "ENTRY_AGENTS_MD_BUDGET")).toBe(false);
    const fat = runProbe(entry, makeProject({ "AGENTS.md": "line\n".repeat(120) + "line" })); // 恰 121 行
    const budget = fat.find((f) => f.id === "ENTRY_AGENTS_MD_BUDGET");
    expect(budget?.severity).toBe("WARN");
    expect(budget?.detail).toContain("121 lines");
  });
});
