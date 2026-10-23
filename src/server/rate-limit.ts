import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";

// Fixed-window limiter, in memory. The app runs as a single Next server
// process, so one map is the whole picture; if this ever runs on more than one
// machine it must move into the database.
type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) return false;
  w.count++;
  return true;
}

// Drops windows that have already expired. Called opportunistically so the map
// cannot grow without bound across many distinct client addresses.
export function pruneRateLimits(now = Date.now()): void {
  for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
}

export function resetRateLimits(): void {
  windows.clear();
}

// --- per-account sign-in lockout -----------------------------------------
// The per-address limit above lives in memory and resets when the machine
// sleeps, and an attacker with many addresses never meets it. This one is on
// the account row: after LOCK_AFTER wrong passwords in a row the account
// refuses every sign-in, right or wrong, for LOCK_MS. The answer looks the
// same as a wrong password, so a lockout does not tell anyone the username
// exists.
export const LOCK_AFTER = 8;
export const LOCK_MS = 15 * 60_000;

export function loginLocked(user: { lockedUntil: number | null }, now = Date.now()): boolean {
  return user.lockedUntil !== null && user.lockedUntil > now;
}

export function recordLoginFailure(db: Db, userId: number, now = Date.now()): void {
  const row = db.select({ n: users.failedLogins }).from(users).where(eq(users.id, userId)).get();
  if (!row) return;
  const n = row.n + 1;
  // The count starts again once the lock is set, so after it lifts there are
  // another LOCK_AFTER tries before the next one.
  db.update(users).set(n >= LOCK_AFTER ? { failedLogins: 0, lockedUntil: now + LOCK_MS } : { failedLogins: n })
    .where(eq(users.id, userId)).run();
}

export function recordLoginSuccess(db: Db, user: { id: number; failedLogins: number; lockedUntil: number | null }): void {
  if (user.failedLogins === 0 && user.lockedUntil === null) return;
  db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id)).run();
}
