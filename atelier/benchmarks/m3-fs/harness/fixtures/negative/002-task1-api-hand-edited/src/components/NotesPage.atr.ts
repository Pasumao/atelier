/**
 * NotesPage.atr.ts — 笔记列表（基线 + priority 渲染）。
 */
import { $state, component, html } from "../runtime";

type Note = { id: string; body: string; createdAt: number; priority?: number };

export const NotesPage = component(function NotesPage() {
  const notes = $state<Note[]>([]);
  const errorText = $state("");

  const load = async (): Promise<void> => {
    try {
      const res = await fetch("/api/notes.list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw await res.json();
      const data = (await res.json()) as { notes: Note[] };
      notes.value = data.notes;
    } catch (e) {
      const atr = e as { code?: string; message?: string; fix?: string };
      errorText.value = `${atr.code ?? "ATR-NET"}: ${atr.message ?? String(e)} — fix: ${atr.fix ?? "确认 server 面在跑后重试"}`;
    }
  };
  void load();

  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">Notes</h2>
      {#if errorText.value}
        <div class="rounded-sm p-sm my-xs border border-danger text-sm">{errorText.value}</div>
      {/if}
      <ul class="list-none m-0 p-0">
        {#each notes.value as n}
          <li class="flex items-center gap-sm py-xs border-b border-surface-2 text-sm" data-note-id={n.id}>
            <span>{n.body}</span>
            <span class="text-muted text-xs">priority {n.priority}</span>
            <span class="flex-1"></span>
            <span class="text-muted text-xs">{n.createdAt}</span>
          </li>
        {/each}
      </ul>
      {#if notes.value.length === 0}
        <p class="text-muted text-sm">（暂无笔记）</p>
      {/if}
    </div>
  `.locals({ notes, errorText });
}, { name: "NotesPage" });
