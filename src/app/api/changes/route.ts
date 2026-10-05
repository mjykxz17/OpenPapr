import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { changesFor, markAllSeen } from "@/server/changes";

export const dynamic = "force-dynamic";

// The bell's list, and "Mark all seen".
export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ changes: changesFor(getDb(), userId, Date.now()) });
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "expected a JSON body" }, { status: 415 });
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "seen_all") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  return NextResponse.json({ ok: true, seen: markAllSeen(getDb(), userId, Date.now()) });
}
