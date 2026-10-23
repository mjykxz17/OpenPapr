import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import { readSession, signSession } from "./auth";
import { clearSessionCookie, endAllSessions, sessionUserId, setSessionCookie } from "./session";

const key = "ab".repeat(32);

const setup = () => {
  const db = createDb(":memory:");
  const id = db.insert(users).values({ name: "a" }).returning({ id: users.id }).get().id;
  return { db, id };
};

beforeEach(() => {
  vi.stubEnv("SECRET_KEY", key);
  vi.stubEnv("SESSION_KEY", undefined);
  vi.stubEnv("APP_PASSWORD", "invite-code-123");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("sessionUserId", () => {
  it("accepts a session signed with the account's current version", () => {
    const { db, id } = setup();
    expect(sessionUserId(db, signSession(id, key), key)).toBe(id);
  });

  it("refuses every older session once they are all ended", () => {
    const { db, id } = setup();
    const phone = signSession(id, key);
    expect(endAllSessions(db, id)).toBe(1);
    expect(sessionUserId(db, phone, key)).toBeNull();
    expect(sessionUserId(db, signSession(id, key, 60_000, 1), key)).toBe(id);
    expect(endAllSessions(db, id)).toBe(2);
  });

  // The deploy that added versions must not sign anybody out — but once the
  // account ends its sessions, an old-format cookie goes with the rest.
  it("treats a cookie from before versions as version 0", () => {
    const { db, id } = setup();
    const payload = `${id}.${Date.now() + 60_000}`;
    const old = `${payload}.${createHmac("sha256", Buffer.from(key, "hex")).update(payload).digest("hex")}`;
    expect(sessionUserId(db, old, key)).toBe(id);
    endAllSessions(db, id);
    expect(sessionUserId(db, old, key)).toBeNull();
  });

  it("refuses a session for an account that no longer exists", () => {
    const { db, id } = setup();
    const s = signSession(id, key);
    db.delete(users).where(eq(users.id, id)).run();
    expect(sessionUserId(db, s, key)).toBeNull();
  });

  // Switching the demo off stops the visitors already in it, not just new ones.
  it("refuses a demo session while the demo is switched off, and only the demo's", () => {
    const { db, id } = setup();
    const demo = db.insert(users).values({ name: "Alex", isDemo: true }).returning({ id: users.id }).get().id;
    const [mine, theirs] = [signSession(id, key), signSession(demo, key, 24 * 3_600_000)];
    expect(sessionUserId(db, theirs, key)).toBe(demo);
    vi.stubEnv("DEMO_ENABLED", "0");
    expect(sessionUserId(db, theirs, key)).toBeNull();
    expect(sessionUserId(db, mine, key)).toBe(id);
    vi.stubEnv("DEMO_ENABLED", "1");
    expect(sessionUserId(db, theirs, key)).toBe(demo);
  });

  it("refuses no cookie and a bad one", () => {
    const { db, id } = setup();
    expect(sessionUserId(db, undefined, key)).toBeNull();
    expect(sessionUserId(db, signSession(id, "cd".repeat(32)), key)).toBeNull();
  });
});

describe("session cookies", () => {
  it("signs the account's current version, so a re-issued cookie stays signed in", () => {
    const { db, id } = setup();
    endAllSessions(db, id);
    endAllSessions(db, id);
    const res = setSessionCookie(NextResponse.json({}), db, id);
    const c = res.cookies.get("session")!;
    expect(readSession(c.value, key)).toEqual({ userId: id, version: 2 });
    expect(sessionUserId(db, c.value, key)).toBe(id);
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
  });

  it("clearing sets an empty, already-expired cookie", () => {
    const c = clearSessionCookie(NextResponse.json({})).cookies.get("session")!;
    expect(c).toMatchObject({ value: "", maxAge: 0 });
  });
});
