/**
 * build-guard.test.ts — P1-4（第三遍架构复校 §1）：`atelier build --out` 根目录关系守卫。
 *
 * 背景：build.mjs:69 的 outDir 解析无任何关系校验 + :105 显式 `--emptyOutDir`——`--out .`
 * → outDir == root → vite 清空应用目录本体；`--out src` / `--out ..` 同族（未提交的应用源码
 * 直接被删）。守卫先例 = backup.mjs 同径「连 --force 也拒」。修法：spawn vite 前校验
 * outDir 严格位于 root 内、≠ root、且不含 package.json/src——违者 die 2 四段式。
 *
 * 红检策略（避免真跑 vite）：三个负例（. / src / ..）die 2 且 stderr 命中守卫文案
 * （修复前命中的是「不是 Atelier 应用」premise 文案 → 红）；正例 `--out dist` 不受扰——
 * 空目录无 vite 可跑，走到既有 premise 检查即证明守卫未拦截合法 outDir（两态同绿防回归）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/build.mjs", import.meta.url));

const tmpDirs: string[] = [];
afterAll(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-build-guard-"));
  tmpDirs.push(d);
  return d;
}

/** cwd=root 跑 build（--out 相对路径按 cwd 解析——build.mjs path.resolve 语义，与真实调用一致） */
function runBuild(root: string, out: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root, "--target", "node", "--out", out], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("P1-4：build --out 根目录关系守卫（--emptyOutDir 不得清应用源码）", () => {
  it("红检：--out .（outDir == root）→ die 2 守卫文案，绝不放行到 vite", () => {
    const root = tmpRoot();
    const r = runBuild(root, ".");
    expect(r.status).toBe(2); // usage 级（守卫属参数校验，先于 premise 检查）
    expect(r.stderr).toContain("越出应用目录");
    expect(r.stderr).toContain("--emptyOutDir"); // 四段式细节：点名 vite 清空语义
    expect(r.stderr).toContain("fix:"); // fix 指路
    expect(r.stdout, "守卫必须在 vite build 之前拦下（stdout 零 build 进账）").not.toContain("[atelier build] ①");
  });

  it("红检：--out src（outDir 含应用 src/）→ die 2 覆盖要件文案", () => {
    const root = tmpRoot();
    const r = runBuild(root, "src");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("覆盖应用要件");
    expect(r.stderr).toContain("fix:");
  });

  it("红检：--out ..（outDir 越出 root）→ die 2 越界文案", () => {
    const root = tmpRoot();
    const r = runBuild(root, "..");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("越出应用目录");
    expect(r.stderr).toContain("fix:");
  });

  it("回归：--out dist（合法产物目录）不受守卫干扰——走到既有 premise 检查（缺 package.json 指路 init）", () => {
    const root = tmpRoot();
    const r = runBuild(root, "dist");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("不是 Atelier 应用"); // 守卫放行 → premise 检查接管（两态同绿）
    expect(r.stderr).not.toContain("越出应用目录");
    expect(r.stderr).not.toContain("覆盖应用要件");
  });
});
