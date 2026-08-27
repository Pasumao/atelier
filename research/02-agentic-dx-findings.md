# Agentic DX / Machine-first DX 调研报告

> 调研方式：多轮 web_search 联网核实；未核实到的项已标注"未确认"。

## 一句话判断
**尚无成熟统一的方法论体系**——当前处于"协议/约定在形成、设计经验碎片化"阶段：MCP 与 AGENTS.md 已构成事实层约定，但把"面向 LLM 的框架设计"上升为一套有版本、有参考实现的方法论，**尚未形成**（未确认存在任何统一规范）。

## 关键结论（12 条，含来源）
1. **MCP 已成跨厂商事实标准**：2024-11 发布，生态 2025 年被 OpenAI/Google/Docker 等广泛采纳；2025-11-25 发布一周年新规范。——来源：https://modelcontextprotocol.info/blog/first-mcp-anniversary/ 、https://www.docker.com/static/delivering-mcp-tools-for-enterprise-developers-white-paper.pdf
2. **MCP 2025-11 新规范引入授权（OAuth 2.1）、官方 Elixir SDK、流式 HTTP/异步消息、资源模板**等，标准化从传输层延伸到安全层。——来源：https://modelcontextprotocol.info/blog/first-mcp-anniversary/#authorization-extensions 、https://github.com/urth-inc/urchin
3. **AGENTS.md 2025–2026 成为跨代理事实标准**，被 Claude Code、Codex、Cursor 等 30+ 工具读取；OpenAI codex 也出现了规范化"reference rules"的社区标准讨论（版本仍处提案态）。——来源：https://github.com/openai/codex/issues/1624 、https://www.morphllm.com/agents-md-guide
4. **AGENTS.md 与 CLAUDE.md 并存**：CLAUDE.md 是 Anthropic 官方记忆约定，很多工具两者兼容，构成"根目录声明式项目上下文"。——来源：https://code.claude.com/docs/en/claude-md
5. **面向 LLM 的 API 首要瓶颈是"发现"**：agent 需要能自发现契约与约定，而非依赖人记忆/文档。——来源：https://apidog.com/blog/make-api-agent-ready/#the-discovery-bottleneck
6. **核心设计原则：显式约定>魔法、可预测命名、类型即契约、标准化响应格式、幂等+流式+可缓存、错误信息可机器解析**。——来源：https://apidog.com/blog/make-api-agent-ready/ 、https://github.com/nibzard/awesome-agentic-patterns/blob/main/patterns/llm-friendly-api-design.md
7. **自描述/元数据**：从 TS 类型自动生成 JSON Schema/OpenAPI/tool 定义（zod/typebox/fastify/schema-forge 类），MCP 工具定义为类型驱动单一真相。——来源：https://github.com/firefliesai/schema-forge 、https://deepwiki.com/run-llama/LlamaIndexTS/5.4-autotool-generation
8. **框架自描述先例清晰：Storybook MCP Server**——把组件库以 MCP 工具暴露给 AI，是"框架暴露自身 schema/约定供 agent 查询"的落地代表。——来源：http://A2A-MCP.org/entry/storybook-mcp 、https://devblogs.sh/posts/storybook-mcp-for-ai-aware-component-libraries
9. **"AI 主开发者、人拍板"范式要求框架具备可逆/可检查/可回放**（deterministic、inspectable、replayable state machine）。——来源：https://github.com/aafre/agentharness
10. **自主性 vs 控制是核心权衡**：2026 年 Claude Code vs Cline 对比与基准把"何时限制 agent 自主"纳入评估。——来源：https://dev.to/dibi8/claude-code-vs-cline-in-2026-autonomy-or-control-5588 、https://arxiv-org.ezproxy.obspm.fr/html/2607.10569v1
11. **源码即库**：shadcn 可复制粘贴组件反模式提示——agent 更爱可直接读的源码而非黑盒包。——来源：https://github.com/arafays/shadcn-ui 、https://www.shadcn-ui.cn/docs
12. **Bricks.dev 是 voice/text/image→应用的 AI IDE**（构建端），代表"AI-first 生成式前端"；注意与同名 Bricks Builder（WordPress 页构建器）区分。——来源：https://github.com/softenrj/Bricks 、https://explore.market.dev/ecosystems/typescript/projects/softenrj-bricks

## 可吸收模式清单（表）
| 模式 | 来源 | 吸收点 |
|---|---|---|
| 类型即契约 | schema-forge / LlamaIndexTS | TS 类型单源→JSON Schema/tool 定义，消歧义 |
| 自描述框架 | Storybook MCP | 框架暴露自身 schema/组件为可查询工具 |
| 源码即库 | shadcn | 组件/约定优先可读源码，非黑盒依赖 |
| 项目记忆 | AGENTS.md / CLAUDE.md | 根目录声明式上下文，跨代理共享 |
| 可逆/回放 | agentharness | 状态机可检查、可重放、可审计 |
| MCP 工具化 | MCP | 内部能力暴露为 LLM 可调工具 |
| 显式发现 | apidog | 消除隐式上下文依赖，契约可自查询 |

## 尚未做好的空白点
- **无统一、有版本号的 Agentic DX 方法论**；AGENTS.md 版本/参考实现仍在社区讨论。
- **框架自描述缺跨框架标准**：各家 MCP server 各自造轮子，无统一"框架 schema/约定"表达语法。
- **约束如何被 agent 忠实遵从**：复杂约束的表达方式（而非仅文档罗列）仍是盲区。
- **隐式上下文依赖与魔法/类型擦除**在多数框架仍存在，是 agent 出错高发源。
- **无可测的"agent 可推导性"基准指标**（未确认存在成熟度量）。
