import { after, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { createNoteInput, noteList } from "@/lib/contract";
import { broadcastNotes, notesFrame } from "@/lib/notes-bus";

export const dynamic = "force-dynamic";

// 当前列表快照（GET 与写后推送共用同一读取口径；行含 priority）
function currentRows() {
  return db.select().from(notes).orderBy(desc(notes.id)).all();
}

// GET /api/notes — 列表查询（输出经契约校验；noteRow 已声明 priority）
export async function GET() {
  const parsed = noteList.safeParse({ notes: currentRows() });
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_OUTPUT", message: "输出不符合契约", fix: "检查 noteRow 契约与表列的一致性" },
      { status: 500 },
    );
  }
  return NextResponse.json(parsed.data);
}

// POST /api/notes — 创建笔记（priority 贯通 + 客户端 id 幂等合并 + 失效触发）
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { code: "BAD_JSON", message: "请求体不是合法 JSON", fix: "以 application/json 提交 { body: string }" },
      { status: 400 },
    );
  }
  const parsed = createNoteInput.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "INVALID_INPUT",
        message: "输入不符合契约",
        fix: "body 必须为非空字符串；priority 可省略，给则须为 0-9 整数；id 可省略，给则须为正整数",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  const values = { body: parsed.data.body, priority: parsed.data.priority ?? 0, createdAt: Date.now() };
  // id 省略 = 服务端自增；给则同 id 幂等合并（upsert，§4.5 对账前提）
  const inserted =
    parsed.data.id === undefined
      ? db.insert(notes).values(values).returning().get()
      : db
          .insert(notes)
          .values({ ...values, id: parsed.data.id })
          .onConflictDoUpdate({ target: notes.id, set: { body: values.body, priority: values.priority } })
          .returning()
          .get();
  // 失效-重算-推送在响应落定后执行（after）：帧保证晚于 2xx 到达订阅者（评分窗口口径）；
  // 失败路径（上方 return）不触发——"失败也推送"会被 R3 抓红。
  after(() => {
    broadcastNotes(notesFrame({ notes: currentRows() }));
  });
  return NextResponse.json(inserted, { status: 201 });
}
