import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 框架自身单测跑 tests/；benchmarks/m3/harness 是 M3 评分 harness（P0-3）：
    // 由 grade.mjs 带 env 驱动，无 env 时整体 describe.skip —— 常规 pnpm test 只会显示 skipped。
    // templates/ 仍是脚手架母版：模板内的 ../runtime 相对路径要等 init vendor 后才成立，排除。
    include: ["tests/**/*.test.ts", "benchmarks/m3/harness/**/*.spec.ts"],
  },
});
