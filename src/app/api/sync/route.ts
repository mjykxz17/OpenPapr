import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getSyncState, requestSync } from "@/db/repo";

export const dynamic = "force-dynamic";

// POST flags a manual sync for the worker's next tick. It returns the state
// from BEFORE the request so the client can tell this cycle's completion apart
// from an older run's (lastFinishedAt must move past the returned value).
export function POST() {
  const userId = 1; // TODO(phase-3): session → userId
  const db = getDb();
  const before = getSyncState(db, userId, Date.now());
  requestSync(db, userId, Date.now());
  return NextResponse.json({ ok: true, lastFinishedAt: before.lastFinishedAt });
}

export function GET() {
  const userId = 1; // TODO(phase-3): session → userId
  return NextResponse.json(getSyncState(getDb(), userId, Date.now()));
}
