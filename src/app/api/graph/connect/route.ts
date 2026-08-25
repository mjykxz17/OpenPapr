import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { beginGraphConnect, pollGraphConnect } from "@/server/graph-connect";

// POST starts a device-code grant for the signed-in user; GET polls it.
// Splitting them this way keeps each request short — the browser does the
// waiting, not a held-open connection.
export async function POST() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await beginGraphConnect(userId));
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}

export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await pollGraphConnect(userId));
  } catch (err) {
    return NextResponse.json({ status: "error", error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
