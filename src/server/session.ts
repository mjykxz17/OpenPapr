import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";
import { SESSION_TTL_MS, readSession, signSession } from "./auth";
import { loadEnv, sessionSigningKey } from "@/lib/env";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { Db } from "@/db/client";
import { getDb } from "./db";

// The account a session cookie belongs to, or null. A signed cookie outlives
// a deleted account, and one signed before the account's last password change
// or "sign out everywhere" carries an older version — neither is accepted.
export function sessionUserId(db: Db, value: string | undefined, secretHex: string): number | null {
  const s = readSession(value, secretHex);
  if (!s) return null;
  const row = db.select({ version: users.sessionVersion }).from(users).where(eq(users.id, s.userId)).get();
  return row && row.version === s.version ? s.userId : null;
}

// The authenticated user, or null. The proxy already turns anonymous traffic
// away, so a null here means a session that expired or was signed out between
// the gate and the handler — or a caller reached directly. Either way there is
// no default user to fall back to.
export async function currentUserId(): Promise<number | null> {
  const jar = await cookies();
  return sessionUserId(getDb(), jar.get("session")?.value, sessionSigningKey(loadEnv()));
}

// For server components: sends the visitor to sign in rather than rendering
// somebody else's dashboard.
export async function requireUserId(): Promise<number> {
  const id = await currentUserId();
  if (id === null) redirect("/login");
  return id;
}

// Retires every session the account has, on every device, and returns the new
// version for a cookie that should stay signed in.
export function endAllSessions(db: Db, userId: number): number {
  return db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId)).returning({ v: users.sessionVersion }).get()?.v ?? 0;
}

// max-age is what makes the session survive closing the browser; without it
// the cookie is discarded on exit no matter how long the token stays valid.
export function setSessionCookie(res: NextResponse, db: Db, userId: number, ttlMs = SESSION_TTL_MS): NextResponse {
  const version = db.select({ v: users.sessionVersion }).from(users).where(eq(users.id, userId)).get()?.v ?? 0;
  res.cookies.set("session", signSession(userId, sessionSigningKey(loadEnv()), ttlMs, version), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set("session", "", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 0 });
  return res;
}

// The public demo account is shared by everyone who opens it, so its
// settings stay as they are.
export function isDemoUser(userId: number, db: Db = getDb()): boolean {
  return Boolean(db.select({ d: users.isDemo }).from(users).where(eq(users.id, userId)).get()?.d);
}
export const DEMO_LOCKED = "This is the shared demo account, so its settings can't be changed. Create your own account to connect Canvas and an AI key.";
