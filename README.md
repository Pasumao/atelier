# Atelier — 为 AI 编程代理设计的前端框架

> 本工作区即 Atelier 框架仓库（script-form v0.2）。框架规格见 `atelier/docs/`；
> 缺口与改进队列见 `atelier/docs/BACKLOG.md`；常用命令见 `AGENTS.md`。

## 性能基线（SPEC §7 — `atelier bench` 实测）

| 指标 | v0.1 目标 | 实测（2026-08-28，Windows / Node 24 / 桌面基线） | 判定 |
|---|---|---|---|
| 核心运行时体积 | gzip ≤ 30 KB | **5.85 KB**（vite build+minify，gzip -9，不含编译器） | PASS |
| 渲染性能 | 10³ 节点挂载+首渲染 ≤ 50 ms | **3.3 ms**（1254 节点，7 样本中位） | PASS |
| 开发反馈（HMR） | 保存→可见 ≤ 100 ms | **114 ms**（整页 reload 路径：starter 组件未接 HMR accept） | FAIL → P0 工单 |
| 截图回环 | dev 单组件截图 diff ≤ 500 ms | **1937 ms**（每拍拉起瞬态无头实例） | FAIL → P0 工单 |

复现：`node atelier/cli.mjs init --target /tmp/app --name App && cd /tmp/app && pnpm install`
然后 `node atelier/cli.mjs bench --app /tmp/app`。明细 JSON 落 `<app>/.atelier/bench.json`。

诚实性：FAIL 项不粉饰、不豁免，按 SPEC §7 自动转为 P0 修复工单（见 BACKLOG 进度面板）。
