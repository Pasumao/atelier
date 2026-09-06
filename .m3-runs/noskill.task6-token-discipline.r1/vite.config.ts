import { defineConfig } from "vite";
import { atelierDevPlugin } from "./scripts/atelier-dev-plugin.mjs";
import { generateThemeFile } from "./scripts/gen-tailwind-theme.mjs";

// 决策 16：token 单源 → @theme 派生（dev/build 前重生成 src/tailwind.input.css 并 AOT 编译出
// src/atelier-tailwind.css；两份均为生成产物，勿手改）。
generateThemeFile();

export default defineConfig({
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
});
