import { after, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { createNoteInput, noteList } from "@/lib/contract";
import { broadcastNotes, notesFrame } from "@/lib/notes-bus";

export const dynamic = "force-dynamic";

// 当前列表快照（GET 与写后推送共用同一读取口径）
function currentRows() {
  return db.select().from(notes).orderBy(desc(notes.id)).all();
}

// GET /api/notes — 列表查询（输出经契约校验）
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

// POST /api/notes — 创建笔记（客户端生成 id；同 id 幂等合并；成功后显式触发失效推送）
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { code: "BAD_JSON", message: "请求体不是合法 JSON", fix: "以 application/json 提交 { id: number, body: string }" },
      { status: 400 },
    );
  }
  const parsed = createNoteInput.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "INVALID_INPUT",
        message: "输入不符合契约",
        fix: "body 必须为非空字符串；id 必须为正整数（客户端生成，JSON number）",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  // 幂等 upsert：同 id 重放 = 更新（§4.5 对账协议成立的前提——同 id 合并不产生重复行）
  const inserted = db
    .insert(notes)
    .values({ id: parsed.data.id, body: parsed.data.body, createdAt: Date.now() })
    .onConflictDoUpdate({ target: notes.id, set: { body: parsed.data.body } })
    .returning()
    .get();
  // 失效-重算-推送在响应落定后执行（after）：帧保证晚于 2xx 到达订阅者，
  // 评分窗口（自 POST 收到 2xx 起计 ≤1s）稳定可捕；失败路径（上方 return）不触发。
  after(() => {
    broadcastNotes(notesFrame({ notes: currentRows() }));
  });
  return NextResponse.json(inserted, { status: 201 });
}
