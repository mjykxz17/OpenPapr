import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { modules } from "@/db/schema";

// Opening a module marks what's in it as read, so the home card's "new"
// count drops back to zero.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleId = Number(id);
  if (!Number.isFinite(moduleId)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  getDb().update(modules).set({ seenAt: Date.now() }).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).run();
  return NextResponse.json({ ok: true });
}
