/**
 * PanelContract.atr.ts — 实验台：契约校验 · ATR 四段式结构化渲染。
 * 好样本/坏样本一键切换；坏样本专治「看起来能跑」的载荷——
 * name 传数字、highlights 传字符串，渲染端拦截而不是白屏。
 */
import { component, $state, html, validateUnknown } from "../runtime";
import type { AtrError } from "../runtime";
import { modelCardSchema } from "./ModelCard.atr.ts";

const GOOD_SAMPLE =
  '{\n  "name": "deepseek-v4",\n  "badge": "旗舰",\n  "tagline": "示例合法载荷",\n  "highlights": ["flat schema"],\n  "accent": "warn"\n}';
const BAD_SAMPLE = '{\n  "name": 123,\n  "badge": "缺字段演示",\n  "highlights": "应该是数组但我不是"\n}';

export const PanelContract = component(function PanelContract() {
  const contractSrc = $state(GOOD_SAMPLE);
  const verdict = $state<{ ok: boolean; error?: AtrError } | null>(null);

  const onContractInput = (e: Event) => {
    contractSrc.value = (e.target as HTMLTextAreaElement).value;
  };
  const loadBadSample = () => {
    contractSrc.value = BAD_SAMPLE;
    verdict.value = null;
  };
  const loadGoodSample = () => {
    contractSrc.value = GOOD_SAMPLE;
    verdict.value = null;
  };
  const onValidate = () => {
    try {
      verdict.value = validateUnknown(modelCardSchema, JSON.parse(contractSrc.value), "ModelCard");
    } catch (err) {
      verdict.value = {
        ok: false,
        error: {
          code: "ATR-JSON",
          message: `载荷不是合法 JSON：${(err as Error).message}`,
          context: { component: "PanelContract" },
          fix: "修复 JSON 语法后再校验；对象键名需用双引号包裹",
        },
      };
    }
  };

  return html`
    <div class="ppanel">
      <h3 class="ppanel__title">📐 契约校验 · ATR 四段式</h3>
      <textarea class="contract-input" on:input={onContractInput}>{contractSrc.value}</textarea>
      <div class="ppanel__actions">
        <button class="pbtn pbtn--primary" on:click={onValidate}>▶ 校验载荷</button>
        <button class="pbtn pbtn--warn" on:click={loadBadSample}>装填坏样本 💣</button>
        <button class="pbtn pbtn--ghost" on:click={loadGoodSample}>恢复好样本</button>
      </div>

      {#if verdict.value}
        {#if verdict.value.ok}
          <div class="verd verd--ok">
            <b>✓ PASS</b>
            <span>载荷符合 ModelCard 契约，可选属性 accent 也通过字面量判别式检查。</span>
          </div>
        {:else}
          <div class="verd verd--err">
            <p class="verd__code">{verdict.value.error?.code ?? "ATR-ERR"}</p>
            <p class="verd__msg">{verdict.value.error?.message ?? ""}</p>
            <p class="verd__fix"><b>fix</b> {verdict.value.error?.fix ?? ""}</p>
            {#if verdict.value.error?.context}<code class="verd__ctx">context: {verdict.value.error?.context.component ?? "-"}</code>{/if}
          </div>
        {/if}
      {/if}

      <style scoped>
        .ppanel { background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md) var(--space-lg); animation: panel-in .25s ease; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } }
        .ppanel__title { font-size: 1rem; margin-bottom: var(--space-sm); }
        .ppanel__actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-sm); }
        .pbtn { display: inline-block; border: 0; border-radius: var(--radius-sm); padding: .52rem 1rem; cursor: pointer; font-size: .85rem; font-weight: 600; transition: transform .15s, box-shadow .15s; }
        .pbtn--primary { background: var(--color-primary); color: var(--color-bg); }
        .pbtn--primary:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -12px color-mix(in srgb, var(--color-primary) 80%, transparent); }
        .pbtn--warn { background: var(--color-warn); color: var(--color-bg); }
        .pbtn--ghost { background: transparent; border: 1px solid var(--color-surface-2); color: var(--color-muted); font-weight: 400; }
        .contract-input { width: 100%; height: 128px; background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-surface-2); border-radius: var(--radius-md); padding: var(--space-sm) var(--space-md); font-family: ui-monospace, monospace; font-size: .8rem; resize: vertical; box-sizing: border-box; }
        .contract-input:focus { outline: 2px solid color-mix(in srgb, var(--color-primary) 60%, transparent); border-color: transparent; }
        .verd { margin-top: var(--space-sm); border-radius: var(--radius-md); padding: var(--space-sm) var(--space-md); font-size: .84rem; display: flex; flex-direction: column; gap: .3rem; animation: panel-in .25s ease; }
        .verd--ok { background: color-mix(in srgb, var(--color-ok) 13%, transparent); border: 1px solid color-mix(in srgb, var(--color-ok) 42%, transparent); color: var(--color-ok); }
        .verd--err { background: color-mix(in srgb, var(--color-danger) 11%, transparent); border: 1px solid color-mix(in srgb, var(--color-danger) 46%, transparent); }
        .verd__code { color: var(--color-danger); font-family: ui-monospace, monospace; font-weight: 700; letter-spacing: .06em; }
        .verd__msg { color: var(--color-text); }
        .verd__fix { color: var(--color-muted); }
        .verd__fix b { color: var(--color-warn); margin-right: .4rem; }
        .verd__ctx { color: var(--color-muted); font-size: .74rem; }
      </style>
    </div>
  `.locals({ props: {}, contractSrc, verdict, onContractInput, onValidate, loadBadSample, loadGoodSample });
}, { name: "PanelContract" });
