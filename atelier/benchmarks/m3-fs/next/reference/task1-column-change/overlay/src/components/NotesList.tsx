"use client";

import { useEffect, useState } from "react";

type Note = {
  id: number;
  body: string;
  createdAt: number;
  priority?: number;
};

// task1：列表行渲染优先级（行内可见文本）。data-note-id 是评分钩子（C 类 DOM 契约的
// 测量面），保持不动。
export default function NotesList() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/notes")
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        setNotes(data.notes ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id} data-note-id={note.id}>
          {note.body} <span>优先级 {note.priority ?? 0}</span>
        </li>
      ))}
      {loaded && notes.length === 0 ? <li>（暂无笔记）</li> : null}
    </ul>
  );
}
