import { useEffect, useState } from "react";

export interface Call {
  id: string;
  name: string;
  status: string;
}

const STREAM_LINES = [
  '{"id":"t1","name":"search","status":"done"}',
  '{"id":"t2","name":"read","status":"running"}',
  '{"id":"t3","name":"write","status":"error"}',
];

/** 流式数据源：依次推送三行 JSON 后结束。 */
function openCallStream(onLine: (line: string) => void): () => void {
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  STREAM_LINES.forEach((line, i) => {
    timers.push(
      setTimeout(() => {
        if (!cancelled) onLine(line);
      }, (i + 1) * 300),
    );
  });
  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}

/** 解析一行 JSON 为 Call；解析失败或字段缺失的行丢弃。 */
export function parseCallLine(line: string): Call | null {
  try {
    const obj: unknown = JSON.parse(line);
    if (
      obj !== null &&
      typeof obj === "object" &&
      typeof (obj as Record<string, unknown>).id === "string" &&
      typeof (obj as Record<string, unknown>).name === "string" &&
      typeof (obj as Record<string, unknown>).status === "string"
    ) {
      const { id, name, status } = obj as Record<string, string>;
      return { id, name, status };
    }
    return null;
  } catch {
    return null;
  }
}

function badge(status: string): string {
  if (status === "done") return "✓";
  if (status === "error") return "✗";
  return "⏳";
}

export default function App() {
  const [calls, setCalls] = useState<Call[]>([]);

  useEffect(() => {
    const close = openCallStream((line) => {
      const call = parseCallLine(line);
      if (call) {
        setCalls((prev) => {
          // 按 id 去重（keyed），保持流到达顺序
          const next = prev.filter((c) => c.id !== call.id);
          next.push(call);
          return next;
        });
      }
    });
    return close;
  }, []);

  return (
    <main>
      <h1>Tool Call Cards</h1>
      <div className="calls">
        {calls.map((call) => (
          <div className="call" key={call.id}>
            <b>{call.name}</b>
            <span className={`badge badge-${call.status}`}>{badge(call.status)}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
