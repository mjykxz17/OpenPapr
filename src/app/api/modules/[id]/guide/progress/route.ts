import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { markChapter, readProgress } from "@/server/guide-progress";

export const dynamic = "force-dynamic";

// Which chapters of this module's guide the student has read: {read: [true,
// false, …]}, one per chapter. POST {chapter: n, read: true|false} marks one
// and replies with the new list. The demo account may use it too; its nightly
// reset clears it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const out = readProgress(getDb(), userId, Number((await params).id));
  return "error" in out ? NextResponse.json({ error: out.error }, { status: out.status }) : NextResponse.json(out);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }
  let body: { chapter?: unknown; read?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const chapter = typeof body.chapter === "number" && Number.isInteger(body.chapter) && body.chapter >= 0 ? body.chapter : null;
  if (chapter === null || typeof body.read !== "boolean") return NextResponse.json({ error: "which chapter?" }, { status: 400 });
  const out = markChapter(getDb(), userId, Number((await params).id), chapter, body.read, Date.now());
  return "error" in out ? NextResponse.json({ error: out.error }, { status: out.status }) : NextResponse.json(out);
}
