/**
 * DeepSeekIntro.atr.ts — 演示页编排层（薄壳）。
 * 职责仅剩：顶栏导航 / 六个实验台页签的切换状态 / 页脚。
 * 一切实体内容都在各自组件里（Hero/Stats/三区块/六面板），每个文件 <200 行，
 * 符合本仓库「AI 友好结构」对文件粒度的主张。
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
  const tab = $state("stream");
  const pickTab = (id: string) => () => (tab.value = id);
  // 动态属性只支持整值表达式：类名在 TS 侧拼好
  const tabCls = (id: string) => () => (tab.value === id ? "lab__tab lab__tab--on" : "lab__tab");

  return html`
    <div class="page">
      <header class="topbar">
        <span class="topbar__brand">🐳 DEEPSEEK <b>×</b> ATELIER</span>
        <nav class="nav">
          <a class="nav__a" href="#models">模型</a>
          <a class="nav__a" href="#bench">能力</a>
          <a class="nav__a" href="#pillars">框架特色</a>
          <a class="nav__a" href="#lab">实验台</a>
        </nav>
        <span class="topbar__meta">自描述注册表 · dev 面在线</span>
      </header>

      <main class="main">
        <HeroSection />
        <StatsStrip />
        <ModelsSection />
        <BenchSection />
        <PillarsSection />

        <section class="section" id="lab">
          <p class="section__eyebrow">PLAYGROUND</p>
          <h2 class="section__title">交互实验台</h2>
          <div class="lab__tabs">
            {#each TABS as t}
              <button class={tabCls(t.id)()} on:click={pickTab(t.id)}>{t.label}</button>
            {/each}
          </div>

          {#if tab.value === "stream"}
            <PanelStream />
          {:else if tab.value === "optimistic"}
            <PanelOptimistic />
          {:else if tab.value === "timetravel"}
            <PanelTimeTravel />
          {:else if tab.value === "derive"}
            <PanelDerive />
          {:else if tab.value === "contract"}
            <PanelContract />
          {:else if tab.value === "tokens"}
            <PanelTokens />
          {/if}
        </section>

        <footer class="footer">
          <p class="footer__strong">本页由 AI 代理经 Atelier 技能包 + MCP 工具面 + CLI 质量门生成 · snapshot 必须人工复查（DoD 第 4 条）</p>
          <p>Atelier v0.2-prototype · 决策 2/5/6/7/8 最小实现 · token 来自 atelier.config.json 单源 · 数据快照取自公开报道（36kr / llm-stats / morphllm），参数与价格以官方文档为准</p>
        </footer>
      </main>

      <style scoped>
        .page { min-height: 100vh; position: relative; overflow-x: clip; }
        .topbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-md); padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--color-surface-2); background: color-mix(in srgb, var(--color-bg) 78%, transparent); backdrop-filter: blur(10px); position: sticky; top: 0; z-index: 20; }
        .topbar__brand { font-weight: 800; letter-spacing: .14em; font-size: .9rem; }
        .topbar__brand b { color: var(--color-primary); padding: 0 .2em; }
        .nav { display: flex; gap: var(--space-md); }
        .nav__a { color: var(--color-muted); text-decoration: none; font-size: .84rem; letter-spacing: .06em; transition: color .15s; }
        .nav__a:hover { color: var(--color-primary); }
        .topbar__meta { color: var(--color-muted); font-size: .78rem; white-space: nowrap; }
        .main { max-width: 1120px; margin: 0 auto; padding: 0 var(--space-lg) var(--space-xl); position: relative; }
        .section { margin-top: calc(var(--space-xl) * 1.35); scroll-margin-top: 90px; }
        .section__eyebrow { color: var(--color-primary); font-size: .76rem; letter-spacing: .22em; margin-bottom: .35rem; }
        .section__title { font-size: 1.65rem; margin-bottom: var(--space-md); }
        .lab__tabs { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md); }
        .lab__tab { background: transparent; border: 1px solid var(--color-surface-2); color: var(--color-muted); padding: .42rem .95rem; border-radius: 999px; cursor: pointer; font-size: .84rem; transition: all .18s; }
        .lab__tab:hover { color: var(--color-text); border-color: var(--color-primary); }
        .lab__tab--on { background: linear-gradient(120deg, var(--color-primary), var(--color-primary-soft)); color: var(--color-bg); border-color: transparent; font-weight: 600; box-shadow: 0 8px 22px -10px color-mix(in srgb, var(--color-primary) 78%, transparent); }
        .footer { margin-top: calc(var(--space-xl) * 1.5); padding: var(--space-lg) 0 var(--space-xl); border-top: 1px solid var(--color-surface-2); color: var(--color-muted); font-size: .76rem; text-align: center; display: flex; flex-direction: column; gap: .35rem; }
        .footer__strong { color: var(--color-text); }
        @media (max-width: 860px) {
          .topbar { flex-wrap: wrap; }
          .topbar__meta { display: none; }
        }
      </style>
    </div>
  `.locals({ props: {}, tab, TABS, pickTab, tabCls });
}, { name: "DeepSeekIntro" });
