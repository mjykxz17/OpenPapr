import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { users } from "@/db/schema";
import { readSession } from "@/server/auth";
import { hashPassword, needsRehash, verifyPassword } from "@/server/password";
import { LOCK_AFTER, LOCK_MS, resetRateLimits } from "@/server/rate-limit";
import { signSession } from "@/server/auth";
import { sessionUserId } from "@/server/session";

const h = vi.hoisted(() => ({ db: null as unknown as Db, work: [] as number[] }));
vi.mock("@/server/db", () => ({ getDb: () => h.db }));
vi.mock("@/connectors/canvas/client", () => ({ createCanvasClient: () => ({ getSelf: async () => ({ id: 77, name: "Alice" }) }) }));
// Records the scrypt work (N·r·p) of every async hash, so the tests can
// compare what each kind of refusal costs without timing anything.
vi.mock("node:crypto", async (orig) => {
  const real = await orig<typeof import("node:crypto")>();
  const scrypt = (...args: Parameters<typeof real.scrypt>) => {
    const o = args[3] as { N: number; r: number; p: number };
    h.work.push(o.N * o.r * o.p);
    return (real.scrypt as (...a: unknown[]) => void)(...args);
  };
  return { ...real, default: { ...real, scrypt }, scrypt };
});

const { POST } = await import("./route");

const key = "ab".repeat(32);
// "pw-right-1" as hashed with the old cost (N=2^14, r=8, p=1).
const OLD_HASH = "scrypt$16384$8$1$00112233445566778899aabbccddeeff$5badf4af0c9ea5ffb20117795f6cf5ce0ef1ed5f7d2b575bdef814b18f785e9c61b21d8e748ec4b3fdb5a7950cd6bc74fc5ed0a07d7ecab4aa47d8a0ab290e3d";

let ip = 0;
const signIn = (username: string, password: string, from = `10.0.0.${ip}`) =>
  POST(new Request("http://x/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": from },
    body: JSON.stringify({ username, password }),
  }));
const row = (id: number) => h.db.select().from(users).where(eq(users.id, id)).get()!;

let alice: number;
beforeEach(() => {
  vi.stubEnv("SECRET_KEY", key);
  vi.stubEnv("SESSION_KEY", undefined);
  vi.stubEnv("APP_PASSWORD", "invite-code-123");
  resetRateLimits();
  h.work = [];
  ip++;
  h.db = createDb(":memory:");
  alice = h.db.insert(users).values({ name: "Alice", username: "alice", passwordHash: hashPassword("pw-right-1") }).returning({ id: users.id }).get().id;
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("POST /api/login", () => {
  it("signs in with the right password, with a cookie for the account's current version", async () => {
    h.db.update(users).set({ sessionVersion: 4 }).where(eq(users.id, alice)).run();
    const res = await signIn("alice", "pw-right-1");
    expect(res.status).toBe(200);
    const cookie = res.cookies.get("session")!.value;
    expect(readSession(cookie, key)).toEqual({ userId: alice, version: 4 });
    expect(sessionUserId(h.db, cookie, key)).toBe(alice);
  });

  // A lockout must look exactly like a wrong password, or it would tell
  // anyone which usernames exist.
  it("answers an unknown username, a wrong password and a locked account the same way", async () => {
    const unknown = await signIn("nobody", "pw-right-1");
    const wrong = await signIn("alice", "nope-nope");
    for (let i = 1; i < LOCK_AFTER; i++) await signIn("alice", "nope-nope");
    const locked = await signIn("alice", "pw-right-1");
    const bodies = await Promise.all([unknown, wrong, locked].map((r) => r.json()));
    expect([unknown.status, wrong.status, locked.status]).toEqual([401, 401, 401]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(String(bodies[0].error)).toMatch(/wrong username or password/i);
    expect(locked.cookies.get("session")).toBeUndefined();
  });

  it("locks after LOCK_AFTER wrong passwords even across addresses, and lifts after LOCK_MS", async () => {
    for (let i = 0; i < LOCK_AFTER; i++) await signIn("alice", "nope-nope", `10.9.${ip}.${i}`);
    expect((await signIn("alice", "pw-right-1", "10.8.0.1")).status).toBe(401);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + LOCK_MS + 1);
    expect((await signIn("alice", "pw-right-1", "10.8.0.2")).status).toBe(200);
  });

  it("a successful sign-in clears the run of wrong passwords", async () => {
    for (let i = 0; i < LOCK_AFTER - 1; i++) await signIn("alice", "nope-nope");
    expect((await signIn("alice", "pw-right-1")).status).toBe(200);
    expect(row(alice).failedLogins).toBe(0);
  });

  it("keeps the per-address limit", async () => {
    for (let i = 0; i < 10; i++) await signIn("nobody", "x-x-x-x-x");
    expect((await signIn("alice", "pw-right-1")).status).toBe(429);
  });

  it("upgrades a hash made with the old cost on a successful sign-in", async () => {
    h.db.update(users).set({ passwordHash: OLD_HASH }).where(eq(users.id, alice)).run();
    expect((await signIn("alice", "pw-right-1")).status).toBe(200);
    const stored = row(alice).passwordHash;
    expect(stored).not.toBe(OLD_HASH);
    expect(needsRehash(stored)).toBe(false);
    expect(verifyPassword("pw-right-1", stored)).toBe(true);
  });

  // Sent all at once, every request reads the account before any wrong
  // password is recorded; the lockout must still hold.
  it("holds the lockout against a burst of guesses sent at the same time", async () => {
    const guesses = Array.from({ length: LOCK_AFTER + 4 }, (_, i) => signIn("alice", "nope-nope", `10.7.${ip}.${i}`));
    const right = signIn("alice", "pw-right-1", "10.6.0.1");
    const all = await Promise.all([...guesses, right]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
    expect(row(alice).lockedUntil).toBeGreaterThan(Date.now());
  });

  it("makes every refusal cost the same scrypt work, whatever hash the account has", async () => {
    const work = async (username: string, password = "nope-nope") => {
      h.work = [];
      await signIn(username, password, `10.5.${ip}.${Math.random()}`);
      return h.work.reduce((a, b) => a + b, 0);
    };
    const unknown = await work("nobody");
    expect(unknown).toBe(16384 * 8 * 5);
    expect(await work("alice")).toBe(unknown);
    h.db.update(users).set({ passwordHash: OLD_HASH }).where(eq(users.id, alice)).run();
    expect(await work("alice")).toBe(unknown);
    h.db.update(users).set({ lockedUntil: Date.now() + LOCK_MS }).where(eq(users.id, alice)).run();
    expect(await work("alice", "pw-right-1")).toBe(unknown);
  });

  // The way back in for someone who forgot their password, or fears it
  // leaked: it must end the other sessions and the lockout, as Account does.
  it("re-setting the password with the invite code and a Canvas token signs out other devices and lifts the lock", async () => {
    h.db.update(users).set({ canvasUserId: 77, lockedUntil: Date.now() + LOCK_MS, failedLogins: 3 }).where(eq(users.id, alice)).run();
    const otherDevice = signSession(alice, key);
    const res = await POST(new Request("http://x/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", "fly-client-ip": `10.4.0.${ip}` },
      body: JSON.stringify({ inviteCode: "invite-code-123", canvasToken: "tok", username: "alice", password: "brand-new-pw" }),
    }));
    expect(res.status).toBe(200);
    expect(sessionUserId(h.db, otherDevice, key)).toBeNull();
    expect(sessionUserId(h.db, res.cookies.get("session")!.value, key)).toBe(alice);
    expect(row(alice)).toMatchObject({ failedLogins: 0, lockedUntil: null });
    expect((await signIn("alice", "brand-new-pw")).status).toBe(200);
  });
});
