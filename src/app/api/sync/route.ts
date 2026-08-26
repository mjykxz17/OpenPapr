import { NextResponse } from "next/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { currentUserId } from "@/server/session";
import { getDb } from "@/server/db";
import { requestSync } from "@/db/repo";
import { syncRuns, users } from "@/db/schema";

export const dynamic = "force-dynamic";

// POST asks for a sync; GET reports whether one is pending or running, so the
// button can show progress. State is derived from the flag and sync_runs
// rather than held in memory, because the web server and the worker are
// separate processes — nothing in here can see the worker's variables.
export async function POST() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  requestSync(getDb(), userId, Date.now());
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();

  const me = db.select().from(users).where(eq(users.id, userId)).get();
  const pending = Boolean(me?.syncRequestedAt);

  // A run with no finishedAt is still in flight. Bounded to the recent past so
  // a row orphaned by a crash cannot leave the button spinning forever.
  const cutoff = Date.now() - 10 * 60_000;
  const running = db.select().from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), gt(syncRuns.startedAt, cutoff)))
    .all().some((r) => r.finishedAt === null);

  const last = db.select().from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), eq(syncRuns.source, "canvas")))
    .orderBy(desc(syncRuns.id)).limit(1).get();

  return NextResponse.json({
    pending,
    running,
    lastFinishedAt: last?.finishedAt ?? null,
    lastOk: last?.ok ?? null,
    lastError: last?.error ?? null,
  });
}
