import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { users } from "@/db/schema";

export async function POST() {
  const userId = 1; // TODO(phase-3): session → userId
  getDb().update(users).set({ lastSeenAt: Date.now() }).where(eq(users.id, userId)).run();
  return NextResponse.json({ ok: true });
}
