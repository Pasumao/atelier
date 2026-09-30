/**
 * source-fingerprint-parity.test.ts — R3 结构债批（B 件）：sourceFingerprint 单点化对拍钉
 * （评审 §4.8「checkpoint.mjs:186-205 sourceFingerprint 与 snapshot.mjs:93-112 逐行同构
 * （checkpoint.mjs:41 已 import snapshot.mjs，顺手 import 即可消灭）」/ §6 R3「scripts/lib
 * 共享库……sourceFingerprint 单点化」）。
 *
 * 对拍钉先行（本件纪律载体：删重复前先落「两份实现同构」的对拍测试，删重复后仍绿）：
 *   · 行为对拍（实现前后恒绿）：snapshot.mjs 导出的 sourceFingerprint(root) 与 checkpoint.mjs
 *     快照门快路径消费的指纹值必须逐位一致——同指纹 + 新鲜 MATCH receipt → 快路径放行
 *     （"fresh MATCH receipt"）；源一变 → 快路径必须失效（落 vacuous 阶梯）。任何一侧单独
 *     漂移（历史事故形态：「钉住的是各自的错误行为」）都会在本钉上现红。
 *   · 单源机检（静态，删重复前为红）：checkpoint.mjs 从 ./snapshot.mjs import sourceFingerprint，
 *     内联副本（const sourceFingerprint =）不复存在。
 * vendor 闭包边界：checkpoint.mjs / snapshot.mjs 均为 spawn 型，不在 mcp-vendor 闭包
 * （tests/mcp-vendor.test.ts 名单核对结论），相对 import 边不破闭包测试。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baselinePathFor, sourceFingerprint } from "../scripts/snapshot.mjs";

const CHECKPOINT_SCRIPT = fileURLToPath(new URL("../scripts/checkpoint.mjs", import.meta.url));
const SNAPSHOT_SCRIPT = fileURLToPath(new URL("../scripts/snapshot.mjs", import.meta.url));
const sha256File = (p: string): string => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

describe("R3-B 件③：sourceFingerprint 单点化（对拍钉 + 单源机检）", () => {
  it("行为对拍：checkpoint 快路径消费的指纹 ≡ snapshot.mjs sourceFingerprint（同值放行 / 源变失效）", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-fp-parity-"));
    try {
      expect(spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" }).status).toBe(0);
      fs.writeFileSync(path.join(repo, ".gitignore"), ".atelier/\n");
      // 渲染相关源（指纹对象域：src/**.{atr.ts,atr.md,css,json} + src/main.ts + config + index.html）
      fs.mkdirSync(path.join(repo, "src"), { recursive: true });
      fs.writeFileSync(path.join(repo, "src", "Card.atr.ts"), "export const Card = 1;\n");
      fs.writeFileSync(path.join(repo, "src", "main.ts"), "import { mount } from './app.js';\n");
      fs.writeFileSync(path.join(repo, "atelier.config.json"), "{}");
      fs.writeFileSync(path.join(repo, "index.html"), "<html></html>");
      // 快路径前置：基线在位（gate 的 receipt 快路径只在基线存在时生效）
      fs.mkdirSync(path.dirname(baselinePathFor(repo)), { recursive: true });
      fs.writeFileSync(baselinePathFor(repo), "baseline-bytes");
      const baseSha = sha256File(baselinePathFor(repo));

      const fp = sourceFingerprint(repo);
      expect(fp).toMatch(/^[0-9a-f]{16}$/);
      const receiptPath = path.join(repo, ".atelier", "snapshot-lastcheck.json");
      fs.mkdirSync(path.dirname(receiptPath), { recursive: true });

      const runCheckpoint = (name: string): { status: number; stdout: string } => {
        const r = spawnSync(process.execPath, [CHECKPOINT_SCRIPT, "save", name, "--json"], {
          cwd: repo,
          encoding: "utf8",
          // dev 面钉死不可达（:9 discard）→ 快路径被排除时确定落「vacuous」阶梯而非真捕获
          env: { ...process.env, ATELIER_DEV_URL: "http://127.0.0.1:9" },
        });
        return { status: r.status ?? 1, stdout: r.stdout ?? "" };
      };

      // 前半：快路径 receipt 的 sourceFp = snapshot.mjs 指纹 → checkpoint 门必须认（同值放行）
      fs.writeFileSync(receiptPath, JSON.stringify({ result: "MATCH", baselineSha: baseSha, sourceFp: fp, at: new Date().toISOString() }));
      const r1 = runCheckpoint("fp-parity-same");
      expect(r1.status).toBe(0);
      expect(r1.stdout, "checkpoint 门的指纹与 snapshot.mjs 同值（对拍一致）→ 快路径放行").toContain("fresh MATCH receipt");

      // 后半：源一变（agent 编辑环：edit → checkpoint）→ 同一 receipt 必须失效（陈旧指纹绝不放行）
      fs.appendFileSync(path.join(repo, "src", "Card.atr.ts"), "\nexport const Card2 = 2;\n");
      const r2 = runCheckpoint("fp-parity-drift");
      expect(r2.status).toBe(0);
      expect(r2.stdout, "源变后陈旧 receipt 绝不误食（快路径失效）").not.toContain("fresh MATCH receipt");
      expect(r2.stdout, "落常规比对阶梯（dev 不可达 → vacuous 诚实打印，锚定照常）").toContain("snapshot gate vacuous");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("单源机检（静态）：checkpoint.mjs 消费 snapshot.mjs 的 sourceFingerprint 导出，内联副本已删", () => {
    const ck = fs.readFileSync(CHECKPOINT_SCRIPT, "utf8");
    expect(ck, 'checkpoint.mjs 从 ./snapshot.mjs import sourceFingerprint（单源）').toMatch(
      /import\s*\{[^}]*\bsourceFingerprint\b[^}]*\}\s*from\s*"\.\/snapshot\.mjs"/,
    );
    expect(ck, "checkpoint.mjs 不再有内联 sourceFingerprint 副本（复制已消灭）").not.toMatch(/const sourceFingerprint\s*=/);
    // 被消费的导出在 snapshot.mjs 仍在（对拍与消费共用同一实现）
    const snap = fs.readFileSync(SNAPSHOT_SCRIPT, "utf8");
    expect(snap).toContain("export function sourceFingerprint");
  });
});
