/**
 * release-form.test.ts — 发布形态钉（m12 批建立，决策 28；1.1.0 版本批随版翻转）。
 * 背景：m12 = 1.0 发布工程批——版本正式化（0.2.0 → 1.0.0）+ CHANGELOG 建立 + 发布工件；
 *       1.1.0 版本批（2026-09-29）——1.0 后四批（评审批/差距批/第三批/MCP 扩张批）版本化工件。
 * 本文件钉三件事（每版先红后绿：版本与 CHANGELOG 两断言在版本号翻转前实证为红——
 *   m12 红检 ea4d013 先例，1.1.0 同款）：
 *   ① 框架版本 === "1.1.0"（防意外降级——版本回退 = 发布形态破坏，属 api-diff 门禁
 *      无法覆盖的 package.json 字段面，此处机检兜底）；
 *   ② 仓库根 CHANGELOG.md 存在且含 1.1.0 条目（Keep a Changelog 惯例落点 = 仓库根，
 *      与 README 同层；语义化版本口径见决策 28）；
 *   ③ package.json "private": true 保持（本环境不真发布 npm——release-ready 口径，
 *      npm publish 是发布日外部动作，见 atelier/docs/RELEASE-CHECKLIST.md；若未来
 *      立包分发，应连同本断言一起有意识地改，而不是静默丢字段）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8")) as {
  version: string;
  private: boolean;
  name: string;
};

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("发布形态钉（决策 28）", () => {
  it("框架版本正式化为 1.1.0（防意外降级）", () => {
    expect(pkg.version).toBe("1.1.0");
  });

  it("仓库根 CHANGELOG.md 存在且含 1.1.0 条目（Keep a Changelog）", () => {
    const changelog = readFileSync(`${repoRoot}CHANGELOG.md`, "utf-8");
    expect(changelog).toContain("## [1.1.0]");
    expect(changelog).toContain("2026-09-29");
  });

  it("package.json 保持 private: true（npm publish = 发布日外部动作，非仓库形态）", () => {
    expect(pkg.private).toBe(true);
  });
});
