import { NextResponse } from "next/server";
import { currentUserId } from "@/server/session";
import { DEMO_NO_OUTLOOK, demoLocked } from "@/server/demo-guard";
import { beginGraphConnect, pollGraphConnect } from "@/server/graph-connect";

// POST starts a device-code grant for the signed-in user; GET polls it.
// Splitting them this way keeps each request short — the browser does the
// waiting, not a held-open connection.
// The shared demo account may do neither: a finished poll stores the mailbox
// token, and every other visitor would then read that person's mail.
export async function POST() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const locked = demoLocked(userId, DEMO_NO_OUTLOOK);
  if (locked) return locked;
  try {
    return NextResponse.json(await beginGraphConnect(userId));
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}

export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (demoLocked(userId)) return NextResponse.json({ status: "error", error: DEMO_NO_OUTLOOK }, { status: 403 });
  try {
    return NextResponse.json(await pollGraphConnect(userId));
  } catch (err) {
    return NextResponse.json({ status: "error", error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
