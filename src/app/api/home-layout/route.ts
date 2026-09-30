import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { users } from "@/db/schema";
import { normalizeLayout } from "@/lib/home-layout";

// Saves the home screen: which widgets, in what order, at what size.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.layout)) return NextResponse.json({ error: "layout must be an array" }, { status: 400 });
  const layout = normalizeLayout(body.layout);
  getDb().update(users).set({ homeLayoutJson: JSON.stringify(layout) }).where(eq(users.id, userId)).run();
  return NextResponse.json({ ok: true, layout });
}

// Back to the default layout.
export async function DELETE() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  getDb().update(users).set({ homeLayoutJson: null }).where(eq(users.id, userId)).run();
  return NextResponse.json({ ok: true });
}
