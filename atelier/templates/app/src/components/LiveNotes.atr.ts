/**
 * LiveNotes.atr.ts — FS-7 live 直通示例组件：streamValue + EventSource 手写直通（FS-DESIGN
 * §4.4 形态）× optimisticList 乐观对账（§4.5 协议）的 starter 版落地。
 *
 * 为什么手写直通而不 import 生成物：`atelier gen endpoint` 会在 src/generated/api.ts 生成
 * 同型的 app.notes.live() 客户端（§4.4 代码片段同源）；模板为保 init 即跑零生成步骤，
 * 按同型手写——改线协议时先改 gen-endpoint.mjs 生成片段，再对齐本文件（同型纪律）。
 * 接生成物的替换点：下方「§4.4 直通」段整体换成 `const feed = appNotes.live({})`，
 * sv 三态读面（含 §8.3 error 位读面）与 data/error 语义不变。
 *
 * §4.5 五步对账协议（本组件的考点，.atr.md 为意图验收单）：
 *   1. optimisticAdd(pending) → 先行渲染（半透明 + pending 徽标）
 *   2. fetch POST app.addNote（id 客户端生成随请求上行——同 id 合并的前提）
 *   3a. 成功 → commit(id)
 *   3b. 失败 → revert(id, err) 携带触发错误（§8.3 revertErrors 台账）+ rollbacked 记录 + ATR 错误对象进 UI error 态（fix 可展示）
 *   4. live 推送是真相源：帧到达按 id 幂等合并，服务端值胜出（optimistic 状态只是先行渲染）
 *
 * 三元共置：实现（本文件）/ 意图验收（LiveNotes.atr.md）/ 机检（LiveNotes.atr.spec.ts）。
 */
import { $derived, component, html, optimisticList, streamValue, $state } from "../runtime";

type Note = { id: string; text: string; time: string };
/** live data 帧形态 = app.notes 输出契约（扁平 schema 的 array-of-object 不表——元素结构以端点实现单点为准） */
type NotesFrame = { notes: Note[] };
/** 渲染行 = 服务端帧行 + 未被帧覆盖的 optimistic 行（合并后） */
type NoteRow = Note & { pending: boolean; origin: "server" | "optimistic" };
/** ATR 四段式的 UI 消费子集 */
type UiError = { code: string; message: string; fix: string };

export const liveNotesSchema = {
  type: "object",
  reqProps: { title: { type: "string" } },
} as const;

export const LiveNotes = component(function LiveNotes(props: { title: string }) {
  /* ---- §4.4 直通（与 gen endpoint 生成物 live() 同型：URL 拼接 / data push / error 语义逐行对齐） ---- */
  const sv = streamValue<NotesFrame>();
  const es = new EventSource("/api/app.notes/live?input=" + encodeURIComponent(JSON.stringify({})));
  es.addEventListener("data", (e) => {
    sv.push(JSON.parse((e as MessageEvent).data) as NotesFrame);
  });
  es.addEventListener("error", (e) => {
    // ATR-321 四段式随 error 事件下行；解析后赋 sv.error（§8.3 error 语义位已落地）——
    // fix 由下方 UI 直接渲染为可操作提示（错误即导航贯通到最后一厘米），console 呈现退役；
    // 订阅保持不断流（ATR-321 语义）——下一轮写后失效重算继续推 data。无 data 的 error =
    // 连接级中断，EventSource 按 retry 自动重连（重连即全量重算，语义自愈）。
    const d = (e as MessageEvent).data;
    if (typeof d === "string" && d.length > 0) {
      try {
        sv.error = JSON.parse(d) as { code?: string; message: string; fix?: string };
      } catch {
        /* 非 JSON error 帧——忽略（连接级错误的自动重连由 EventSource 承担） */
      }
    }
  });

  /* ---- §4.5 对账：视图 = 服务端帧 ∪ optimistic 行（同 id 幂等合并，服务端胜出） ---- */
  const list = optimisticList<Note>();
  const lastError = $state<UiError | null>(null);

  const view = $derived<NoteRow[]>(() => {
    const serverNotes = sv.value?.notes ?? [];
    const rows: NoteRow[] = serverNotes.map((n) => ({ ...n, pending: false, origin: "server" as const }));
    const serverIds = new Set(serverNotes.map((n) => n.id));
    for (const entry of list.values) {
      if (serverIds.has(entry.it.id)) continue; // 帧已含此 id：服务端值胜出（§4.5 对账规则）
      rows.push({ ...entry.it, pending: entry.status === "pending", origin: "optimistic" as const });
    }
    return rows;
  });
  /** 待确认数 = 仍处 pending 的 optimistic 项（committed 项等帧对账后自然从视图消失，不重复计） */
  const pendingCount = $derived<number>(() => list.values.reduce((n, e) => (e.status === "pending" ? n + 1 : n), 0));

  const draft = $state("");
  const onDraft = (e: Event) => {
    draft.value = (e.target as HTMLInputElement).value;
  };

  const send = () => {
    const text = draft.value.trim();
    if (text.length === 0) return;
    const id = crypto.randomUUID(); // id 客户端生成随请求上行——§4.5 对账合并的前提
    draft.value = "";
    list.optimisticAdd({ id, text, time: new Date().toISOString() }); // §4.5-1 pending 先行渲染
    void submit(id, text); // 异步在事件处理器内收敛（模板表达式零异步，ATR-323 纪律）
  };

  const submit = async (id: string, text: string): Promise<void> => {
    try {
      // §4.5-2 command POST（同生成物 call() 形态；非 2xx 抛响应体 = ATR 四段式）
      const res = await fetch("/api/app.addNote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, text }),
      });
      if (!res.ok) throw await res.json();
      list.commit(id); // §4.5-3a 成功 → commit(id)；正式数据随后由 live 推送对账到视图
      lastError.value = null;
    } catch (e) {
      // §4.5-3b 失败 → revert(id, err) 携带触发它的 ATR 错误（§8.3：revertErrors 台账，供 toast
      // 展示 fix）+ rollbacked 记录；同一错误对象进 UI error 态（fix 可展示）
      const atr = e as { code?: string; message?: string; fix?: string };
      const uiErr: UiError = {
        code: atr.code ?? "ATR-NET",
        message: atr.message ?? String(e),
        fix: atr.fix ?? "确认 server 面在跑（pnpm dev 已托管 /api）后重试",
      };
      list.revert(id, uiErr);
      lastError.value = uiErr;
    }
  };

  // 行样式全走 token 工具类（决策 16）：pending 视觉区分 = opacity（非新增颜色）
  const rowCls = "flex items-center gap-sm py-xs border-b border-surface-2 text-sm";
  const rowClsPending = rowCls + " opacity-60";

  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">{props.title}</h2>
      <p class="text-muted text-sm">
        live 帧: {sv.values.length} · 待确认: {pendingCount.value} · 已回滚: {list.rollbacked.length}
      </p>
      <div class="flex gap-sm py-xs">
        <input
          class="flex-1 bg-surface border border-surface-2 rounded-sm p-sm text-md"
          placeholder="写一条 note…"
          on:input={onDraft}
        />
        <button class="btn btn-primary" on:click={send}>add note</button>
      </div>
      {#if lastError.value}
        <div class="rounded-sm p-sm my-xs border border-danger text-sm">
          <span class="text-danger font-semibold">{lastError.value.code}</span>
          <span class="text-danger"> {lastError.value.message}</span>
          <span class="text-muted"> — fix: {lastError.value.fix}</span>
        </div>
      {/if}
      {#if sv.error}
        <div class="rounded-sm p-sm my-xs border border-warn text-sm">
          <span class="text-warn font-semibold">{sv.error.code ?? "ATR-321"}</span>
          <span class="text-warn"> {sv.error.message}</span>
          <span class="text-muted"> — fix: {sv.error.fix ?? "订阅保持中，下一轮写后重算自动恢复"}</span>
        </div>
      {/if}
      {#if view.value.length === 0 && sv.values.length === 0}
        <p class="text-muted text-sm">等待首帧…（server 面未跑时保持空且不白屏——EventSource 自动重连）</p>
      {/if}
      <ul class="list-none m-0 p-0">
        {#each view.value as row}
          <li class={row.pending ? rowClsPending : rowCls}>
            <span>{row.text}</span>
            {#if row.pending}<span class="text-warn text-xs">pending</span>{/if}
            <span class="flex-1"></span>
            <span class="text-muted text-xs">{row.time}</span>
          </li>
        {/each}
      </ul>
    </div>
  `.locals({ props, sv, list, view, pendingCount, draft, onDraft, send, lastError, rowCls, rowClsPending });
}, { name: "LiveNotes", schema: liveNotesSchema });
