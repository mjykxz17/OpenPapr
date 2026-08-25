import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { setModuleHidden } from "@/db/repo";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  const body = await request.json().catch(() => null);
  if (!Number.isFinite(moduleId) || typeof body?.hidden !== "boolean") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  setModuleHidden(getDb(), userId, moduleId, body.hidden);
  return NextResponse.json({ ok: true });
}
