import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { cfgForUser } from "@/server/llm-config";
import { chapterQuiz } from "@/server/guide-quiz";

export const dynamic = "force-dynamic";

// Practice questions for one chapter of this module's guide. {chapter: n,
// fresh?: true} — fresh asks for a new set instead of the saved one.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }
  let body: { chapter?: unknown; fresh?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const chapter = typeof body.chapter === "number" && Number.isInteger(body.chapter) && body.chapter >= 0 ? body.chapter : null;
  if (chapter === null) return NextResponse.json({ error: "which chapter?" }, { status: 400 });
  const fresh = body.fresh === true;
  if (!rateLimit(`quiz:${userId}`, 60, 60 * 60_000)) return NextResponse.json({ error: "That's a lot of quizzes — take a short break and try again." }, { status: 429 });
  const db = getDb();
  const now = Date.now();
  const { id } = await params;
  const out = await chapterQuiz(db, userId, Number(id), chapter, cfgForUser(db, userId, now), now, { fresh });
  return "error" in out ? NextResponse.json({ error: out.error }, { status: out.status }) : NextResponse.json(out);
}
