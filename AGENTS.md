# Atelier 工作区说明

> 本文档由 dsh-plugin-agents-gen 生成，可手动编辑。

## 项目概述

Atelier 工作区围绕"为 AI 编程代理设计的新前端框架"调研展开。规划分多轮深入，主报告位于工作区根目录，单路调研原始素材集中存放于 `research/`（编号 `01`~`08`）。

## 目录结构

| 目录 / 文件 | 说明 |
|---|---|
| `AI前端框架调研报告.md` | 第一轮主报告：宏观定位、生态扫描、技术选型矩阵、七支柱、路线图。 |
| `AI前端框架调研报告02-AI友好特性结构与工具生态.md` | 第二轮主报告：对 AI 最友好的特性结构、MCP/Skills 工具生态、实证与失败模式、人在环外的验收回路、融合架构。 |
| `design-decisions.md` | 框架设计决策记录：0-15 号决策逐条留档（含取舍与理由），顶部有已决全景速查表。当前框架规格以此为准。 |
| `docs/SPEC-Agentic-DX-v0.1.md` | Agentic DX 规范 v0.1：框架与 AI 代理的行为契约（硬约定 H1-H6/软约束 lint 集/AtrError 规范/DoD 六条/代理工作循环）。 |
| `docs/ARCHITECTURE.md` | 架构文档 v0.1：五层架构、monorepo 包结构、编译流水线、MCP 工具清单（三面+优先级）、atelier.config.json、CLI 命令表、安全基线、打包链路。 |
| `docs/SKILL_DRAFT.md` | SKILL.md 根草案：组件速查/原语/错误读法/DoD/禁用清单/分包规划（渐进披露）。 |
| `docs/SKILLS-PLAN.md` | Agent Skills 包计划书：范围/设计原则（8 条带依据）/内容规格/验收口径/里程碑；拍板结果已标记。 |
| `atelier/` | Atelier 工具链作者副本：`skills/` 多工具兼容技能包（8 个 kebab-case 目录包）、`mcp/server.mjs` 零依赖 stdio MCP Server（19 工具单源生成）、`scripts/checkpoint.mjs` 决策 15 源码双轨、`cli.mjs` 统一入口（skills/mcp/checkpoint 子命令）；README.md 有兼容矩阵/MCP 接入/checkpoint 说明。M1+M2+M2.5 已交付。 |
| `prototype/` | Phase 0 最小可运行原型（Vite dev）：信号内核/模板解释器/事务层/契约校验/注册表查询面/dev 状态桥（`src/bridge.ts` → MCP `state.snapshot`）；`prototype/components/` 为演示组件（DeepSeek 介绍页）。 |
| `research/` | 单路调研原始素材（含全部来源 URL 与未确认项标注）：`01`~`04` 为第一轮四路，`05`~`08` 为第二轮四路。 |

## 常用命令

<!-- 技能包与原型工作流 -->

| 场景 | 命令 |
|---|---|
| 启动原型 dev server | 在 `prototype/` 下 `pnpm dev`（http://127.0.0.1:5173，strictPort） |
| 技能包一致性校验 | `node atelier/scripts/check-skills.mjs`（exit code 可接 CI；改动 skills/mcp-definitions 后必跑） |
| 一键安装技能到项目 | `node atelier/scripts/init-ai.mjs --target <dir> --name <Name>`（双落点 + 模板渲染 + specs 骨架，幂等） |
| 读中文 UTF-8 文件 | PowerShell 一律 `Get-Content -Encoding UTF8`（默认 ANSI 会把 em dash 显示成乱码，文件未必真坏） |
| 源码 checkpoint（决策 15） | `node atelier/cli.mjs checkpoint save "<名称>"` / `list` / `rollback <id>`（首次 save 自动 git init；改代码前先看时间线） |

## 维护纪律

- 主报告面向决策，细节与证据（含来源 URL、未确认项）一律落 `research/` 原始素材；新增调研轮次按 `NN-主题-findings.md` 编号递增。
- 所有"未确认"结论必须明确标注，不得写成事实。
