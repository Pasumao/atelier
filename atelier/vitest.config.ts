import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 框架自身单测只跑 tests/。templates/ 是脚手架母版：模板内的 ../runtime 相对路径
    // 要等 init 把 runtime vendor 进应用后才成立，在框架目录内不可解析，必须排除。
    include: ["tests/**/*.test.ts"],
  },
});
