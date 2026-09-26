import { defineConfig } from "vite";
import { atelierDevPlugin } from "./scripts/atelier-dev-plugin.mjs";
import { generateThemeFile } from "./scripts/gen-tailwind-theme.mjs";

// 决策 16：token 单源 → @theme 派生（dev/build 前重生成 src/tailwind.input.css 并 AOT 编译出
// src/atelier-tailwind.css；两份均为生成产物，勿手改）。
generateThemeFile();

// 决策 27 F-2 prod 剥离：define 注入 = 浏览器面 DCE 通道。command === "build" 时把裸标识符
// __ATELIER_BUILD_PROD__ 折叠为 true → runtime 侧调用点 `BUILD_PROD || dynProd()`（bare 标识符 +
// typeof 守卫在 runtime/template.ts，决策 27 口径）常量化 → dev 专属分支（错误卡渲染/契约与 token
// 校验）被 minify DCE 出 bundle。dev serve 不注（define=undefined）——dev 行为零变化：无 define
// 环境走 `false || dynProd()` = 既有 globalThis.__ATELIER_PROD__ 动态读，置旗测试零改动。
export default defineConfig(({ command }) => ({
  base: "./", // 决策 0：静态相对路径（file:// / 桌面壳兼容）
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/.debug*", "**/*.tmpdir", "**/*.tmp", "**/.edge-debug"],
    },
  },
  resolve: {
    extensions: [".atr.ts", ".ts", ".mts", ".js", ".mjs", ".json"],
  },
  plugins: [atelierDevPlugin()],
  define: command === "build" ? { __ATELIER_BUILD_PROD__: "true" } : undefined,
}));
