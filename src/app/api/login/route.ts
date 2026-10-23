import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { hashPassword, hashPasswordAsync, needsRehash, normalizeUsername, verifyPasswordAsync } from "@/server/password";
import { loginLocked, pruneRateLimits, rateLimit, recordLoginFailure, recordLoginSuccess } from "@/server/rate-limit";
import { setSessionCookie } from "@/server/session";
import { getDb } from "@/server/db";
import { users } from "@/db/schema";
import { createLocalUser, findByUsername, resolveCanvasUser, setCredentials } from "@/db/repo";
import { createCanvasClient } from "@/connectors/canvas/client";
import { loadEnv } from "@/lib/env";

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

const clientKey = (request: Request) =>
  request.headers.get("fly-client-ip")
  ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  ?? "unknown";

const withSession = (body: object, userId: number) => setSessionCookie(NextResponse.json(body), getDb(), userId);

// One answer for an unknown username, a wrong password and a locked account,
// so none of them reveals which usernames exist.
const SIGN_IN_REFUSED = "Wrong username or password. After several wrong tries in a row, sign-in pauses for 15 minutes.";

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
  if (username && password && !str(raw.canvasToken) && !str(raw.inviteCode)) {
    const user = findByUsername(db, username);
    const now = Date.now();
    // Verify against a dummy hash when the user is unknown — and even when the
    // account is locked — so every refusal takes the same time to answer.
    const ok = await verifyPasswordAsync(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || loginLocked(user, now) || !ok) {
      if (user && !loginLocked(user, now)) recordLoginFailure(db, user.id, now);
      // A hash from before the cost went up checks faster than the dummy;
      // pay the difference so a quick refusal does not mark a real username.
      if (user?.passwordHash && needsRehash(user.passwordHash)) await verifyPasswordAsync(password, DUMMY_HASH);
      return NextResponse.json({ error: SIGN_IN_REFUSED }, { status: 401 });
    }
    recordLoginSuccess(db, user);
    // Hashes made with older, cheaper settings are upgraded while the
    // password is at hand; this is the only moment it is.
    if (needsRehash(user.passwordHash)) {
      db.update(users).set({ passwordHash: await hashPasswordAsync(password) }).where(eq(users.id, user.id)).run();
    }
    return withSession({ ok: true, name: user.name }, user.id);
  }

  // --- first visit: the invite code, then a Canvas token and/or a username ---
  const inviteCode = str(raw.inviteCode);
  const canvasToken = str(raw.canvasToken);
  if (!inviteCode || (!canvasToken && !(username && password))) {
    return NextResponse.json({ error: "enter your username and password, or an invite code with a username and password" }, { status: 400 });
  }
  if (!sameSecret(inviteCode, env.APP_PASSWORD)) {
    return NextResponse.json({ error: "that invite code is not valid" }, { status: 401 });
  }

  // No Canvas yet: an account with just a username and password. Canvas can
  // be connected later, from the welcome steps or Account.
  if (!canvasToken) {
    if (password.length < 8) return NextResponse.json({ error: "choose a password of at least 8 characters" }, { status: 400 });
    if (findByUsername(db, username)) return NextResponse.json({ error: "that username is already taken" }, { status: 409 });
    const userId = createLocalUser(db, username, await hashPasswordAsync(password), Date.now());
    return withSession({ ok: true, name: username, credentialsSaved: true, created: true }, userId);
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
    credentialsSaved = setCredentials(db, userId, username, await hashPasswordAsync(password));
    if (!credentialsSaved) {
      return NextResponse.json({ error: "that username is already taken" }, { status: 409 });
    }
  }

  return withSession({ ok: true, name: self.name, credentialsSaved }, userId);
}

// Cost-matched placeholder so an unknown username cannot be distinguished by
// how quickly the request comes back.
const DUMMY_HASH = hashPassword("never-matches-anything");
