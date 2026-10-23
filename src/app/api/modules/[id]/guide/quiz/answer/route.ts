import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { recordAnswer } from "@/server/guide-quiz";

export const dynamic = "force-dynamic";

const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

// One answer to a chapter's practice question: {chapter, set, question,
// chosen}. Kept so a reload shows it and so missed slides come back; replies
// {correct, answer}. The demo account keeps answers too, until its nightly reset.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  }
  let body: { chapter?: unknown; set?: unknown; question?: unknown; chosen?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const chapter = int(body.chapter), question = int(body.question), chosen = int(body.chosen);
  const set = typeof body.set === "string" && /^[0-9a-f]{32}$/.test(body.set) ? body.set : null;
  if (chapter === null || question === null || chosen === null || set === null) return NextResponse.json({ error: "invalid answer" }, { status: 400 });
  if (!rateLimit(`quiz-answer:${userId}`, 300, 10 * 60_000)) return NextResponse.json({ error: "Slow down a little — try again in a minute." }, { status: 429 });
  const { id } = await params;
  const out = recordAnswer(getDb(), userId, Number(id), { chapter, set, question, chosen }, Date.now());
  return "error" in out ? NextResponse.json({ error: out.error }, { status: out.status }) : NextResponse.json(out);
}
