/**
 * tokens-dtcg.test.ts — P2-2④ W3C DTCG 设计令牌互导验收：roundtrip 值不丢 + 类型推断。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportDtcg, importDtcg, inferType } from "../scripts/tokens-dtcg.mjs";

const config = {
  tokens: {
    color: { primary: "#4D6BFE", danger: "#E5484D" },
    space: { xs: "4px", md: "16px" },
    font: { sm: "0.85rem" },
  },
};

describe("DTCG interop (P2-2④ — W3C design tokens)", () => {
  it("export：组嵌套 + $type 推断（color/dimension）+ $value 原样", () => {
    const d = exportDtcg(config);
    expect(d.color.primary).toEqual({ $type: "color", $value: "#4D6BFE" });
    expect(d.space.xs).toEqual({ $type: "dimension", $value: "4px" });
    expect(d.font.sm).toEqual({ $type: "dimension", $value: "0.85rem" });
  });

  it("import：剥离 $type/$value 还原扁平组（roundtrip 值全等）", () => {
    const flat = importDtcg(exportDtcg(config));
    expect(flat).toEqual(config.tokens);
  });

  it("宽容导入：扁平叶子与未知形态不炸", () => {
    const flat = importDtcg({ color: { bg: "#111", odd: { foo: 1 } } });
    expect(flat.color.bg).toBe("#111");
    expect(flat.color.odd).toBeUndefined();
  });

  it("inferType：数字/其他", () => {
    expect(inferType("12")).toBe("number");
    expect(inferType("1.5rem")).toBe("dimension");
    expect(inferType("rgb(1,2,3)")).toBe("color");
    expect(inferType("600")).toBe("number");
    expect(inferType("sans-serif")).toBe("other");
  });
});

/* ---------------- P2-C5：--out 同径守卫（第三遍架构复校 §2.3） ----------------
 * 背景：tokens-dtcg.mjs:75-79 无同径校验——`--in atelier.config.json --out atelier.config.json`
 * 一次性覆写手工 token SSOT，且「审阅后合并」提示打印在覆盖之后（覆灭已完成）。守卫先例 =
 * backup.mjs samePath「连 --force 也拒」。修法：samePath(in,out) die 2；out 落点为
 * atelier.config.json 时（即便 in ≠ out）写盘前额外显式告警。 */
describe("P2-C5：tokens --out 同径守卫（token SSOT 防线）", () => {
  const SCRIPT = fileURLToPath(new URL("../scripts/tokens-dtcg.mjs", import.meta.url));
  const tmpDirs: string[] = [];
  afterAll(() => {
    while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  function makeConfigDir(): { dir: string; configPath: string; bytes: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-tokens-dtcg-"));
    tmpDirs.push(dir);
    const configPath = path.join(dir, "atelier.config.json");
    const bytes = JSON.stringify({ tokens: { color: { primary: "#4D6BFE" } } }, null, 2) + "\n";
    fs.writeFileSync(configPath, bytes, "utf8");
    return { dir, configPath, bytes };
  }

  it("红检：--in 与 --out 同路径 → die 2，源文件字节不动", () => {
    const { dir, configPath, bytes } = makeConfigDir();
    const r = spawnSync(process.execPath, [SCRIPT, "export", "--in", "atelier.config.json", "--out", "atelier.config.json"], {
      cwd: dir, encoding: "utf8", windowsHide: true,
    });
    expect(r.status).toBe(2); // 修复前：exit 0，SSOT 已被 DTCG 形态覆写
    expect(r.stderr).toContain("同一路径");
    expect(r.stderr).toContain("fix:");
    expect(fs.readFileSync(configPath, "utf8")).toBe(bytes); // 源文件字节不动（修前已被覆写）
  });

  it("红检：不同拼写同实路径（绝对 vs 相对）→ 同守卫 die 2", () => {
    const { dir, configPath, bytes } = makeConfigDir();
    const r = spawnSync(process.execPath, [SCRIPT, "export", "--in", configPath, "--out", "atelier.config.json"], {
      cwd: dir, encoding: "utf8", windowsHide: true,
    });
    expect(r.status).toBe(2);
    expect(fs.readFileSync(configPath, "utf8")).toBe(bytes);
  });

  it("红检：--out 落点为 atelier.config.json（in ≠ out）→ 写盘前显式告警", () => {
    const { dir, configPath, bytes } = makeConfigDir();
    const other = path.join(dir, "other.json");
    fs.writeFileSync(other, JSON.stringify({ tokens: { color: { danger: "#E5484D" } } }), "utf8");
    const r = spawnSync(process.execPath, [SCRIPT, "export", "--in", "other.json", "--out", "atelier.config.json"], {
      cwd: dir, encoding: "utf8", windowsHide: true,
    });
    expect(r.status).toBe(0); // 允许执行（显式动作），但必须告警在写盘之前
    expect(r.stderr).toContain("warn:");
    expect(r.stderr).toContain("atelier.config.json");
    expect(fs.readFileSync(configPath, "utf8")).not.toBe(bytes); // 行为本命令语义：确实写出
  });
});
