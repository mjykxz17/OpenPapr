import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { users } from "@/db/schema";
import { calendarToken } from "@/server/calendar";

// POST makes (or with {reset:true} replaces) the private feed link; DELETE
// turns the feed off.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { reset?: unknown } | null;
  const token = calendarToken(getDb(), userId, body?.reset === true);
  return NextResponse.json({ ok: true, path: `/api/calendar/feed/${token}.ics` });
}

export async function DELETE() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  getDb().update(users).set({ calendarToken: null }).where(eq(users.id, userId)).run();
  return NextResponse.json({ ok: true });
}
