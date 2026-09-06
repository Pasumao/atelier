# P3-5 · D 子集适配面预研（报告，不立项）

> 路线图 P3-5：D 子集适配面预研，只出报告不立项〔议，见 ROADMAP §5 D-4〕。
> 本文回应 D-4：MCP Apps / A2UI 两个 "agent 当 runtime" UI 标准，与 Atelier D 子集（决策 1/6/12）
> 的映射可行性。调研时点：2026-09-06。凡未验证的推断一律标〔推断〕。

## 0. 我方坐标（D 子集现状）

- **规范定位**（design-decisions 决策 1/6/12、ARCHITECTURE §4/§5、SPEC H6）：
  - D 子集 = 数据驱动 schema 渲染组件（表单/数据展示类），不另设独立 JSON 语言；
  - schema 形态 = 契约层扁平 JSON Schema 单源：`{type:"object", reqProps, optProps}`，
    叶子字段 `FlatField = {type: string|number|boolean|array, items?, enum?, min?, max?, pattern?}`，
    **无 `$ref`/`oneOf`、无嵌套 object 定义、数组 items 仅限标量**（`runtime/contract.ts`）；
  - 安全面：远程 schema 只能实例化注册表白名单组件 + 合法 token（决策 12 / ARCHITECTURE whitelist renderer）；
  - 实装状态：契约校验器 + MCP inputSchema 转换（`mcp/server.mjs` 扁平→标准 JSON Schema）已落地；
    **D 子集白名单渲染器本身尚未实现**（属 ARCHITECTURE 规划件）。
- 与本研究的关系：Atelier 主轴是 "agent 当开发者"（代理写代码）；MCP Apps / A2UI 是
  "agent 当 runtime"（代理在对话时直接驱动 UI）。ROADMAP D-4 已判二者正交，本文验证该判断并留适配切口清单。

## 1. MCP Apps（MCP 官方 UI 扩展，SEP-1865）

- **是什么**：MCP 首个官方 extension（标识 `io.modelcontextprotocol/ui`，spec 版本 `2026-01-26`）。
  工具通过 `_meta.ui.resourceUri` 关联一个预声明的 `ui://` HTML 资源（MIME
  `text/html;profile=mcp-app`），宿主在沙箱 iframe 中渲染该 HTML；宿主与 UI 之间走
  postMessage 上的 JSON-RPC 2.0（`ui/initialize` 握手 → `tool-input` / `tool-result` 通知；
  UI 侧可回调 `tools/call`、`ui/open-link`、`ui/update-model-context` 等）。
  `visibility: ["model"|"app"]` 控制工具对模型/应用可见性。
- **成熟度**：官方规范已 stable；统一了先前的 MCP-UI（Postman/HuggingFace/Shopify/Goose 等采用）
  与 OpenAI Apps SDK（2025-11 在 ChatGPT 上线，widget 内部为构建产物 HTML〔推断：OpenAI 侧未逐条核对〕）。
  MVP 仅支持 HTML（RemoteDOM 等显式延后）；宿主经标准化 CSS 变量下发主题。
  来源：[官方公告](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) ·
  [spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) ·
  [MCP-UI SDK](https://github.com/MCP-UI-Org/mcp-ui) · [WorkOS 分析](https://workos.com/blog/2026-01-27-mcp-apps)。
- **关键事实**：**MCP Apps 没有任何声明式/数据 schema 驱动的 UI 描述**——UI 就是任意 HTML/JS 包。
  它定义的是「承载 + 通信 + 沙箱」协议，不定义 UI 内容格式。

## 2. A2UI（Google 主导的 Agent-to-UI 声明式协议）

- **是什么**：声明式流式 UI 协议：agent 发 JSONL 消息流
  （`begin` / `beginRendering`(surfaceId/catalogId/rootComponentId) / `updateComponents`），
  客户端据**标准组件目录**（Row/Column/Card/Text/Image/Button/TextField 等，可注册自定义目录）原生渲染。
  组件属性值为字面量或**路径引用**（绑定到层级化 dataModel / localData，如 `/user/name`）；
  用户交互以 `userAction`（action 签名 + context 路径）回传 agent。支持 A2A / MCP 等传输侧集成。
- **成熟度**：Google 主导、CopilotKit 为发布伙伴；v0.8（2025-09 立稿、2025-11 更新）→
  **v0.9.1 为当前版、v1.0 已出 candidate**（版本迭代快，字面未冻结）；已有 Flutter/Angular/React/Lit/Vue
  官方渲染器〔推断：渲染器清单以官网资料为据，未逐一运行验证〕。
  来源：[What is A2UI](https://a2ui.org/introduction/what-is-a2ui/) ·
  [v0.8 spec](https://a2ui.org/specification/v0.8-a2ui/) ·
  [CopilotKit 集成文档](https://docs.copilotkit.ai/agent-spec/generative-ui/a2ui) ·
  [ADK 实战](https://atamel.dev/posts/2026/03-30_a2ui_with_adk/)。
- **关键事实**：A2UI **是**数据驱动 UI 描述（组件树 + 路径数据绑定 + 事件签名），但粒度是
  "布局组件 + 数据绑定"，不是 "JSON Schema → 表单" 的直接映射；表单语义需自建映射层。

## 3. 逐条映射分析（Atelier 扁平 schema ↔ 两种标准）

### 3.1 字段覆盖

| Atelier FlatField | MCP Apps（inputSchema 面） | A2UI 组件映射〔推断〕 |
|---|---|---|
| `string`（含 min/max/pattern） | 标准 JSON Schema 直接可达（`server.mjs` 已实现该向） | `TextField`（pattern 校验宿主侧无标准位，需 action 前自校） |
| `number`（min/max） | 同上 | `TextField`/Slider 类；min/max 走绑定值约束 |
| `boolean` | 同上 | `CheckBox` |
| `string + enum` | `enum` 直达 | `Select`/`RadioButtonGroup` |
| `array` + 标量 `items` | `items` 直达 | `List`/`Row` + Repeat 绑定 |
| **无**嵌套 object / object 数组 | JSON Schema 可表达但**超出扁平红线**（H1） | A2UI dataModel 天然层级化——**这是最大结构差距**：适配须把嵌套数据拉平成路径，或只支持 A2UI 数据模型的一层子集 |

结论：**扁平 schema ⊂ JSON Schema ⊆ A2UI 数据模型**。向外的单向投影（出）零信息损失
（除嵌套本就不存在）；**向内（入）只能收一个子集**——嵌套组件树/任意数据绑定不是 D 子集能力。

### 3.2 组件语义

- MCP Apps：无组件语义可映射（HTML 即内容）。Atelier 侧若适配，**D 子集渲染器产物（A 模板编译产物）
  打包进 `ui://` HTML 资源**即可——token 纪律（决策 8/16）经 CSS 变量与 MCP Apps 主题下发对齐〔推断：
  变量命名需一层映射表〕。语义保留度最高的一条路径。
- A2UI：Atelier 扁平 schema 字段 → A2UI 组件类型可以做**机械映射表**（上表），但 A2UI 的
  样式体系是组件目录 + style assets，与 Atelier token 单源（`atelier.config.json` → @theme）是
  两套真值源；白名单组件语义（决策 12）与 A2UI catalog 有概念对应（注册表 ≈ catalog），可对齐〔推断〕。

### 3.3 事件模型

- Atelier 契约 `Contract = {name, props, events, usage}`（ARCHITECTURE §5），D 子集组件事件未单列规范〔推断：
  按 A 模板 `on:` 语义走〕。
- MCP Apps：UI 内事件 = iframe 内自洽（Atelier 信号引擎直接消化，零适配）；跨壳事件 =
  `tools/call` 回调——D 子集表单提交可自然映射为一个 MCP 工具调用（inputSchema 即扁平 schema）。
  **事件模型兼容度：高**，因为 Atelier 是自包含客户端渲染（决策 4）。
- A2UI：`userAction(name, context 路径)` 与 Atelier 事件不一一对应：A2UI 事件携带数据路径上下文、
  由宿主回传 agent；Atelier 事件是组件内同步 handler。适配需引入 "事件 → action 签名" 翻译层
  + 把 handler 改写为 "写 dataModel 路径 + 发 action"，与信号内核的同步语义有摩擦〔推断〕。

## 4. 结论与建议

1. **验证 D-4 的正交判断成立**。MCP Apps 解决 "agent 宿主里承载 UI"（Atelier 应用可直接充当其
   HTML 资源内容）；A2UI 解决 "agent 流式声明 UI、宿主原生渲染"（Atelier 无宿主角色、也无意愿把
   模板语言降格为其组件目录）。两者都不改变 Atelier "agent 当开发者、框架管可逆与验收" 的主轴。
2. **映射 prototype 值得做的最小切口（若做，均为单向导出器，不进内核）**：
   - **切口 A（性价比最高）**：`扁平 schema → MCP Apps 工具 + ui:// HTML 表单`。表单 UI 由 D 子集
     白名单渲染器（本来就在规划内）从扁平 schema 渲染、A 模板管线编译打包。这同时催熟了尚未实装的
     白名单渲染器本体——适配只是它的一个部署形态，工程不外溢。
   - **切口 B（观察项）**：`扁平 schema → A2UI updateComponents 表单消息` 的单向映射表 + 3.1 表组件映射。
     但 A2UI 版本未冻结（v0.9.1/v1.0-candidate 迭代中），**建议只跟踪不实现**，v1.0 定稿后再评估。
3. **不做的理由（对应 D-4 后果栏）**：深投入 = 自建 A2UI 渲染器或 MCP Apps 宿主，双线维护
   两套 UI 真值源，且与桌面 exe 一级分发（决策 0）、模板 DSL 主表达（决策 1）无协同；D 子集的
   内生动力（契约 schema 三用 + 白名单安全渲染）不依赖任何一者成立。

## 5. 诚实边界

- A2UI v0.9.1/v1.0-candidate 细节未逐条读原文（本文以其官网 v0.8 全文 + 检索摘要为据），组件目录
  与消息名可能已有出入——切口 B 落地前必须以最新 spec 复核。
- OpenAI Apps SDK widget 内部实现仅据二手来源，标〔推断〕。
- A2UI 组件映射表中具体组件名（TextField/Select 等）为按 v0.8 目录的〔推断〕写法，未逐个验证存在性。
- "Atelier 事件 ↔ A2UI userAction 翻译层有摩擦" 是架构层推断，未做代码实验。
