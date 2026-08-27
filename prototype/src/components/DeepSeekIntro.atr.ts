/**
 * DeepSeekIntro.atr.ts — 演示页主组件。
 * 展示：流式原语（识别手写打字机模式）、三态乐观列表、事务 checkpoint/回滚、
 *       契约校验四段式、$derived、自描述注册表。
 */
import { component, $state, $derived, html, streamValue, optimisticList, store, validateUnknown } from "../runtime";
import type { AtrError } from "../runtime";
import { modelCardSchema } from "./ModelCard.atr.ts";

const MODELS = [
  {
    name: "deepseek-chat",
    badge: "V3 · 通用对话",
    tagline: "DeepSeek-V3 主力模型：日常对话、代码、写作即时响应。",
    highlights: ["128K 上下文", "OpenAI 兼容 API", "推理成本约为一线闭源的 1/30"],
  },
  {
    name: "deepseek-reasoner",
    badge: "R1 · 深度推理",
    tagline: "DeepSeek-R1 推理模型：复杂数学、逻辑、编程链式思考。",
    highlights: ["思考过程可见", "数学竞赛级推理", "对标一线 o1 级模型"],
  },
  {
    name: "DeepSeek-V3 / R1 开源权重",
    badge: "开放权重",
    tagline: "模型权重开放，支持社区蒸馏与本地部署。",
    highlights: ["开源权重", "7B / 70B 蒸馏版", "MCP · 工具调用生态活跃"],
  },
];

export const DeepSeekIntro = component(function DeepSeekIntro() {
  // —— 流式简介：framework 原生 streamValue（取代手写 setInterval 打字机）——
  const intro = streamValue<string>();
  const introText = $derived(() => intro.values.join(""));
  async function streamIntro() {
    const r = await fetch("/__atelier/stream-intro");
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const s = dec.decode(value, { stream: true });
      for (const ch of s) {
        intro.push(ch);
        await new Promise((res) => setTimeout(res, 14));
      }
    }
    intro.finish();
  }

  // —— 自描述注册表（决策 7 查询面雏形）——
  const meta = $state<{ components?: number; primitives?: number; server?: string }>({});
  fetch("/__atelier/registry")
    .then((r) => r.json())
    .then((j) => {
      meta.value = { components: j.components.length, primitives: j.primitives.length, server: j.meta?.server };
    })
    .catch(() => {});

  // —— 乐观列表（三态原语）——
  const feats = optimisticList<{ id: string; label: string }>();
  const seed = [
    { id: "f-0", label: "OpenAI 兼容 API（/chat/completions）" },
    { id: "f-1", label: "128K 上下文窗口" },
    { id: "f-2", label: "Function Calling 原生支持" },
  ];
  for (const s of seed) {
    feats.optimisticAdd(s);
    feats.commit(s.id);
  }
  let fseq = seed.length;
  const onAsyncAdd = () => {
    const id = `f-${++fseq}`;
    feats.optimisticAdd({ id, label: `异步特性 #${fseq}（模拟 AI 生成）` });
    setTimeout(() => feats.commit(id), 900);
  };
  const onFailAdd = () => {
    const id = `f-${++fseq}`;
    feats.optimisticAdd({ id, label: `模拟失败：乐观更新自动回滚 #${fseq}` });
    setTimeout(() => feats.revert(id), 600);
  };

  // —— 事务状态层（checkpoint / rollback / timeTravel）——
  const genA = $state("（空）");
  const genB = $state("（空）");
  const genC = $state("（空）");
  const refresh = $state(0);
  const cps = $derived(() => {
    refresh.value;
    return store.list();
  });
  let round = 0;
  const onSimAI = () => {
    round += 1;
    genA.value = `v${round}.1 组件骨架已生成`;
    genB.value = `v${round}.2 样式已套用 token 体系`;
    genC.value = `v${round}.3 契约校验 + 断言已通过`;
    store.commit(`AI 第 ${round} 轮编辑`);
    refresh.value += 1;
  };
  const onRollback = () => {
    store.rollback();
    refresh.value += 1;
  };
  const onTravelFirst = () => {
    const first = store.list()[0];
    if (first) {
      store.timeTravel(first.id);
      refresh.value += 1;
    }
  };

  // —— $derived 演示 ——
  const count = $state(0);
  const double = $derived(() => count.value * 2);
  const bump = () => (count.value += 1);

  // —— 契约校验演示 ——
  const contractSrc = $state('{\n  "name": "deepseek-chat",\n  "badge": "V3",\n  "tagline": "xx",\n  "highlights": ["a"]\n}');
  const verdict = $state<{ ok: boolean; error?: AtrError } | null>(null);
  const verdictText = $derived(() => (verdict.value === null ? "" : JSON.stringify(verdict.value, null, 2)));
  const onContractInput = (e: Event) => {
    contractSrc.value = (e.target as HTMLTextAreaElement).value;
  };
  const onValidate = () => {
    try {
      const data = JSON.parse(contractSrc.value);
      verdict.value = validateUnknown(modelCardSchema, data, "ModelCard");
    } catch (err) {
      verdict.value = {
        ok: false,
        error: {
          code: "ATR-2xx",
          message: `JSON 解析失败：${(err as Error).message}`,
          context: { component: "ContractDemo" },
          fix: "修复 JSON 语法后再校验；对象需用双引号包裹键名",
        },
      };
    }
  };

  streamIntro();

  return html`
    <div class="page">
      <header class="topbar">
        <span class="topbar__brand">ATELIER <b>·</b> prototype</span>
        <span class="topbar__meta">自描述：{meta.value.components ?? "…"} 组件 / {meta.value.primitives ?? "…"} 原语</span>
      </header>

      <main class="main">
        <section class="hero">
          <p class="hero__eyebrow">Atelier 信号内核渲染 · 组件即源码（.atr.ts）</p>
          <h1 class="hero__title">认识 <span class="hero__logo">DeepSeek</span></h1>
          <p class="hero__sub">AI 原生框架 v0.1 演示页——由信号内核 + 事务状态 + 流式原语驱动</p>
          <div class="hero__intro">
            <span class="hero__text">{introText.value}</span>
            <span class="hero__cursor">{intro.done ? "" : "▋"}</span>
          </div>
        </section>

        <section class="section">
          <h2 class="section__title">开放模型 API</h2>
          <div class="grid">
            {#each MODELS as m}
              <ModelCard name={m.name} badge={m.badge} tagline={m.tagline} highlights={m.highlights} />
            {/each}
          </div>
        </section>

        <section class="section section--demo">
          <h2 class="section__title">框架演示</h2>
          <div class="demo-grid">
            <div class="panel">
              <h3 class="panel__title">乐观列表（optimisticList 三态原语）</h3>
              <ul class="feature-list">
                {#each feats.values as f}
                  <li class="feature">
                    <span class="feature__dot {f.status === "pending" ? "feature__dot--pending" : "feature__dot--ok"}">{f.status === "pending" ? "…" : "✓"}</span>
                    <span class="feature__label">{f.it.label}</span>
                    {#if f.status === "pending"}
                      <em class="feature__pending">pending</em>
                    {/if}
                  </li>
                {/each}
              </ul>
              <div class="panel__actions">
                <button class="btn" on:click={onAsyncAdd}>模拟 AI 异步提交（900ms 后确定）</button>
                <button class="btn btn--warn" on:click={onFailAdd}>模拟失败（600ms 后自动回滚）</button>
              </div>
            </div>

            <div class="panel">
              <h3 class="panel__title">事务状态层（checkpoint 时间轴）</h3>
              <div class="tx-log">
                <div class="tx-log__row">A. {genA.value}</div>
                <div class="tx-log__row">B. {genB.value}</div>
                <div class="tx-log__row">C. {genC.value}</div>
              </div>
              <div class="panel__actions">
                <button class="btn" on:click={onSimAI}>模拟 AI 一轮编辑 → 命名 checkpoint</button>
                <button class="btn btn--danger" on:click={onRollback}>回滚一步</button>
                <button class="btn btn--ghost" on:click={onTravelFirst}>回到第 1 轮</button>
              </div>
              <ul class="cps">
                {#each cps.value as cp}
                  <li class="cps__row"><code class="cps__id">{cp.id}</code> <span>{cp.name}</span></li>
                {/each}
              </ul>
            </div>

            <div class="panel">
              <h3 class="panel__title">$derived 派生信号（惰性缓存）</h3>
              <p class="demo-line">计数器：<b>{count.value}</b> → 派生值：<b class="accent">{double.value}</b></p>
              <div class="panel__actions">
                <button class="btn" on:click={bump}>+1</button>
              </div>
            </div>

            <div class="panel">
              <h3 class="panel__title">契约校验（AtrError 四段式）</h3>
              <p class="demo-line demo-line--hint">输入 ModelCard 的 props JSON，点击校验：</p>
              <textarea class="contract-input" on:input={onContractInput}>{contractSrc.value}</textarea>
              <div class="panel__actions">
                <button class="btn" on:click={onValidate}>校验</button>
              </div>
              {#if verdict.value}
                <pre class="contract-out">{verdictText.value}</pre>
              {/if}
            </div>
          </div>
        </section>

        <footer class="footer">
          <p>Atelier v0.1-prototype · 决策 2/5/6/7/8 最小实现 · 令牌来自 atelier.config.json 单源 · 注册表：/__atelier/registry</p>
        </footer>
      </main>
    </div>

    <style scoped>
      .topbar { display: flex; justify-content: space-between; align-items: center; padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--color-surface-2); background: var(--color-surface); position: sticky; top: 0; z-index: 10; }
      .topbar__brand { font-weight: 700; letter-spacing: .12em; color: var(--color-primary); }
      .topbar__brand b { color: var(--color-muted); }
      .topbar__meta { color: var(--color-muted); font-size: .82rem; }
      .main { max-width: 1080px; margin: 0 auto; padding: var(--space-xl) var(--space-lg); }
      .hero { padding: var(--space-xl) 0 var(--space-lg); }
      .hero__eyebrow { color: var(--color-primary); font-size: .85rem; letter-spacing: .08em; margin-bottom: var(--space-sm); }
      .hero__title { font-size: 3.2rem; line-height: 1.15; margin-bottom: var(--space-sm); }
      .hero__logo { background: linear-gradient(135deg, var(--color-primary), var(--color-primary-soft)); -webkit-background-clip: text; background-clip: text; color: transparent; }
      .hero__sub { color: var(--color-muted); margin-bottom: var(--space-md); }
      .hero__intro { min-height: 60px; max-width: 780px; color: var(--color-muted); border-left: 3px solid var(--color-primary); padding: var(--space-sm) var(--space-md); background: var(--color-surface); border-radius: 0 var(--radius-md) var(--radius-md) 0; }
      .hero__cursor { color: var(--color-primary); animation: blink 1s steps(1) infinite; }
      @keyframes blink { 50% { opacity: 0; } }
      .section { margin-top: var(--space-xl); }
      .section__title { font-size: 1.3rem; margin-bottom: var(--space-md); }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-md); }
      .demo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-md); }
      .panel { background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md); }
      .panel__title { font-size: 1rem; margin-bottom: var(--space-sm); }
      .panel__actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-sm); }
      .btn { background: var(--color-primary); color: #fff; border: 0; border-radius: var(--radius-sm); padding: .5rem .9rem; cursor: pointer; font-size: .85rem; transition: opacity .15s; }
      .btn:hover { opacity: .88; }
      .btn--danger { background: var(--color-danger); }
      .btn--warn { background: var(--color-warn); color: #201500; }
      .btn--ghost { background: transparent; border: 1px solid var(--color-surface-2); color: var(--color-muted); }
      .feature-list { list-style: none; display: flex; flex-direction: column; gap: var(--space-sm); }
      .feature { display: flex; align-items: center; gap: var(--space-sm); }
      .feature__dot { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: .75rem; }
      .feature__dot--ok { background: rgba(63, 185, 104, .18); color: var(--color-ok); }
      .feature__dot--pending { background: rgba(240, 169, 59, .18); color: var(--color-warn); }
      .feature__pending { color: var(--color-warn); font-style: normal; font-size: .75rem; }
      .tx-log { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; color: var(--color-muted); font-family: ui-monospace, monospace; }
      .cps { list-style: none; margin-top: var(--space-sm); display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; }
      .cps__row { display: flex; gap: var(--space-sm); align-items: center; }
      .cps__id { color: var(--color-primary); }
      .demo-line { font-size: .9rem; margin: var(--space-sm) 0; }
      .demo-line--hint { color: var(--color-muted); font-size: .8rem; }
      .accent { color: var(--color-primary); }
      .contract-input { width: 100%; height: 110px; background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-surface-2); border-radius: var(--radius-sm); padding: var(--space-sm); font-family: ui-monospace, monospace; font-size: .8rem; resize: vertical; box-sizing: border-box; }
      .contract-out { background: var(--color-bg); border: 1px solid var(--color-surface-2); padding: var(--space-sm); font-size: .75rem; overflow: auto; max-height: 260px; white-space: pre-wrap; }
      .footer { margin-top: var(--space-xl); padding-top: var(--space-md); border-top: 1px solid var(--color-surface-2); color: var(--color-muted); font-size: .78rem; text-align: center; }
    </style>
  `.locals({ props: {}, introText, intro, meta, feats, onAsyncAdd, onFailAdd, genA, genB, genC, cps, onSimAI, onRollback, onTravelFirst, count, double, bump, contractSrc, verdict, verdictText, onContractInput, onValidate, MODELS });
}, { name: "DeepSeekIntro" });
