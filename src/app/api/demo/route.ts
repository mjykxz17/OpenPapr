import { NextResponse } from "next/server";
import { SESSION_TTL_MS, signSession } from "@/server/auth";
import { getDb } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { demoEnabled, demoUserId } from "@/server/demo";
import { loadEnv, sessionSigningKey } from "@/lib/env";

export const dynamic = "force-dynamic";

// "Try the demo": signs the visitor into the shared demo account, making it
// (or giving it its nightly reset) first if need be. A shorter session than a
// real account's, since nobody needs to stay in a demo for a month.
export async function POST(request: Request) {
  if (!demoEnabled()) return NextResponse.json({ error: "the demo is switched off on this server" }, { status: 404 });
  const ip = request.headers.get("fly-client-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`demo:${ip}`, 20, 10 * 60_000)) return NextResponse.json({ error: "too many tries, wait a few minutes" }, { status: 429 });
  const userId = await demoUserId(getDb(), Date.now());
  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", signSession(userId, sessionSigningKey(loadEnv()), 24 * 3_600_000), {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: Math.floor(Math.min(SESSION_TTL_MS, 24 * 3_600_000) / 1000),
  });
  return res;
}
