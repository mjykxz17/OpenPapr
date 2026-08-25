import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { users } from "@/db/schema";

export async function POST() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  getDb().update(users).set({ lastSeenAt: Date.now() }).where(eq(users.id, userId)).run();
  return NextResponse.json({ ok: true });
}
