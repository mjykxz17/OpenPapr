import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import {
  LOCK_AFTER, LOCK_MS, loginLocked, pruneRateLimits, rateLimit, recordLoginFailure, recordLoginSuccess, resetRateLimits,
} from "./rate-limit";

beforeEach(resetRateLimits);

describe("rateLimit", () => {
  it("allows up to the limit and then refuses", () => {
    for (let i = 0; i < 5; i++) expect(rateLimit("a", 5, 1000, 0)).toBe(true);
    expect(rateLimit("a", 5, 1000, 0)).toBe(false);
  });

  it("keeps separate counters per key", () => {
    for (let i = 0; i < 5; i++) rateLimit("a", 5, 1000, 0);
    expect(rateLimit("a", 5, 1000, 0)).toBe(false);
    expect(rateLimit("b", 5, 1000, 0)).toBe(true);
  });

  it("lets the caller through again once the window rolls over", () => {
    for (let i = 0; i < 5; i++) rateLimit("a", 5, 1000, 0);
    expect(rateLimit("a", 5, 1000, 999)).toBe(false);
    expect(rateLimit("a", 5, 1000, 1000)).toBe(true);
  });

  it("prunes expired windows so the map cannot grow unbounded", () => {
    rateLimit("a", 5, 1000, 0);
    pruneRateLimits(2000);
    // A pruned key starts a fresh window, so the full budget is available.
    for (let i = 0; i < 5; i++) expect(rateLimit("a", 5, 1000, 2000)).toBe(true);
  });
});

describe("sign-in lockout", () => {
  const setup = () => {
    const db = createDb(":memory:");
    const id = db.insert(users).values({ name: "a", username: "a" }).returning({ id: users.id }).get().id;
    const row = () => db.select().from(users).where(eq(users.id, id)).get()!;
    return { db, id, row };
  };

  it("locks the account after LOCK_AFTER wrong passwords in a row, for LOCK_MS", () => {
    const { db, id, row } = setup();
    for (let i = 0; i < LOCK_AFTER - 1; i++) recordLoginFailure(db, id, 1000);
    expect(loginLocked(row(), 1000)).toBe(false);
    recordLoginFailure(db, id, 1000);
    expect(loginLocked(row(), 1000)).toBe(true);
    expect(loginLocked(row(), 1000 + LOCK_MS - 1)).toBe(true);
    expect(loginLocked(row(), 1000 + LOCK_MS)).toBe(false);
  });

  it("gives a fresh set of tries once the lock lifts", () => {
    const { db, id, row } = setup();
    for (let i = 0; i < LOCK_AFTER; i++) recordLoginFailure(db, id, 0);
    expect(row().failedLogins).toBe(0);
    recordLoginFailure(db, id, LOCK_MS + 1);
    expect(row().lockedUntil).toBe(LOCK_MS);
    expect(loginLocked(row(), LOCK_MS + 1)).toBe(false);
  });

  it("a successful sign-in clears the count", () => {
    const { db, id, row } = setup();
    for (let i = 0; i < LOCK_AFTER - 1; i++) recordLoginFailure(db, id, 0);
    recordLoginSuccess(db, row());
    expect(row()).toMatchObject({ failedLogins: 0, lockedUntil: null });
    // So the next wrong password is the first of a new run, not the last.
    recordLoginFailure(db, id, 0);
    expect(loginLocked(row(), 0)).toBe(false);
  });

  it("ignores an account that does not exist", () => {
    const { db } = setup();
    expect(() => recordLoginFailure(db, 999, 0)).not.toThrow();
  });
});
