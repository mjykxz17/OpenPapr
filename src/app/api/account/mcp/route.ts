import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { demoLocked } from "@/server/demo-guard";
import { requireJson } from "@/server/http";
import { getDb } from "@/server/db";
import { makeMcpKey, removeMcpKey } from "@/server/mcp/token";

// POST makes the key Claude Code reads this account with, replacing any
// earlier one, and returns it — the only time it is ever shown. DELETE
// removes it, cutting every client off.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const refused = demoLocked(userId) ?? requireJson(request);
  if (refused) return refused;
  return NextResponse.json({ ok: true, key: makeMcpKey(getDb(), userId, Date.now()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const locked = demoLocked(userId);
  if (locked) return locked;
  removeMcpKey(getDb(), userId);
  return NextResponse.json({ ok: true });
}
