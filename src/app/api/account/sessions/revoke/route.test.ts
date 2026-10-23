import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { users } from "@/db/schema";
import { signSession } from "@/server/auth";
import { resetRateLimits } from "@/server/rate-limit";
import { sessionUserId } from "@/server/session";

const h = vi.hoisted(() => ({ db: null as unknown as Db, cookie: undefined as string | undefined }));
vi.mock("@/server/db", () => ({ getDb: () => h.db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "session" && h.cookie ? { value: h.cookie } : undefined) }) }));

const { POST } = await import("./route");

const key = "ab".repeat(32);
const revoke = () => POST(new Request("http://x/api/account/sessions/revoke", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
}));

let id: number;
beforeEach(() => {
  vi.stubEnv("SECRET_KEY", key);
  vi.stubEnv("SESSION_KEY", undefined);
  vi.stubEnv("APP_PASSWORD", "invite-code-123");
  resetRateLimits();
  h.db = createDb(":memory:");
  id = h.db.insert(users).values({ name: "a" }).returning({ id: users.id }).get().id;
  h.cookie = signSession(id, key);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("POST /api/account/sessions/revoke", () => {
  it("signs the account out everywhere, this device included", async () => {
    const phone = signSession(id, key);
    const res = await revoke();
    expect(res.status).toBe(200);
    expect(sessionUserId(h.db, phone, key)).toBeNull();
    expect(sessionUserId(h.db, h.cookie, key)).toBeNull();
    expect(res.cookies.get("session")).toMatchObject({ value: "", maxAge: 0 });
  });

  // One visitor of the shared demo must not sign out all the others.
  it("refuses the demo account", async () => {
    h.db.update(users).set({ isDemo: true }).where(eq(users.id, id)).run();
    expect((await revoke()).status).toBe(403);
    expect(sessionUserId(h.db, h.cookie, key)).toBe(id);
  });

  it("refuses a session that was already signed out", async () => {
    await revoke();
    expect((await revoke()).status).toBe(401);
  });
});
