# Project Constitution — 不可变约定

> Spec Kit 同款概念：所有 `specs/` 规格与 agent 变更必须遵从本文件。修改本文件 = 人类决定
> （agent 可以提案，但必须显式征得批准后才动笔）。条款源头：Atelier 硬性约定 H1-H6
> （框架文档 SPEC-Agentic-DX §1）+ 本项目级补充。

## 硬性约定（违反 = 构建/校验失败，不可绕过）

| # | 约定 |
|---|---|
| H1 | 契约类型 = 纯数据 + 可判别结构；禁止泛型/映射类型进契约 |
| H2 | 判别式联合必须用 `literal` 判别（`status: "running" \| "done"`）；禁宽字符串联合 |
| H3 | 样式值只能引用 semantic token（工具类或 `var(--token)`）；禁硬编码颜色/间距/字号 |
| H4 | 组件内显式 `$state/$derived/$effect`；禁隐式响应式、禁裸全局状态 |
| H5 | 框架错误一律 AtrError 四段式（code/message/context/fix）；不抛裸字符串 |
| H6 | 动态获取的 UI 数据只能实例化注册表内白名单组件 |

## 项目级补充（Atelier 默认宪法——可按项目收紧，不可放松）

- **token 单源**：样式值只进 `atelier.config.json`；recipe 层与 scoped 同责（decision 16 守卫 R1-R5）。
- **事务纪律**：`$state` 写入整体替换引用（`state-discipline` 守卫拦截原地修改）；
  破坏性操作走 `agent.confirm` 三档（decision 15，deny = ATR-402）。
- **快照纪律**：snapshot 基线变更 = 变更报告，绝不自动晋升；`--update` 仅在人工复核后。
- **规格 = 可执行测试**：每条 EARS 验收语句落点为 `.atr.spec.ts` 命名用例；
  没有用例承接的验收语句不算完成。
- **开工阅读序**：constitution.md → specs/guardrails.md → 对应 spec → 代码。

## 变更规则

1. 违反本文件的 spec 提案直接拒绝（在 feedback 中注明条款号）。
2. 修宪 = 单独一份 spec + 人类批准 + 快照复核（`atelier snapshot check` MATCH 后方可锚定）。
3. 本文件由人维护；agent 的提案走 `specs/feedback` 通道，不直接改写。
