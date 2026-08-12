import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { items } from "@/db/schema";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = 1; // TODO(phase-3): session → userId
  getDb()
    .update(items)
    .set({ dismissed: true })
    .where(and(eq(items.id, Number(id)), eq(items.userId, userId)))
    .run();
  return NextResponse.json({ ok: true });
}
