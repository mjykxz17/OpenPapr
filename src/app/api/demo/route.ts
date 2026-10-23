import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { demoEnabled, demoUserId } from "@/server/demo";
import { setSessionCookie } from "@/server/session";

export const dynamic = "force-dynamic";

// "Try the demo": signs the visitor into the shared demo account, making it
// (or giving it its nightly reset) first if need be. A shorter session than a
// real account's, since nobody needs to stay in a demo for a month. Signed
// with the account's current version like any other, so ending its sessions
// ends these too.
export async function POST(request: Request) {
  if (!demoEnabled()) return NextResponse.json({ error: "the demo is switched off on this server" }, { status: 404 });
  const ip = request.headers.get("fly-client-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`demo:${ip}`, 20, 10 * 60_000)) return NextResponse.json({ error: "too many tries, wait a few minutes" }, { status: 429 });
  const db = getDb();
  const userId = await demoUserId(db, Date.now());
  return setSessionCookie(NextResponse.json({ ok: true }), db, userId, 24 * 3_600_000);
}
