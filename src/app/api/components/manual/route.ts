import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { requireJson } from "@/server/http";
import { getDb } from "@/server/db";
import { upsertManualComponent } from "@/server/components";

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const notJson = requireJson(request);
  if (notJson) return notJson;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { moduleId, name, weightPct, scorePct } = body;
  const ok = upsertManualComponent(getDb(), userId, { moduleId, name, weightPct: weightPct ?? null, scorePct: scorePct ?? null });
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
