import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { disconnectGraph } from "@/server/graph-connect";

export async function POST() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  disconnectGraph(userId);
  return NextResponse.json({ ok: true });
}
