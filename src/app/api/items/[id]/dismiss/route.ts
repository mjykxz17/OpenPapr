import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { items } from "@/db/schema";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  getDb()
    .update(items)
    .set({ dismissed: true })
    .where(and(eq(items.id, Number(id)), eq(items.userId, userId)))
    .run();
  return NextResponse.json({ ok: true });
}
