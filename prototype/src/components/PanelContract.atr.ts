/**
 * PanelContract.atr.ts — 实验台：契约校验 · ATR 四段式结构化渲染。
 * 【决策 16】样式迁移至 .ppanel/.btn recipe + 工具类；scoped 已清空。
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
      <h3 class="text-base mb-sm">📐 契约校验 · ATR 四段式</h3>
      <textarea class="w-full h-32 bg-bg text-text border border-surface-2 rounded-md px-md py-sm font-mono text-sm resize-y box-border outline-none focus:outline-[2px] focus:outline-primary/60" on:input={onContractInput}>{contractSrc.value}</textarea>
      <div class="flex flex-wrap gap-sm mt-sm">
        <button class="btn btn-primary" on:click={onValidate}>▶ 校验载荷</button>
        <button class="btn btn-warn" on:click={loadBadSample}>装填坏样本 💣</button>
        <button class="btn btn-ghost" on:click={loadGoodSample}>恢复好样本</button>
      </div>

      {#if verdict.value}
        {#if verdict.value.ok}
          <div class="mt-sm rounded-md px-md py-sm text-sm flex flex-col gap-[.3rem] animate-[panel-in_.25s_ease] bg-ok/13 border border-ok/42 text-ok">
            <b>✓ PASS</b>
            <span>载荷符合 ModelCard 契约，可选属性 accent 也通过字面量判别式检查。</span>
          </div>
        {:else}
          <div class="mt-sm rounded-md px-md py-sm text-sm flex flex-col gap-[.3rem] animate-[panel-in_.25s_ease] bg-danger/11 border border-danger/46">
            <p class="text-danger font-mono font-bold tracking-wider">{verdict.value.error?.code ?? "ATR-ERR"}</p>
            <p class="text-text">{verdict.value.error?.message ?? ""}</p>
            <p class="text-muted"><b class="text-warn mr-1">fix</b> {verdict.value.error?.fix ?? ""}</p>
            {#if verdict.value.error?.context}<code class="text-xs text-muted">context: {verdict.value.error?.context.component ?? "-"}</code>{/if}
          </div>
        {/if}
      {/if}
    </div>
  `.locals({ props: {}, contractSrc, verdict, onContractInput, onValidate, loadBadSample, loadGoodSample });
}, { name: "PanelContract" });
