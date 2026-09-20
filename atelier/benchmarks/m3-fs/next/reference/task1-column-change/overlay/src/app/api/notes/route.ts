import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { createNoteInput, noteList } from "@/lib/contract";

export const dynamic = "force-dynamic";

// GET /api/notes — 列表查询（输出经契约校验；noteRow 已声明 priority，列表读出）
export async function GET() {
  const rows = db.select().from(notes).orderBy(desc(notes.id)).all();
  const parsed = noteList.safeParse({ notes: rows });
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_OUTPUT", message: "输出不符合契约", fix: "检查 noteRow 契约与表列的一致性" },
      { status: 500 },
    );
  }
  return NextResponse.json(parsed.data);
}

// POST /api/notes — 创建笔记（契约违规 → 结构化 400：code/message/fix + issues）
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
        fix: "body 必须是非空字符串；priority 可省略，给则须为 0-9 整数",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  const inserted = db
    .insert(notes)
    .values({ body: parsed.data.body, priority: parsed.data.priority ?? 0, createdAt: Date.now() })
    .returning()
    .get();
  return NextResponse.json(inserted, { status: 201 });
}
