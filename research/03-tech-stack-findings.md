# 2025–2026「支持新前端框架」底层技术现状矩阵

> 调研方式：联网核实（web_search），逐项给出现状与来源 URL；核实不了的标「未确认」。

## 一、7 项技术现状矩阵

| 技术项 | 2025–2026 现状 | 成熟度 | 对新框架的启示 | URL |
|---|---|---|---|---|
| TC39 Signals 提案 | 官仓/提案持续活跃，处于 Stage 2（进展中）；**未确认已进入 Stage 3/4**，仍未成为标准。Angular、Solid、Preact 已各自发布稳定信号实现；Svelte 5 用 **runes**（编译期信号）；React 走 **use() + 编译器** 而非信号。各框架**调度语义仍不统一**（脏标记/批处理/优先级差异大）。 | 提案：中（Stage 2）；框架侧：高 | 可先建立自己的信号内核，把 TC39 当「未来适配层」——不要押注标准落地时间。 | [proposal-signals](https://github.com/tc39/proposal-signals) / [对比](https://juejin.cn/post/7619621620609761306) |
| 编译时细粒度响应式 | Svelte 5（编译 runes）、Solid（编译+运行时）、Vue **Vapor 模式**（3.6 alpha 未稳定）已收敛；React **Compiler 1.0 于 2025-10 稳定**，自动记忆化。**「编译时」已成显学但未成唯一主流**——Vue/Solid 仍以运行时为主，React 走重编译路线。 | 中高（多路线并行） | 具备「编译时定位作用域+销毁」能力的框架处于红利期；但编译器复杂度上升，需评估维护成本。 | [React Compiler 1.0](https://zh-hans.react.dev/blog/2025/10/07/react-compiler-1) / [Vue 3.6 alpha](https://github.com/vuejs/core/releases/tag/v3.6.0-alpha.1) |
| Qwik 可恢复性 | 以 **resumability**（无 SSG 序列化+恢复，免整页水合）独树一帜，但生态与采用率远低于 Svelte/Solid。 | 中低 | 提供「零水合、按需激活」新范式，适合对首屏极敏感的新框架参考，不宜照抄。 | [架构对比](https://www.czmultimedia.com/blog/astro-qwik-nextjs-nuxt-comparatif-architecture-front-end-2025) |
| Astro islands + View Transitions | islands/部分水合为成熟主流；Astro 默认提供 islands，并大面积采用**原生 View Transitions API**（跨页平滑过渡，少脚本）。 | 高 | 新框架可默认支持 islands 与原生 VT API 作为原生能力而非插件。 | [astro VT 指南](https://eastondev.com/blog/en/posts/dev/20251202-astro-view-transitions-guide/) / [astro 文档](https://github.com/withastro/astro/pull/13802) |
| Vite 7 | 2025 发布。**默认打包器仍为 Rollup**；Rolldown 走 `rolldown-vite` 实验通道（[迁移指南](https://raw.githubusercontent.com/vitejs/vite/130ef31b4863d25008db2206a4aa855b4935ebcd/docs/guide/migration.md)）。 | 高 | 以 Vite 7（Rollup）+ 可选 Rolldown 起步，稳。 | [Vite 7.0](https://vite.dev/blog/announcing-vite7.html) / [Rolldown 集成](https://v7.vite.dev/guide/rolldown) |
| Rolldown | **1.0 已发布**（Rust 重写，性能大幅提升）；已衍生 `rolldown-vite`，并出现「Vite 8 beta 默认 Rolldown」信号。**尚未成为 Vite 官方默认**。 | 中高（快速上升） | 新框架可考虑「Vite8/Rolldown 优先」；但对生态插件兼容性持谨慎。 | [Rolldown 1.0](https://voidzero.dev/posts/announcing-rolldown-1-0) / [Vite8 升级 issue](https://github.com/ChrisTowles/blog/issues/114) |
| Oxc / Oxlint | Rust 工具链，解析/lint/转译性能领先并被多个项目采用；但**尚未成为统一编译器替代品**，处于整合成长期。 | 中 | 可借 Oxc 提速构建，但别依赖单一未定型工具链。 | [oxc 平台支持 issue](https://github.com/oxc-project/oxc/issues/16094) |
| Turbopack | 在 **Next.js 16 趋于稳定**并被官方采用（Vercel 主导），但仍是 Next 生态为主。 | 中高 | 若面向 Next 场景可用；跨框架通用性不如 Vite。 | [Next.js 16](https://nextjs.org/blog/next-16-beta) / [InfoQ](https://www.infoq.com/news/2025/12/nextjs-16-release/) |
| TypeScript 原生移植 (tsgo) | **TS 6.0 含破坏性默认值；TS 7.0 为 Go 原生重写**，预览通道可用，官方计划**2026 年初**交付（10x 级提速）。已出现用户将其用于 CI。 | 中高（进行中） | 面向未来：在新框架模板中预留 tsgo 迁移，锁定 `erasableSyntaxOnly`。 | [InfoWorld 原生版](https://www.infoworld.com/article/4100582/microsoft-steers-native-port-of-typescript-to-early-2026-release.html) / [tsgo](https://github.com/microsoft/TypeScript-go) |
| erasableSyntaxOnly / 类型剥离 | `erasableSyntaxOnly` 已在 Node/主流运行时可作**纯类型剥离**；Node 现可直接运行 `.ts`。 | 高 | 新框架若「先剥离类型再跑」，需强制该标志保持可执行性。 | [erasableSyntaxOnly 说明](https://cdn.egghead.io/use-the-erasable-syntax-only-type-script-compilation-flag~8m293) / [Node 直接跑 .ts](https://dev.to/astraedus/typescript-vs-javascript-in-2026-now-that-node-runs-ts-files-directly-1m2l) |
| Bun / Deno 原生 TS | 两者原生执行 TS；**Bun 1.3、Deno 2** 持续更新，类型剥离为默认。 | 中高（成长期） | 作为新框架的 dev/测试运行时很顺；生产仍多走 Node/bundler。 | [对比](https://dev.to/stacknotice/bun-vs-deno-2-vs-nodejs-22-the-complete-2026-comparison-20ch) |
| React Server Components | 随 Next.js 走「服务器组件+流式 SSR」路线，但**基本锁定 React 生态**，跨框架复用有限。 | 中 | 新框架若想支持 RSC，须自建组件协议，成本高；可作为差异化而非默认。 | [RSC skill](https://github.com/yonatangross/orchestkit/blob/e172c03473ddb5fad0dea380da268f705233e0d4/src/skills/react-server-components-framework/SKILL.md) |
| 流式 SSR / 服务器驱动 UI | streaming SSR + Suspense 为标配；**HTMX / LiveView / Hotwire 的「html-over-the-wire」2025 仍活跃**，服务器驱动 UI 是实打实的并行路线（适合高延迟/低交互场景）。 | 高 | 新框架应「SSR 流式 + 可选服务器驱动」双模式，而非二选一。 | [LiveView+HTMX 融合](https://www.libhunt.com/posts/1457496-show-hn-i-combine-htmx-liveview-and-solidjs-for-interactive-server-components) |
| Web Streams | 在 Node/浏览器 SSR（SSR 流式响应、`ReadableStream` 转 HTML）中**广泛落地**并趋成熟。 | 高 | 新框架建议默认以 Web Streams 作为 SSR 传输层。 | [Astro chat islands](https://getstream.io/blog/chat-astro-islands/) |
| Web Components（Shadow DOM / self-hiding custom elements） | 原生能力成熟（Chrome 长期支持），Coherent Labs 也已支持 Shadow DOM；但**社区采用整体偏工具化**（如 Lit），做**完整框架基底者少**；`self-hiding` 自定义元素仍在探索。 | 中 | 可作「跨框架互操作边界」而非核心数据流方案；值不值得整框架基于它，取决于目标兼容面。 | [最佳实践](https://github.com/aarongustafson/web-component-starter/blob/main/WEB-COMPONENTS-BEST-PRACTICES.md) / [Shadow DOM 组件](https://coherent-labs.com/blog/news/custom-components-with-shadow-dom/) |
| WASM（GC / JSPI / 组件模型） | **Wasm GC** 主流引擎已成熟；**JSPI** 已入 interop 但仍在跨浏览器推进（[interop#1093](https://github.com/web-platform-tests/interop/issues/1093)）；**组件模型 + WASI 0.3** 在插件/共享内存场景成形（wasmCloud），**但仍偏实验/前沿**（已曝 CVE-2025-5959 安全事件）。 | GC：高；JSPI/组件模型：中低 | 适合做「插件/运行时扩展」基座；当前面向前沿/平台型扩展，不建议作为核心框架依赖。 | [wasmCloud 组件模型](https://wasmcloud.com/community/2025-09-10-community-meeting/) / [JSPI interop](https://github.com/web-platform-tests/interop/issues/1093) |

## 二、推荐的新框架底层基线

1. **信号内核自建 + 预留 TC39 适配层**——不要等标准（现仍 Stage 2，未定）。参考 Solid/Preact 的运行时信号与 Angular 的调度取舍，明确「脏标记/批处理」语义，为将来透传给标准 `Signal` 留接口。
2. **编译时定位细粒度响应式**（Svelte 5 runes / Solid 路线）是当前显学，能带来显著 bundle 与性能红利；但仅当有你自己的编译器投入，否则走运行时信号+选择性编译。React Compiler 1.0 的稳定标志该方向可行——也标志其工程复杂度。
3. **构建链以 Vite 7（Rollup）为稳健基线，Rolldown 1.0 作为性能备选**；留意「Vite 8 beta 默认 Rolldown」趋势，提前做插件兼容测试，但**别以未默认的 Rolldown 为唯一依赖**。
4. **锁定 `erasableSyntaxOnly` + 类型剥离**，保证 .ts 可被 Node/Bun/Deno 直接运行；把 **tsgo 原生版本（2026 初）** 作为升级通道，避免绑定 Webpack/Rollup 式重型转译链。
5. **SSR 传输层用 Web Streams**（流式），并**默认支持部分水合/islands**；把 **View Transitions API 作为原生能力**内建。
6. **服务器驱动 UI（受 HTMX/LiveView 启发）作为可选模式**而非默认，适合流式/低交互页；与客户端 hydration 并存。
7. **Web Components 仅作跨框架/平台互操作边界**，不作为核心数据流与组件模型基底——其生态成熟度不足以承载完整框架语义。
8. **WASM 仅作插件/运行时扩展基座**（参考 Wasm GC + JSPI + 组件模型前沿），不进核心依赖；注意其安全与跨浏览器一致性风险，且板块仍未定稿。

## 三、未确认项

- **TC39 Signals 的精确 Stage**（是否进入 Stage 3 未能核实，按 Stage 2 记录）。
- **JSPI 跨浏览器落地状态**（有 interop 项但进度未完全确认）。
- **Bun/Deno 具体小版本号**以官方发布为准。
