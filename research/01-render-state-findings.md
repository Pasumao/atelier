# AI 应用场景渲染与状态范式调研

## 结论摘要
1. **流式/渐进渲染已是一等公民**：React `use()` + Suspense 与 RSC `streamText` 返回的 `StreamedValue` 为 token 级流式提供了原生原语，正取代 `useEffect` 手拼字符串的打字机 hack。([use - React](https://mintlify.wiki/facebook/react/api/hooks/use)、[Next.js use vs await 讨论](https://github.com/vercel/next.js/discussions/73401)、[RSC streaming](https://raw.githubusercontent.com/stevekinney/stevekinney.net/refs/heads/main/courses/enterprise-ui/server-components-and-streaming.md)、[AI SDK Streaming Values](https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-values)、[stream-text RSC cookbook](https://github.com/vercel/ai/blob/main/content/cookbook/20-rsc/21-stream-text-with-chat-prompt.mdx))
2. **工具调用参数流式仍是最痛点**：不少后端 parser 把 tool-call arguments 整体缓冲再发射，而非增量 emit，前端难以逐 token 渲染结构化负载。([vllm issue #47998](https://github.com/vllm-project/vllm/issues/47998)、[onyx tool_call_args_streaming.py](https://github.com/onyx-dot-app/onyx/blob/b03a0f8cac48dd77f4531d10db32475ed186060a/backend/onyx/chat/tool_call_args_streaming.py)、[struct-llm](https://github.com/jeffmm/struct-llm/)、[ai-dynamo tool parsers](https://github.com/ai-dynamo/dynamo/blob/3fcb0452ecd908cc7a8a48e9d3b48105f1bbbe3a/lib/parsers/README.md))
3. **两条状态路线并存**：服务器驱动 UI（LiveView/HTMX 的 SSE+差异更新）与客户端状态（Yjs/Automerge CRDT、离线优先），且乐观更新+回滚已组件化（`hx-optimistic`、LiveView syncing-changes）。([LiveViewJS](https://xebia.com/blog/checking-out-liveviewjs/)、[hx-optimistic](https://security.snyk.io/package/npm/hx-optimistic/1.0.3)、[Phoenix syncing-changes](https://hexdocs.pm/phoenix_live_view/0.20.17/syncing-changes.html)、[离线优先 CRDT+IndexedDB](https://dev.to/hexshift/building-offline-first-collaborative-editors-with-crdts-and-indexeddb-no-backend-needed-4p7l))
4. **端侧推理可跑但受限**：WebGPU/WebNN 驱动 WebLLM，Transformers.js 4.0 已生产化，但仍需 WASM 回退，内存/量化/设备兼容是门槛。([WebLLM](https://github.com/liaocm/web-llm)、[Transformers.js 4.0](https://github.com/huggingface/transformers.js/releases/tag/4.0.0)、[WebGPU vs WebASM](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)、[What's New in Web AI](https://d1eu30co0ohy4w.cloudfront.net/christianliebel/whats-new-in-web-ai))
5. **会话状态正从线性数组转向"树+分支+checkpoint"**，且离线本地持久化（IndexedDB/PGlite）成为原生需求。([LangChain branching-chat](https://docs.langchain.com/oss/javascript/langchain/frontend/branching-chat)、[Cloudflare conversation & memory](https://developers.cloudflare.com/agents/concepts/conversation-state-and-memory/)、[openagents PGlite 议题](https://github.com/OpenAgentsInc/openagents/issues/986))

## 范式清单

| 范式 | 现状 | 代表性实现 | 对新框架的意义 | URL |
|---|---|---|---|---|
| 流式/渐进渲染（RSC+Suspense+`use()`） | 成熟，React 生态一等公民 | Next.js / AI SDK RSC | 组件级流式、按需 fallback | [use()](https://mintlify.wiki/facebook/react/api/hooks/use)、[RSC streaming](https://raw.githubusercontent.com/stevekinney/stevekinney.net/refs/heads/main/courses/enterprise-ui/server-components-and-streaming.md) |
| StreamedValue/异步迭代器原语 | 已提供 | AI SDK RSC `streamText`→`StreamedValue` | 流有原生状态，不需 useEffect 拼串 | [AI SDK](https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-values) |
| 增量 JSON/工具参数流式解析 | **部分成熟，后端常缓冲** | vllm tool parsers / onyx deltas / struct-llm | 需增量流式 JSON 解析原语 | [vllm #47998](https://github.com/vllm-project/vllm/issues/47998)、[onyx](https://github.com/onyx-dot-app/onyx/blob/b03a0f8cac48dd77f4531d10db32475ed186060a/backend/onyx/chat/tool_call_args_streaming.py) |
| 服务器驱动 UI + SSE 差分 | 成熟（LiveView/HTMX） | LiveViewJS、htmx | 服务端为状态权威，前端收 patch | [LiveViewJS](https://xebia.com/blog/checking-out-liveviewjs/) |
| 乐观更新 + 回滚 | 成熟组件化 | hx-optimistic、Phoenix syncing-changes | 乐观状态一致性与失败回滚解耦 | [syncing-changes](https://hexdocs.pm/phoenix_live_view/0.20.17/syncing-changes.html)、[hx-optimistic](https://security.snyk.io/package/npm/hx-optimistic/1.0.3) |
| CRDT 协同应用状态 | 研究转生产，Yjs/Automerge 成熟 | Automerge、syncrostate | 状态可合并/离线/历史可回放 | [Automerge](https://automerge.org/automerge-repo/functions/_automerge_vanillajs.slim.Automerge.changeAt.html)、[syncrostate](https://github.com/beynar/syncrostate) |
| 会话树/分支/checkpoint | 开始成体系 | LangChain branching-chat、Cloudflare compaction | 消息非数组，支持分支回放 | [branching](https://docs.langchain.com/oss/javascript/langchain/frontend/branching-chat)、[cloudflare](https://developers.cloudflare.com/agents/concepts/conversation-state-and-memory/) |
| 端侧推理接入 | 可跑但受限（内存/量化/WASM 回退） | WebLLM、Transformers.js v4 | 可选端侧加速（隐私/离线/降本） | [WebLLM](https://github.com/liaocm/web-llm) |
| 渐变式披露/流式体验 | 实践驱动，缺统一规范 | aiverse observing-streaming | 中间过程渐进呈现，稳定布局优先 | [aiverse](https://www.aiverse.design/patterns/observing-streaming) |

## 关键挑战
- **工具参数流式**：后端常整体缓冲 arguments 再发射，需两端配合的增量 JSON 解析。([vllm #47998](https://github.com/vllm-project/vllm/issues/47998)、[onyx](https://github.com/onyx-dot-app/onyx/blob/b03a0f8cac48dd77f4531d10db32475ed186060a/backend/onyx/chat/tool_call_args_streaming.py))
- **流式一致性**：token 流 + 结构化更新 + 乐观状态交错，回滚/重放顺序需单一事实源。
- **时序与中断**：多模型/多工具流如何排序、取消（AbortController 语义）、interrupt 后的恢复。
- **状态体积**：长会话流式历史吃内存，需增量/量化/checkpoint，避免整树序列化。([cloudflare](https://developers.cloudflare.com/agents/concepts/conversation-state-and-memory/))
- **端侧门槛**：显存/量化/模型下载；WebNN 设备兼容不一致（未确认具体达标率）。([Web AI 现状](https://d1eu30co0ohy4w.cloudfront.net/christianliebel/whats-new-in-web-ai))
- **CRDT 集成复杂**：元数据开销大，与逐 token 流式更新的"合并 vs 追加"模型冲突。([CRDT 综述](https://github.com/sujeet-pro/sujeet.pro/blob/main/content/articles/crdt-for-collaborative-systems/README.md))
- **时间旅行未通用**：多为记录-重放（Replay engine/OS 级），尚非框架一等能力。([Laplace](https://github.com/Ikey168/Laplace)、[incremental hydration](https://github.com/react/react/commit/78df8338176d80a84c5ff1bcd7836bc8292b8f78))
- **hologram 闪烁 vs 稳定布局**：AI 生成 UI 的动效与可读性/无障碍平衡缺标准做法。([aiverse](https://www.aiverse.design/patterns/observing-streaming))

## 空白机会点
- 统一「流式 value + 增量 patch + 乐观回滚」三态模型的原语库（彻底抽象掉 useEffect 打字机）。
- 浏览器端可增量解析的 JSON 流解析器，直接对接 tool-call / structured-output 的 token 流。
- 会话建模规范化为「消息树 + 分支 + checkpoint + CRDT 历史」，与离线持久化（IndexedDB/PGlite）打包为框架数据层。
- 端侧/云端统一推理抽象：同一流式接口后接 WebLLM 或 RSC Server Function，按设备能力自动降级。
- 「时间性/回放」一等 API（time-machining、中断恢复），显著降低 agent 长会话调试成本。

**未确认项**：WebNN 各浏览器具体达标率、端侧模型显存/量化阈值、CRDT 与 token 流逐条合并的最优做法——均未找到权威量化数据，标「未确认」。
