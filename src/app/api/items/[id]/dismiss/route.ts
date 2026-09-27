import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { and, eq, inArray } from "drizzle-orm";
import { variantGroups } from "@/lib/variants";
import { getDb } from "@/server/db";
import { items } from "@/db/schema";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const it = db.select().from(items).where(and(eq(items.id, Number(id)), eq(items.userId, userId))).get();
  if (!it) return NextResponse.json({ ok: true });
  // Dismissing one form of a per-group set dismisses the set.
  const siblings = it.moduleId !== null && it.type === "assignment"
    ? variantGroups(db.select().from(items).where(and(eq(items.userId, userId), eq(items.moduleId, it.moduleId), eq(items.type, "assignment"))).all()).get(it.id)?.ids ?? [it.id]
    : [it.id];
  db.update(items).set({ dismissed: true }).where(and(eq(items.userId, userId), inArray(items.id, siblings))).run();
  return NextResponse.json({ ok: true });
}
