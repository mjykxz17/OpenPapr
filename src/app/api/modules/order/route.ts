import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { setModuleOrder } from "@/db/repo";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) {
    return NextResponse.json({ error: "ids must be an integer array" }, { status: 400 });
  }
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  setModuleOrder(getDb(), userId, ids);
  return NextResponse.json({ ok: true });
}
