import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { signSession } from "@/server/auth";
import { pruneRateLimits, rateLimit } from "@/server/rate-limit";
import { getDb } from "@/server/db";
import { resolveCanvasUser } from "@/db/repo";
import { createCanvasClient } from "@/connectors/canvas/client";
import { loadEnv, sessionSigningKey } from "@/lib/env";

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

const clientKey = (request: Request) =>
  request.headers.get("fly-client-ip")
  ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  ?? "unknown";

export async function POST(request: Request) {
  pruneRateLimits();
  // Both the invite code and the Canvas token are guessable secrets presented
  // here, so the throttle covers the endpoint as a whole rather than one field.
  if (!rateLimit(`login:${clientKey(request)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "too many attempts, try again later" }, { status: 429 });
  }

  let inviteCode: unknown, canvasToken: unknown;
  try {
    ({ inviteCode, canvasToken } = await request.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  if (typeof inviteCode !== "string" || typeof canvasToken !== "string" || !canvasToken.trim()) {
    return NextResponse.json({ error: "invite code and Canvas token are both required" }, { status: 400 });
  }

  const env = loadEnv();
  if (!sameSecret(inviteCode, env.APP_PASSWORD)) {
    return NextResponse.json({ error: "that invite code is not valid" }, { status: 401 });
  }

  // Canvas is the identity provider: this call both proves the token works and
  // says whose account it is. A typo or a revoked token fails here, before any
  // local account exists.
  const token = canvasToken.trim();
  let self: { id: number; name: string };
  try {
    self = await createCanvasClient(env.CANVAS_BASE_URL, token).getSelf();
  } catch {
    return NextResponse.json(
      { error: "Canvas rejected that token. Check it was copied whole and has not expired." },
      { status: 401 },
    );
  }
  if (typeof self?.id !== "number") {
    return NextResponse.json({ error: "unexpected response from Canvas" }, { status: 502 });
  }

  const userId = resolveCanvasUser(getDb(), self, token, env.SECRET_KEY, Date.now());

  const res = NextResponse.json({ ok: true, name: self.name });
  res.cookies.set("session", signSession(userId, sessionSigningKey(env)), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  return res;
}
