/**
 * DeepSeekIntro.atr.ts — 演示页编排层（薄壳）。
 * 【决策 16】样式迁移至工具类 + .tab/.section-shell recipe；scoped 已清空。
 * 职责仅剩：顶栏导航 / 六个实验台页签的切换状态 / 页脚。
 *
 * 已知语义：切走再切回某个页签，面板会重挂载、内部状态归零——
 * 组件即边界；跨页签需要存活的演示（事务时间线）显式落在全局 store。
 */
import { component, $state, html } from "../runtime";
import "./HeroSection.atr.ts";
import "./StatsStrip.atr.ts";
import "./ModelsSection.atr.ts";
import "./BenchSection.atr.ts";
import "./PillarsSection.atr.ts";
import "./PanelStream.atr.ts";
import "./PanelOptimistic.atr.ts";
import "./PanelTimeTravel.atr.ts";
import "./PanelDerive.atr.ts";
import "./PanelContract.atr.ts";
import "./PanelTokens.atr.ts";

const TABS = [
  { id: "stream", label: "流式打字" },
  { id: "optimistic", label: "乐观列表" },
  { id: "timetravel", label: "时间旅行" },
  { id: "derive", label: "派生信号" },
  { id: "contract", label: "契约校验" },
  { id: "tokens", label: "Token 试衣" },
];

export const DeepSeekIntro = component(function DeepSeekIntro() {
  const tab = $state("optimistic"); // 临时：透明度修饰类视觉验证用，拍完复原
  // 模板表达式不支持带参函数调用：类名用纯三元；点击经 data-tab + 事件委托读目标。
  const pickFromEvent = (e: Event) => {
    const id = (e.currentTarget as HTMLElement | null)?.closest("[data-tab]")?.getAttribute("data-tab") ?? "";
    if (id) tab.value = id;
  };

  return html`
    <div class="min-h-screen relative overflow-x-clip">
      <header class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-md px-lg py-md border-b border-surface-2 bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)] backdrop-blur-[10px]">
        <span class="font-extrabold tracking-[.14em] text-sm">🐳 DEEPSEEK <b class="text-primary px-[.2em]">×</b> ATELIER</span>
        <nav class="flex gap-md">
          <a class="text-muted text-sm tracking-tight no-underline hover:text-primary transition-colors" href="#models">模型</a>
          <a class="text-muted text-sm tracking-tight no-underline hover:text-primary transition-colors" href="#bench">能力</a>
          <a class="text-muted text-sm tracking-tight no-underline hover:text-primary transition-colors" href="#pillars">框架特色</a>
          <a class="text-muted text-sm tracking-tight no-underline hover:text-primary transition-colors" href="#lab">实验台</a>
        </nav>
        <span class="text-muted text-xs whitespace-nowrap hidden md:inline">自描述注册表 · dev 面在线</span>
      </header>

      <main class="max-w-[1120px] mx-auto px-lg pb-xl relative">
        <HeroSection />
        <StatsStrip />
        <ModelsSection />
        <BenchSection />
        <PillarsSection />

        <section class="section-shell" id="lab">
          <p class="eyebrow">PLAYGROUND</p>
          <h2 class="h-section-fluid">交互实验台</h2>
          <div class="flex flex-wrap gap-sm mb-md">
            {#each TABS as t}
              <button class={tab.value === t.id ? "tab tab-on" : "tab"} data-tab={t.id} on:click={pickFromEvent}>{t.label}</button>
            {/each}
          </div>

          {#if tab.value === "stream"}
            <PanelStream />
          {/if}
          {#if tab.value === "optimistic"}
            <PanelOptimistic />
          {/if}
          {#if tab.value === "timetravel"}
            <PanelTimeTravel />
          {/if}
          {#if tab.value === "derive"}
            <PanelDerive />
          {/if}
          {#if tab.value === "contract"}
            <PanelContract />
          {/if}
          {#if tab.value === "tokens"}
            <PanelTokens />
          {/if}
        </section>

        <footer class="mt-[calc(var(--space-xl)*1.5)] pt-lg pb-xl border-t border-surface-2 text-muted text-xs text-center flex flex-col gap-1">
          <p class="text-text">本页由 AI 代理经 Atelier 技能包 + MCP 工具面 + CLI 质量门生成 · snapshot 必须人工复查（DoD 第 4 条）</p>
          <p>Atelier v0.2-prototype · 决策 2/5/6/7/8 最小实现 · token 来自 atelier.config.json 单源 · 数据快照取自公开报道（36kr / llm-stats / morphllm），参数与价格以官方文档为准</p>
        </footer>
      </main>
    </div>
  `.locals({ props: {}, tab, TABS, pickFromEvent });
}, { name: "DeepSeekIntro" });
