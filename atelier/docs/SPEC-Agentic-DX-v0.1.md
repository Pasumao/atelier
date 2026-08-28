# Agentic DX 规范 v0.1（框架与 AI 编程代理的行为契约）

> 版本：v0.1（2025–2026 决策沉淀）｜ 状态：草案，随实现迭代
> 依据：`design-decisions.md` 决策 1-15（决策 14：框架命名 Atelier；决策 15：源码回滚双轨）。本文是**框架对人类不可见、对代理全可见**的约定层。

## 0. 总原则

1. **框架不内嵌 LLM**：一切"生成/理解"由外部代理完成；框架只提供原语、协议、执行器。
2. **显式约定 > 魔法**：禁隐式注入、隐式上下文、静默类型擦除、自动全局。
3. **类型即契约即测试**：TS 类型是唯一真相，编译期提取，一切校验从它来。
4. **错误即指令**：任何错误都必须让代理"能直接行动"，报错即带修复建议。
5. **可逆是自治前提**：代理运行的每一步都可被记录、回放、回滚。
6. **产物零依赖**：`dist/` 是全静态资源，运行时无任何第三方依赖。

## 1. 硬性约定（违反 = 构建/校验失败，不可绕过）

| # | 约定 | 实现 |
|---|---|---|
| H1 | 契约类型 = 纯数据 + 可判别结构；**禁止泛型/映射类型进契约** | 编译器 AST 提取；违反报 `ATR-1xx` |
| H2 | 判别式联合必须用 `literal` 判别（`status: "running" \| "done"`），**禁宽字符串联合** | 编译器校验 + lint |
| H3 | 样式值**只能引用 semantic token**（`bg-primary` 类或 `var(--color-primary)`）；**禁硬编码颜色/间距/字体值** | 契约校验（引用不存在 token = `ATR-204`，2xx 契约域，见 §3）+ lint |
| H4 | 组件内显式 `$state/$derived/$effect`；**禁隐式响应式、禁裸全局状态** | 编译器 + lint |
| H5 | 所有框架错误必须产出 `AtrError` 四段式对象（见 §3）；不得抛出裸字符串/裸对象 | 运行时包装 |
| H6 | 动态网络获取的 UI 数据（D 子集 schema）只能实例化注册表内白名单组件 | 白名单渲染器 |

## 2. 软约束（lint 警告级，写入 CI checklist）

`@atelier/eslint` 首版规则集（源码即库分发，代理可读可改）：

1. `no-hardcoded-style-value` — 禁硬编码样式值（配合 H3）
2. `no-manual-typewriter` — 禁手写 `setInterval/轮询` 拼流式文本，强制 `streamValue`
3. `component-file-max-lines` — 组件文件 > 400 行警告
4. `contract-no-generics` — 契约类型禁泛型（配合 H1）
5. `component-naming` — 组件 TitleCase、文件名与组件同名
6. `no-implicit-global` — `window/document` 必须经 `atelier.env` 显式访问

## 3. 错误规范（AtrError 四段式）

```ts
type AtrError = {
  code: string;      // "ATR-1xx 编译 / 2xx 契约校验 / 3xx 运行时 / 4xx MCP"
  message: string;   // 一句话：什么坏了
  context: {         // 定位：file/line/component/property + 资源上下文
    file?: string; line?: number; component?: string; property?: string;
    hints?: string[];  // 相关可用值/候选清单
  };
  fix: string;       // 必须给出的可执行修复建议（含示例代码/可用值清单）
};
```

- 双通道输出：控制台人类可读行 + `ATR_DEBUG=json` / MCP 直连时的 JSON 结构化负载。
- `fix` 缺失视为违反 H5（自测把关）。
- 每个 `code` 对应一份 SKILL.md 页面（`docs/skills/errors/ATR-204.md`：含义/示例/修法），代理见 code 可检索。

## 4. 命名规范（默认约定，lint 提示）

| 主体 | 规范 |
|---|---|
| 组件文件 | `PascalCase`，文件名 = 组件名：`ChatMessage.atr.ts` |
| 目录 | `kebab-case` 短路径（`src/ui/`、`src/features/`），组件与测试/样式同名同目录 co-located |
| 状态 | `$state` 变量 `camelCase`；store 名 `camelCase` |
| token | `语义段`（`color.primary`、`space.md`、`radius.sm`） |
| lint 类名 | `bem-ish`：`block`、`block--modifier`、`block__element`（不强制但建议） |

## 5. 完成定义（DoD，代理自证的裁判标准）

一个组件/一个任务的"done" = 全部满足：

1. `atelier check` 通过（类型严格检查 + 契约提取 + token 校验，零错误）
2. `atelier lint` 零错误零警告
3. `atelier test` 全绿（含新增断言：行为/交互）
4. `atelier snapshot` 截图 diff 已审阅（diff 非自动 accept；有变更则给出变更说明）
5. 影响面自查：未触碰 `atelier.config.json` 中 `locked` 组件（若有）；未引入新依赖（必要时说明）
6. 提交时附 diff 报告，供人类 `atelier review` 批准/点踩

## 6. 代理推荐工作循环（写进 SKILL.md 顶层）

```
读 specs/ → MCP 查询（组件注册表/token/状态快照）→ 改 .atr.ts
→ atelier dev 观察编译错误与 HMR → atelier test + atelier snapshot 自证
→ 生成 diff 报告 → 等待人类批准/点踩（反馈写回 specs/ 下次必读）
```

> 触发"停下等人类"的阈值：视觉 diff 异常、测试失败连续 3 次无进展、触碰 locked/配置/依赖变更、预算或漂移监测命中。

## 7. 性能与正确性基线（v0.1 发布闸门）

> 指标随原型基准（prototype/）持续测量；未达标项作为发布闸门，不得默认豁免。

| 指标 | v0.1 目标 |
|---|---|
| 核心运行时体积 | gzip ≤ 30 KB（不含编译器） |
| 渲染性能 | 10³ 节点组件挂载+首次渲染 ≤ 50 ms（桌面基线） |
| 开发反馈 | HMR ≤ 100 ms；编译错误报告 ≤ 1 s（含四段式 fix） |
| 截图回环 | dev 单组件截图 diff ≤ 500 ms |
| agent 正确性 | 内部基准首遍正确率 ≥ 60%（可推导性测量，Phase 1 上线 harness 后即写即测） |
