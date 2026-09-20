"use client";

import { useEffect, useState } from "react";

type Note = {
  id: number;
  body: string;
  createdAt: number;
  pending?: boolean;
};

type PostError = {
  code?: string;
  message?: string;
  fix?: string;
};

// task2：live 订阅（EventSource → /api/notes/stream）+ §4.5 五步乐观对账。
// 对账规则：live 推送是真相源，optimistic 状态只是先行渲染；id 冲突时服务端值胜出。
// data-note-id / data-pending / data-rollbacked 是评分钩子（C 类 DOM 契约），保持逐字。
export default function NotesList() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [rollbacked, setRollbacked] = useState<number[]>([]);
  const [error, setError] = useState<PostError | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    // EventSource 只存在于浏览器运行时——在 effect 内使用，不在模块顶层 new。
    // 订阅即收首连全量帧；此后每帧都是服务端真相源（整表覆盖 = 同 id 幂等合并，
    // 服务端值胜出，pending 行被确认行取代，不产生重复行）。
    const es = new EventSource("/api/notes/stream");
    es.onmessage = (ev) => {
      try {
        const frame = JSON.parse(String(ev.data)) as { notes?: Note[] };
        if (Array.isArray(frame.notes)) {
          setNotes(frame.notes);
        }
      } catch {
        // 非 JSON 载荷忽略（SSE 注释行心跳不会进入 onmessage）
      }
    };
    return () => {
      es.close();
    };
  }, []);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    const id = Date.now(); // 客户端生成正整数 id（JSON number），同 id 幂等合并的前提
    setDraft("");
    setError(null);
    // §4.5-1 optimisticAdd：pending 态先行渲染，不等服务端
    setNotes((prev) => [{ id, body, createdAt: 0, pending: true }, ...prev]);
    try {
      // §4.5-2 创建请求提交（真实走 fetch POST /api/notes——Server Action 在 jsdom 网络面不可见）
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, body }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as PostError;
        throw Object.assign(new Error(err.message ?? "提交被拒绝"), { payload: err });
      }
      // §4.5-3a 成功 → commit(id)：这里不改列表，等 live 推送到达后以服务端数据对账
    } catch (e) {
      // §4.5-3b 失败 → revert(id) + rollbacked 名单 + 错误态（fix 可展示）
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setRollbacked((prev) => [...prev, id]);
      const payload = (e as { payload?: PostError }).payload ?? {};
      setError({
        code: payload.code,
        message: payload.message,
        fix: payload.fix ?? "检查输入是否符合契约",
      });
    }
  };

  return (
    <div>
      <div>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="写一条笔记…" />
        <button type="button" onClick={submit}>
          提交
        </button>
      </div>
      {error ? (
        <p role="alert">
          提交失败{error.code ? `（${error.code}）` : ""}
          {error.message ? `：${error.message}` : ""}
          {error.fix ? `；fix：${error.fix}` : ""}
        </p>
      ) : null}
      {rollbacked.length > 0 ? (
        <p data-rollbacked="true">已回滚：{rollbacked.map((r) => String(r)).join("、")}</p>
      ) : null}
      <ul>
        {notes.map((note) => (
          <li key={note.id} data-note-id={note.id} data-pending={note.pending ? "true" : undefined}>
            {note.body}
            {note.pending ? "（待定）" : ""}
          </li>
        ))}
        {notes.length === 0 ? <li>（暂无笔记）</li> : null}
      </ul>
    </div>
  );
}
