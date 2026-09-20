import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * 测试基建（FS-M2(m2d)）：gen auth 产物按 init vendor 布局以相对路径 import
 * src/vendor/atelier/server/*（显式 import 闭合纪律，FS-DESIGN §6.1/§7.2）。单测 fixture 在
 * 系统临时目录里没有实体 vendor 文件——resolve 钩子把该布局的 specifier 映射回框架本源，
 * 产物代码即按真实 vendored 形态被加载执行（import 闭合被真实检验，而非只查文本）。
 * 仅命中 vendor 布局后缀的 specifier；其余（tests/*.test.ts 的 ../server/... 相对导入）不受影响。
 */
const VENDOR_MAP: Record<string, string> = {
  "vendor/atelier/server/index.ts": fileURLToPath(new URL("./server/index.ts", import.meta.url)),
  "vendor/atelier/server/endpoints.ts": fileURLToPath(new URL("./server/endpoints.ts", import.meta.url)),
  "vendor/atelier/server/db.ts": fileURLToPath(new URL("./server/db.ts", import.meta.url)),
  "vendor/atelier/server/sqlite.ts": fileURLToPath(new URL("./server/sqlite.ts", import.meta.url)),
  "vendor/atelier/server/migrate.ts": fileURLToPath(new URL("./server/migrate.ts", import.meta.url)),
  "vendor/atelier/server/seed.ts": fileURLToPath(new URL("./server/seed.ts", import.meta.url)),
};

export default defineConfig({
  plugins: [
    {
      name: "atelier-test-vendor-shim",
      enforce: "pre",
      resolveId(id) {
        const hit = Object.keys(VENDOR_MAP).find((suffix) => id.endsWith(suffix));
        return hit ? VENDOR_MAP[hit] : null;
      },
    },
  ],
  test: {
    // 框架自身单测跑 tests/；benchmarks/m3/harness 是 M3 评分 harness（P0-3），
    // benchmarks/m3-fs/harness 是 M3-FS 全栈评分 harness（FS-10 执行半）：
    // 两者均由各自 grade.mjs 带 env 驱动，无 env 时整体 describe.skip —— 常规 pnpm test 只会显示 skipped。
    // templates/ 仍是脚手架母版：模板内的 ../runtime 相对路径要等 init vendor 后才成立，排除。
    include: ["tests/**/*.test.ts", "benchmarks/m3/harness/**/*.spec.ts", "benchmarks/m3-fs/harness/**/*.spec.ts"],
  },
});
