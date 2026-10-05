import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { resolveChange, type ChangeAction } from "@/server/changes";

export const dynamic = "force-dynamic";

const ACTIONS: ChangeAction[] = ["accept", "keep", "undo", "seen", "not_task"];

// Answer one change: use the course's new date, keep yours, undo a move,
// mark it seen, or say newly found work isn't real.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  if (!rateLimit(`changes:${userId}`, 200, 10 * 60_000)) return NextResponse.json({ error: "too many changes" }, { status: 429 });
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const action = ACTIONS.find((a) => a === body.action);
  if (!action) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const ok = resolveChange(getDb(), userId, Number((await params).id), action, Date.now());
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
