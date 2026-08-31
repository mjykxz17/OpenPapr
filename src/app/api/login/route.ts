import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { SESSION_TTL_MS, signSession } from "@/server/auth";
import { hashPassword, normalizeUsername, verifyPassword } from "@/server/password";
import { pruneRateLimits, rateLimit } from "@/server/rate-limit";
import { getDb } from "@/server/db";
import { findByUsername, resolveCanvasUser, setCredentials } from "@/db/repo";
import { createCanvasClient } from "@/connectors/canvas/client";
import { loadEnv, sessionSigningKey } from "@/lib/env";

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

const clientKey = (request: Request) =>
  request.headers.get("fly-client-ip")
  ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  ?? "unknown";

// max-age is what makes the session survive closing the browser; without it
// the cookie is discarded on exit no matter how long the token stays valid.
function withSession(body: object, userId: number, secret: string) {
  const res = NextResponse.json(body);
  res.cookies.set("session", signSession(userId, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: Request) {
  pruneRateLimits();
  if (!rateLimit(`login:${clientKey(request)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "too many attempts, try again later" }, { status: 429 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const env = loadEnv();
  const db = getDb();
  const username = normalizeUsername(str(raw.username));
  const password = str(raw.password);

  // --- returning visit: username and password, no Canvas token needed ---
  if (username && password && !str(raw.canvasToken)) {
    const user = findByUsername(db, username);
    // Verify against a dummy hash when the user is unknown, so a wrong
    // username and a wrong password take the same time to answer.
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return NextResponse.json({ error: "wrong username or password" }, { status: 401 });
    }
    return withSession({ ok: true, name: user.name }, user.id, sessionSigningKey(env));
  }

  // --- first visit, or replacing an expired token: invite code + token ---
  const inviteCode = str(raw.inviteCode);
  const canvasToken = str(raw.canvasToken);
  if (!inviteCode || !canvasToken) {
    return NextResponse.json({ error: "enter your username and password, or an invite code and Canvas token" }, { status: 400 });
  }
  if (!sameSecret(inviteCode, env.APP_PASSWORD)) {
    return NextResponse.json({ error: "that invite code is not valid" }, { status: 401 });
  }

  let self: { id: number; name: string };
  try {
    self = await createCanvasClient(env.CANVAS_BASE_URL, canvasToken).getSelf();
  } catch {
    return NextResponse.json(
      { error: "Canvas rejected that token. Check it was copied whole and has not expired." },
      { status: 401 },
    );
  }
  if (typeof self?.id !== "number") {
    return NextResponse.json({ error: "unexpected response from Canvas" }, { status: 502 });
  }

  const userId = resolveCanvasUser(db, self, canvasToken, env.SECRET_KEY, Date.now());

  // Optional, and the whole point: set these once and later sign-ins need
  // only the username and password.
  let credentialsSaved = false;
  if (username && password) {
    if (password.length < 8) {
      return NextResponse.json({ error: "choose a password of at least 8 characters" }, { status: 400 });
    }
    credentialsSaved = setCredentials(db, userId, username, hashPassword(password));
    if (!credentialsSaved) {
      return NextResponse.json({ error: "that username is already taken" }, { status: 409 });
    }
  }

  return withSession({ ok: true, name: self.name, credentialsSaved }, userId, sessionSigningKey(env));
}

// Cost-matched placeholder so an unknown username cannot be distinguished by
// how quickly the request comes back.
const DUMMY_HASH = hashPassword("never-matches-anything");
