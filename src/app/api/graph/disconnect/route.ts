import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { DEMO_NO_OUTLOOK, demoLocked } from "@/server/demo-guard";
import { disconnectGraph } from "@/server/graph-connect";

export async function POST() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const locked = demoLocked(userId, DEMO_NO_OUTLOOK);
  if (locked) return locked;
  disconnectGraph(userId);
  return NextResponse.json({ ok: true });
}
