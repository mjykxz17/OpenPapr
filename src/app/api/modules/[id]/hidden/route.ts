import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { setModuleHidden } from "@/db/repo";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const moduleId = Number(id);
  const body = await request.json().catch(() => null);
  if (!Number.isFinite(moduleId) || typeof body?.hidden !== "boolean") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  setModuleHidden(getDb(), 1, moduleId, body.hidden); // TODO(phase-3): session → userId
  return NextResponse.json({ ok: true });
}
