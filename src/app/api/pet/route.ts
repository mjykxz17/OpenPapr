import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/server/db";
import { currentUserId } from "@/server/session";
import { modules } from "@/db/schema";
import { canGenerateGuides } from "@/server/llm-access";
import { quips, reminders } from "@/server/pet";

export const dynamic = "force-dynamic";

// What the pet may say on its own: reminders from the student's real data,
// and a pool of one-liners. The browser picks from these at random times.
export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const now = Date.now();
  const codes = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true), eq(modules.hidden, false))).all().map((m) => m.code);
  return NextResponse.json({ reminders: reminders(db, userId, now), quips: quips(codes, now), smart: canGenerateGuides(db, userId) });
}
