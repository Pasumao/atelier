---
name: atelier
description: Atelier 前端框架（为 AI 编程代理全权操作设计）。写组件、流式 UI、状态事务、样式 token、验收测试、打包 exe 时使用。
---

# Atelier 快速上手（SKILL.md 根，v0.1 草案）

> **⚠️ 已取代**：本文件为 SKILL.md 根草案的历史基线，现由 `atelier/skills/SKILL.md`（作者副本，见 `docs/SKILLS-PLAN.md`）取代——实施新技能包时以此为准，必要时同步回本文件。
> 检索优先：本文件只含最小速查；细节按需加载 `skills/` 分包（见末尾）。
> 必读：`specs/`（人类意图与验收，唯一权威）→ 本技能 → `llms.txt`（框架 API 全列表）。

## 组件模板速查（`.atr.ts`）

```ts
// ChatMessage.atr.ts —— 契约类型即 props
export type ToolCall = { name: string; status: "running" | "done" };

export const ChatMessage = component<{
  text: string;
  status: "thinking" | "streaming" | "done";
  tools: ToolCall[];
}>((props) => {
  const streamed = streamValue<string>();      // 流式 value（三态模型）
  const cards = optimisticList<ToolCall>();    // 乐观更新+自动回滚

  return /* html */ `
    {#if props.status === "thinking"}
      <div class="spinner">思考中…</div>
    {:else}
      <p class="text">{props.text}</p>
    {/if}
    {#each cards.values as tool}
      <div class="tool-card tool-card--{tool.status}">{tool.name}</div>
    {/each}
    <style scoped>
      .tool-card { color: var(--color-primary); margin: var(--space-md); }
    </style>
  `;
});
```

- 状态：`$state` / `$derived` / `$effect`（显式；编译器生成静态依赖图）
- 样式：只允许 `var(--token)` 或生成的 utility 类（`bg-primary`/`space-md`）——引用不存在 token 直接报错
- 契约纪律：纯数据 + literal 判别；禁泛型进契约

## 状态与可逆（事务层）

```ts
store.commit("user_rename", "Alice");  // 命名合并 checkpoint（AI 一轮 = 一次操作）
store.rollback();                      // 回退到上一命名 checkpoint
store.timeTravel(id);                  // 任意点回放
```

## 错误读法（AtrError 四段式）

`{code, message, context, fix}` —— **只看 `fix` 并执行**；`ATR-1xx` 编译 / `2xx` 契约校验 / `3xx` 运行时 / `4xx` MCP。举例：`ATR-204` = 引用了不存在的 token，`fix` 会列出可用值。

## 验收自证（DoD 六条）

1. `atelier check` 零错误 → 2. `atelier lint` 零违规 → 3. `atelier test` 全绿 →
4. `atelier snapshot` 的 diff 已审阅（`snapshot.review_diff` 查看，不得自动 accept）→
5. 自查未触 `locked`/未加新依赖 → 6. 附 `diff.report` 产出，等待人类批准/点踩。

## 禁用清单（会触发硬错误/lint）

- 硬编码样式值（色值/间距/字号）
- 手写 `setInterval`/轮询拼流式文本（用 `streamValue`）
- 契约类型用泛型 / 非 literal 宽联合
- `window/document` 直接用（改用 `atelier.env`）
- 隐式全局状态（用 `$state`/store）

## 分包（渐进披露，按需加载）

| 文件 | 何时加载 |
|---|---|
| `skills/component-model.md` | 写/改组件时 |
| `skills/streaming.md` | 涉及流式输出/工具调用卡片时 |
| `skills/state-transactions.md` | 涉及状态/回滚/时间旅行时 |
| `skills/styling.md` | 涉及样式/设计 token/布局时 |
| `skills/errors/codes.md` | 编译报错时（含各 code 修法） |
| `skills/testing.md` | 跑 atelier test / snapshot / e2e 时 |

> 每完成一个任务：更新/确认 `specs/` 与产物一致；把关键改动写入 diff 报告；**碰了配置或依赖必须主动说明并等人类确认**。
