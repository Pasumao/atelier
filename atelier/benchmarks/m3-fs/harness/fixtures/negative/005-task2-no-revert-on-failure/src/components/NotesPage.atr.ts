/**
 * NotesPage.atr.ts — 笔记列表页（task2：live 订阅 + §4.5 乐观对账五步协议）。
 * 数据面：src/generated/api.ts 的 notesList（live 直通）+ notesCreate（command）。
 *
 * §4.5 五步对账协议（与模板 LiveNotes 同型，server 版）：
 *   1. optimisticAdd(pending)            → 待定行先行渲染（data-pending="true" + pending 徽标）
 *   2. notesCreate.call({id, body})      → command POST（id 客户端生成、正整数随请求上行）
 *   3a. 成功 → commit(uid)               → 待定转已确认；数据随后由 live 推送对账到视图
 *   3b. 失败 → revert(uid) + rollbacked  → 待定行消失、回滚名单含 id、错误卡 fix 可展示
 *   4. live 推送是真相源：帧到达按 id 幂等合并，服务端值胜出（同 id 不重复、optimistic 只是先行渲染）
 *
 * id 双域纪律：线上域 = number（JSON 契约面）；视图域 = string（optimisticList<T extends
 * {id: string}> 的约束）——帧行在 $derived 中统一 String(id) 后合并，两侧同域方可判等。
 *
 * 表达式纪律（ATR-301）：模板表达式不支持函数调用与可选链（?.）——对账视图/计数在 $derived
 * 预计算，模板只读 .value 与属性链。异步收敛在事件处理器边界（ATR-323）。
 * 评分钩子：行 data-note-id；待定行另带 data-pending="true"；提交入口 = 文本 <input> +
 * 提交按钮；回滚名单元素带 data-rollbacked 且内容含被回滚 id；错误卡含 code/message/fix。
 * 三元共置：实现（本文件）/ 意图验收（NotesPage.atr.md）。
 */
import { $derived, $state, component, html, optimisticList } from "../runtime";
import { notesCreate, notesList } from "../generated/api";

type UiNote = { id: string; body: string; createdAt: number };
type UiRow = UiNote & { isPending: boolean };
/** ATR 四段式的 UI 消费子集 */
type UiError = { code: string; message: string; fix: string };

export const notesPageSchema = {
  type: "object",
  reqProps: { title: { type: "string" } },
} as const;

export const NotesPage = component(function NotesPage(props: { title: string }) {
  // live 直通（§4.4 生成物 live()：SSE data 帧 → 三态值；error 事件 = ATR-321 订阅保持）
  const feed = notesList.live({});
  const list = optimisticList<UiNote>();
  const lastError = $state<UiError | null>(null);

  // §4.5-4 对账视图：服务端帧 ∪ 未被帧覆盖的 optimistic 行（同 id 幂等合并，服务端胜出）
  const rows = $derived<UiRow[]>(() => {
    const serverNotes: UiNote[] = (feed.value?.notes ?? []).map((n) => ({
      id: String(n.id),
      body: n.body,
      createdAt: n.createdAt,
    }));
    const serverIds = new Set(serverNotes.map((n) => n.id));
    const out: UiRow[] = serverNotes.map((n) => ({ ...n, isPending: false }));
    for (const entry of list.values) {
      if (serverIds.has(entry.it.id)) continue; // 帧已含此 id：服务端值胜出
      out.push({ ...entry.it, isPending: entry.status === "pending" });
    }
    return out;
  });
  const pendingCount = $derived<number>(() => list.values.reduce((n, e) => (e.status === "pending" ? n + 1 : n), 0));
  const rowCls = "flex items-center gap-sm py-xs border-b border-surface-2 text-sm";
  const rowClsPending = rowCls + " opacity-60";

  const draft = $state("");
  const onDraft = (e: Event) => {
    draft.value = (e.target as HTMLInputElement).value;
  };

  const send = () => {
    const body = draft.value.trim();
    if (body.length === 0) return;
    const id = Date.now(); // 客户端生成正整数 id（JSON number 上行——同 id 幂等合并的前提）
    const uid = String(id); // 视图域字符串 id（optimisticList 约束）
    draft.value = "";
    list.optimisticAdd({ id: uid, body, createdAt: 0 }); // §4.5-1 pending 先行渲染
    void submit(id, uid, body); // 异步在事件处理器内收敛（模板表达式零异步，ATR-323）
  };

  const submit = async (id: number, uid: string, body: string): Promise<void> => {
    try {
      await notesCreate.call({ id, body }); // §4.5-2 command POST（非 2xx 抛 ATR 四段式）
      list.commit(uid); // §4.5-3a 成功 → commit；行保留，等 live 帧对账到服务端值
      lastError.value = null;
    } catch (e) {
      // （负控变异：失败路径静默吞掉——无 revert、无回滚名单、无错误卡：C2 必须抓红）
      void e;
      return;
      const atr = e as { code?: string; message?: string; fix?: string };
      lastError.value = {
        code: atr.code ?? "ATR-NET",
        message: atr.message ?? String(e),
        fix: atr.fix ?? "确认 server 面在跑（pnpm dev 已托管 /api）后重试",
      };
    }
  };

  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">{props.title}</h2>
      <p class="text-muted text-sm">
        共 {rows.value.length} 条 · 待确认 {pendingCount.value} · 已回滚 {list.rollbacked.length} · live 帧 {feed.values.length}
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
      <ul class="list-none m-0 p-0">
        {#each rows.value as row}
          <li class={row.isPending ? rowClsPending : rowCls} data-note-id={row.id} data-pending={row.isPending ? "true" : null}>
            <span>{row.body}</span>
            {#if row.isPending}<span class="text-warn text-xs">pending</span>{/if}
            <span class="flex-1"></span>
            <span class="text-muted text-xs">{row.createdAt}</span>
          </li>
        {/each}
      </ul>
      {#if list.rollbacked.length > 0}
        <p class="text-xs text-muted m-0">回滚名单：</p>
        <ul class="list-none m-0 p-0 text-xs text-muted">
          {#each list.rollbacked as rid}
            <li data-rollbacked="true">已回滚 id {rid}</li>
          {/each}
        </ul>
      {/if}
    </div>
  `.locals({ props, feed, list, rows, pendingCount, rowCls, rowClsPending, draft, onDraft, send, lastError });
}, { name: "NotesPage", schema: notesPageSchema });
