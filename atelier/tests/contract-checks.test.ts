/**
 * contract-checks.test.ts — R2 批契约面单源化机检验收（2026-09-30 架构评审 §6 批次 R2）：
 * 派生函数（dispatch 动词/HELP 旗标/runtime 桶出口 API/ATR 码扫描/三表解析/§8 表解析）的语义边界 +
 * 仓库真值集成断言（错误码反向对账 / 三表同步 / §8 ↔ dispatch 对账）。
 * 诚实边界：§8 子命令级（gen db / migrate up …）无机检——dispatch 子命令无单一可解析真相源。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractBarrelApi,
  extractDispatchVerbs,
  extractHelpFlags,
  parseArchSection8,
  parseCatalogCodes,
  parseFsDesignSection,
  parseSpecSection,
  runChecks,
  scanAtrCodes,
} from "../scripts/contract-checks.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atelier-contract-checks-"));
}
function write(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, "utf8");
}

describe("extractDispatchVerbs（cli.mjs 顶层 case 词）", () => {
  it("收连字符命令与 help，不收 case undefined / --help", () => {
    const dir = tmpDir();
    const cli = path.join(dir, "cli.mjs");
    write(
      cli,
      `switch (cmd) {
  case "init": break;
  case "api-diff": break;
  case "help": break;
  case undefined: break;
  case "--help": break;
  default: break;
}`,
    );
    const verbs = extractDispatchVerbs(cli);
    expect(verbs.has("init")).toBe(true);
    expect(verbs.has("api-diff")).toBe(true);
    expect(verbs.has("help")).toBe(true);
    expect(verbs.has("undefined")).toBe(false);
    expect(verbs.has("--help")).toBe(false);
  });
});

describe("extractHelpFlags（只认 HELP 模板块，dispatch 体内的旗标字符串不算）", () => {
  it("HELP 内旗标收编；体外出现的旗标与幻影旗标不收", () => {
    const dir = tmpDir();
    const cli = path.join(dir, "cli.mjs");
    write(
      cli,
      `const HELP = \`atelier init --target <dir> [--no-ai]
atelier bench --app <dir> [--json]\`;
const argvAll = process.argv; // "--target" in dispatch body must not count
const PHANTOM = "--electron"; // not in HELP`,
    );
    const flags = extractHelpFlags(cli);
    expect(flags.has("--target")).toBe(true);
    expect(flags.has("--no-ai")).toBe(true);
    expect(flags.has("--app")).toBe(true);
    expect(flags.has("--electron")).toBe(false);
  });
  it("无 HELP 块 → 空集（不抛）", () => {
    const dir = tmpDir();
    const cli = path.join(dir, "cli.mjs");
    write(cli, `console.log("no help");`);
    expect(extractHelpFlags(cli).size).toBe(0);
  });
});

describe("extractBarrelApi（runtime/index.ts 桶出口）", () => {
  it("value/type 分面；别名取暴露名；inline export function 归 value", () => {
    const dir = tmpDir();
    const idx = path.join(dir, "index.ts");
    write(
      idx,
      `export { $state, $derived, store } from "./core.ts";
export type { Signal } from "./core.ts";
export { A as B } from "./x.ts";
export type { C as D } from "./y.ts";
export function devFetch(path: string) { return fetch(path); }
export interface FlatSchema {}`,
    );
    const api = extractBarrelApi(idx);
    expect(api.values.has("$state")).toBe(true);
    expect(api.values.has("store")).toBe(true);
    expect(api.values.has("B")).toBe(true);
    expect(api.values.has("devFetch")).toBe(true);
    expect(api.values.has("Signal")).toBe(false);
    expect(api.types.has("Signal")).toBe(true);
    expect(api.types.has("D")).toBe(true);
    expect(api.types.has("FlatSchema")).toBe(true);
  });
  it("红检回归钉：幻影 API（expect/verify）不在真桶出口", () => {
    const { values } = extractBarrelApi(path.resolve(import.meta.dirname, "../runtime/index.ts"));
    expect(values.has("expect")).toBe(false);
    expect(values.has("verify")).toBe(false);
  });
});

describe("scanAtrCodes（ATR-\\d{3} 出现点，file:line）", () => {
  it("嵌套目录/多命中行号正确；跳过自身与未知扩展名", () => {
    const dir = tmpDir();
    write(path.join(dir, "runtime", "a.ts"), `const x = "ATR-310";\nthrow "ATR-320";`);
    write(path.join(dir, "server", "sub", "b.mjs"), `die("ATR-310");`);
    write(path.join(dir, "docs", "c.md"), `ATR-310 in md is not scanned`);
    write(path.join(dir, "scripts", "contract-checks.mjs"), `// self ATR-500 excluded`);
    const found = scanAtrCodes(dir, ["runtime", "server", "docs", "scripts"], {
      self: path.join(dir, "scripts", "contract-checks.mjs"),
    });
    expect(found.get("ATR-310")).toEqual([
      { file: "runtime/a.ts", line: 1 },
      { file: "server/sub/b.mjs", line: 1 },
    ]);
    expect(found.get("ATR-320")).toEqual([{ file: "runtime/a.ts", line: 2 }]);
    expect(found.has("ATR-500")).toBe(false);
  });
});

describe("三表解析器（总表 / FS-DESIGN §15 / SPEC §3.2）", () => {
  it("总表：整文件 ATR-\\d{3}，段头 ATR-1xx 通配不混入", () => {
    const dir = tmpDir();
    const md = path.join(dir, "SKILL.md");
    write(md, "## ATR-1xx — Compile\n\n| ATR-101 | a | b | c |\n| ATR-310 | a | b | c |\n\nATR-4xx-dev prose");
    expect(parseCatalogCodes(md)).toEqual(new Set(["ATR-101", "ATR-310"]));
  });
  it("FS-DESIGN §15：斜杠对（ATR-340/341）展开；「既有」行裸三位数字组收编；§16 不混入", () => {
    const dir = tmpDir();
    const md = path.join(dir, "FS-DESIGN.md");
    write(
      md,
      `## 15. 错误码分配总表

| ATR-340/341 | 3xx 运行 | 鉴权未通过 / 权限不足 | §6.2 |
| 既有 | — | 310/311/312 端点、330 SQLite、301/305 模板、402 MCP | 不动 |

## 16. 前沿概念

ATR-999 here must not leak`,
    );
    expect(parseFsDesignSection(md)).toEqual(
      new Set(["ATR-340", "ATR-341", "ATR-310", "ATR-311", "ATR-312", "ATR-330", "ATR-301", "ATR-305", "ATR-402"]),
    );
  });
  it("SPEC §3.2：段界（3.3 止）截断", () => {
    const dir = tmpDir();
    const md = path.join(dir, "SPEC.md");
    write(md, "### 3.2 错误导航表\n\n| ATR-310 | 未知端点 | 用 hints |\n\n### 3.3 fix 可执行纪律\n\nATR-999 leak");
    expect(parseSpecSection(md)).toEqual(new Set(["ATR-310"]));
  });
});

describe("parseArchSection8（§8 CLI 表解析）", () => {
  it("动词 + 旗标提取；转义竖线还原；幻影旗标被看见", () => {
    const dir = tmpDir();
    const md = path.join(dir, "ARCHITECTURE.md");
    write(
      md,
      `## 8. CLI 命令总表

| 命令 | 用途 |
|---|---|
| \`atelier init --target <dir> [--no-ai]\` | 脚手架 |
| \`atelier snapshot save \\| check [--update]\` | 视觉回归 |
| \`atelier init --ai\` | 语义写反的旗标必须可检出 |
| \`atelier package [--electron]\` | 幻影旗标必须可检出 |

## 9. 安全基线
`,
    );
    const s8 = parseArchSection8(md);
    expect(s8.verbs).toEqual(new Set(["init", "snapshot", "package"]));
    expect(s8.flags.has("--no-ai")).toBe(true);
    expect(s8.flags.has("--update")).toBe(true);
    expect(s8.flags.has("--ai")).toBe(true);
    expect(s8.flags.has("--electron")).toBe(true);
  });
});

describe("仓库真值集成（R2 红检 → 转绿后恒绿）", () => {
  const ROOT = path.resolve(import.meta.dirname, "..");

  it("CHECK 1：代码实引 ATR 码 ⊆ 错误码总表（ERR_CATALOG = SSOT）", () => {
    const findings = runChecks(ROOT).filter((f) => f.id === "atr.codes" && f.level === "fail");
    expect(findings).toEqual([]);
  });
  it("CHECK 1b：三张表（总表 / FS-DESIGN §15 / SPEC §3.2）码集两两相等", () => {
    const findings = runChecks(ROOT).filter((f) => f.id === "atr.sync" && f.level === "fail");
    expect(findings).toEqual([]);
  });
  it("CHECK 2：ARCHITECTURE §8 动词 = dispatch 动词（help 豁免）；旗标 ⊆ HELP", () => {
    const findings = runChecks(ROOT).filter((f) => (f.id === "cli.table" || f.id === "cli.flag") && f.level === "fail");
    expect(findings).toEqual([]);
  });
  it("CHECK 3：桶出口哨兵 + check-skills 派生接线", () => {
    const findings = runChecks(ROOT).filter((f) => (f.id === "runtime.api" || f.id === "derive.wiring" || f.id === "atr.whitelist") && f.level === "fail");
    expect(findings).toEqual([]);
  });
});
