import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { upsertManualComponent } from "@/server/components";

export async function POST(request: Request) {
  const { moduleId, name, weightPct, scorePct } = await request.json();
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = upsertManualComponent(getDb(), userId, { moduleId, name, weightPct: weightPct ?? null, scorePct: scorePct ?? null });
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
