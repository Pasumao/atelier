/**
 * NotesPage.atr.ts — live 直通（§4.4）× optimisticList 乐观对账（§4.5 五步协议）× priority 渲染。
 * DOM 钩子契约（scenario-spec §2）：data-note-id / data-pending / 单 input+button /
 * data-rollbacked 回滚名单 / 错误态含 ATR 码与 fix。
 */
import { $derived, $state, component, html, optimisticList, streamValue } from "../runtime";

type Note = { id: string; body: string; createdAt: number; priority?: number };
type NotesFrame = { notes: Note[] };
type NoteRow = Note & { pending: boolean; origin: "server" | "optimistic" };
type UiError = { code: string; message: string; fix: string };

export const NotesPage = component(function NotesPage() {
  /* §4.4 直通（与 gen endpoint 生成物 live() 同型） */
  const sv = streamValue<NotesFrame>();
  const es = new EventSource("/api/notes.list/live?input=" + encodeURIComponent(JSON.stringify({})));
  es.addEventListener("data", (e) => {
    sv.push(JSON.parse((e as MessageEvent).data) as NotesFrame);
  });
  es.addEventListener("error", (e) => {
    const d = (e as MessageEvent).data;
    if (typeof d === "string" && d.length > 0) {
      try {
        const atr = JSON.parse(d) as { code?: string; message?: string; fix?: string };
        console.error("[atelier] " + (atr.code ?? "ATR-321") + ": " + (atr.message ?? "") + "\nfix: " + (atr.fix ?? ""));
      } catch { /* 连接级错误由 EventSource 自动重连 */ }
    }
  });

  /* §4.5 对账：视图 = 服务端帧 ∪ optimistic 行（同 id 幂等合并，服务端胜出） */
  const list = optimisticList<Note>();
  const lastError = $state<UiError | null>(null);
  const view = $derived<NoteRow[]>(() => {
    const serverNotes = sv.value?.notes ?? [];
    const rows: NoteRow[] = serverNotes.map((n) => ({ ...n, pending: false, origin: "server" as const }));
    const serverIds = new Set(serverNotes.map((n) => n.id));
    for (const entry of list.values) {
      if (serverIds.has(entry.it.id)) continue;
      rows.push({ ...entry.it, pending: entry.status === "pending", origin: "optimistic" as const });
    }
    return rows;
  });

  const draft = $state("");
  const onDraft = (e: Event) => {
    draft.value = (e.target as HTMLInputElement).value;
  };

  const send = () => {
    const body = draft.value.trim();
    if (body.length === 0) return;
    const id = Date.now(); // brief v2：客户端生成正整数（JSON number）——同 id 幂等合并的前提
    draft.value = "";
    list.optimisticAdd({ id, body, createdAt: Date.now() }); // §4.5-1 待定先行渲染
    void submit(id, body); // 异步收敛在事件处理器内（模板表达式零异步）
  };

  const submit = async (id: string, body: string): Promise<void> => {
    try {
      const res = await fetch("/api/notes.create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, body }),
      });
      if (!res.ok) throw await res.json();
      list.commit(id); // §4.5-3a 成功 → commit(id)；正式数据随后由 live 推送对账
      lastError.value = null;
    } catch (e) {
      list.revert(id); // §4.5-3b 失败 → revert(id) + rollbacked 记录 + 错误态（fix 可展示）
      const atr = e as { code?: string; message?: string; fix?: string };
      lastError.value = {
        code: atr.code ?? "ATR-NET",
        message: atr.message ?? String(e),
        fix: atr.fix ?? "确认 server 面在跑后重试",
      };
    }
  };

  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">Notes</h2>
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
      {#if list.rollbacked.length > 0}
        <ul class="list-none m-0 p-0 text-muted text-xs">
          {#each list.rollbacked as rid}
            <li data-rollbacked={rid}>已回滚: {rid}</li>
          {/each}
        </ul>
      {/if}
      <ul class="list-none m-0 p-0">
        {#each view.value as row}
          <li
            class="flex items-center gap-sm py-xs border-b border-surface-2 text-sm"
            data-note-id={row.id}
            data-pending={row.pending ? "true" : null}
          >
            <span>{row.body}</span>
            <span class="text-muted text-xs">priority {row.priority}</span>
            <span class="flex-1"></span>
            <span class="text-muted text-xs">{row.createdAt}</span>
          </li>
        {/each}
      </ul>
    </div>
  `.locals({ sv, list, view, draft, onDraft, send, lastError });
}, { name: "NotesPage" });
