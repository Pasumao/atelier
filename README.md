# Atelier — 为 AI 编程代理设计的前端框架

> 本工作区即 Atelier 框架仓库（script-form v0.2）。框架规格见 `atelier/docs/`；
> 缺口与改进队列见 `atelier/docs/BACKLOG.md`；常用命令见 `AGENTS.md`。

## 性能基线（SPEC §7 — `atelier bench` 实测）

| 指标 | v0.1 目标 | 实测（2026-08-29，Windows / Node 24 / 桌面基线） | 判定 |
|---|---|---|---|
| 核心运行时体积 | gzip ≤ 30 KB | **6.25 KB**（vite build+minify，gzip -9，runtime + 示例组件，不含编译器） | PASS |
| 渲染性能 | 10³ 节点挂载+首渲染 ≤ 50 ms | **2–2.9 ms**（1254 节点，7 样本中位） | PASS |
| 开发反馈（HMR） | 保存→可见 ≤ 100 ms | **46–61 ms**（.atr.ts accept 路径：保值热交换重挂载，$state 不清零） | PASS |
| 截图回环 | dev 单组件截图 diff ≤ 500 ms | **298–304 ms**（P0-6 常驻无头实例：同 tab 复用 + 崩溃自愈；修复前 1933 ms） | PASS |

复现：`node atelier/cli.mjs init --target /tmp/app --name App && cd /tmp/app && pnpm install`
然后 `node atelier/cli.mjs bench --app /tmp/app`。明细 JSON 落 `<app>/.atelier/bench.json`。

诚实性：FAIL 项不粉饰、不豁免，按 SPEC §7 自动转为 P0 修复工单（见 BACKLOG 进度面板）。
HMR 一行曾为 108-114ms FAIL（整页 reload 清零 $state），P0-5 保值热交换落地后转 PASS；
截图回环曾为 1933ms FAIL（每拍拉起瞬态无头实例），P0-6 常驻实例（同 tab 复用 + 崩溃自愈）落地后
转 PASS——数字会随修复移动，这正是基线台存在的意义。
