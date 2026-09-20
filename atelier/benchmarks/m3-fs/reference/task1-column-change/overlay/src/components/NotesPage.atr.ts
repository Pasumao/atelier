/**
 * NotesPage.atr.ts — 笔记列表页（task1：渲染 priority）。
 * 数据面：src/generated/api.ts 的 notesList 客户端（gen endpoint 产物）——打开页面拉一次的
 * 静态快照；无提交入口（提交/live 对账是 task2/task3 的增量考点）。
 * 异步纪律（ATR-323）：异步收敛在三态原语边界——loadInitial 在组件体触发、streamValue 承接，
 * 模板表达式只读同步信号。
 * 表达式纪律（ATR-301）：模板表达式不支持函数调用与可选链（?.）——行集/计数经 $derived
 * 预计算，模板只读 .value 与属性链。
 * 评分钩子：每行携带 data-note-id="<id>"；priority 出现在行内可见文本。
 * 三元共置：实现（本文件）/ 意图验收（NotesPage.atr.md）。
 */
import { $derived, $state, component, html, streamValue } from "../runtime";
import { notesList } from "../generated/api";

type NoteRow = { id: number; body: string; createdAt: number; priority: number };
type NotesFrame = { notes: NoteRow[] };

export const notesPageSchema = {
  type: "object",
  reqProps: { title: { type: "string" } },
} as const;

export const NotesPage = component(function NotesPage(props: { title: string }) {
  const list = streamValue<NotesFrame>();
  const loadError = $state<string | null>(null);

  const loadInitial = async (): Promise<void> => {
    try {
      const frame = await notesList.call({}); // 非 2xx 抛 ATR 四段式
      list.push(frame);
      list.finish();
    } catch (e) {
      const atr = e as { code?: string; message?: string; fix?: string };
      loadError.value = `${atr.code ?? "ATR-NET"}: ${atr.message ?? String(e)} — fix: ${atr.fix ?? "确认 server 面在跑（pnpm dev 已托管 /api）"}`;
    }
  };
  void loadInitial(); // 异步在边界触发（模板表达式零异步）

  // 模板表达式子集（ATR-301）的预计算面
  const rows = $derived<NoteRow[]>(() => list.value?.notes ?? []);
  const count = $derived<number>(() => rows.value.length);
  const rowCls = "flex items-center gap-sm py-xs border-b border-surface-2 text-sm";

  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">{props.title}</h2>
      <p class="text-muted text-sm">共 {count.value} 条（静态快照——打开页面时拉一次）</p>
      {#if loadError.value}
        <div class="rounded-sm p-sm my-xs border border-danger text-sm text-danger">{loadError.value}</div>
      {/if}
      <ul class="list-none m-0 p-0">
        {#each rows.value as row}
          <li class={rowCls} data-note-id={row.id}>
            <span>{row.body}</span>
            <span class="flex-1"></span>
            <span class="text-muted text-xs">优先级 {row.priority}</span>
            <span class="text-muted text-xs">{row.createdAt}</span>
          </li>
        {/each}
      </ul>
    </div>
  `.locals({ props, rows, count, loadError, rowCls });
}, { name: "NotesPage", schema: notesPageSchema });
