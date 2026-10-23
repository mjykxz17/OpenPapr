import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { users } from "@/db/schema";
import { signSession } from "@/server/auth";
import { hashPassword, verifyPassword } from "@/server/password";
import { resetRateLimits } from "@/server/rate-limit";
import { sessionUserId } from "@/server/session";

const h = vi.hoisted(() => ({ db: null as unknown as Db, cookie: undefined as string | undefined }));
vi.mock("@/server/db", () => ({ getDb: () => h.db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "session" && h.cookie ? { value: h.cookie } : undefined) }) }));

const { PUT } = await import("./route");

const key = "ab".repeat(32);
const change = (body: object) => PUT(new Request("http://x/api/account/password", {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

let id: number;
beforeEach(() => {
  vi.stubEnv("SECRET_KEY", key);
  vi.stubEnv("SESSION_KEY", undefined);
  vi.stubEnv("APP_PASSWORD", "invite-code-123");
  resetRateLimits();
  h.db = createDb(":memory:");
  id = h.db.insert(users).values({ name: "a", username: "alice", passwordHash: hashPassword("old-password") }).returning({ id: users.id }).get().id;
  h.cookie = signSession(id, key);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("PUT /api/account/password", () => {
  it("signs out every other device and keeps this one signed in", async () => {
    const otherDevice = signSession(id, key);
    const res = await change({ currentPassword: "old-password", newPassword: "new-password" });
    expect(res.status).toBe(200);
    expect(sessionUserId(h.db, otherDevice, key)).toBeNull();
    expect(sessionUserId(h.db, res.cookies.get("session")!.value, key)).toBe(id);
    expect(verifyPassword("new-password", h.db.select().from(users).where(eq(users.id, id)).get()!.passwordHash)).toBe(true);
  });

  it("leaves sessions alone when the current password is wrong", async () => {
    const res = await change({ currentPassword: "not-it", newPassword: "new-password" });
    expect(res.status).toBe(401);
    expect(sessionUserId(h.db, h.cookie, key)).toBe(id);
  });

  // Shared by every visitor: one must not change the password on the others.
  it("refuses the demo account", async () => {
    h.db.update(users).set({ isDemo: true }).where(eq(users.id, id)).run();
    const res = await change({ currentPassword: "old-password", newPassword: "new-password" });
    expect(res.status).toBe(403);
    expect(sessionUserId(h.db, h.cookie, key)).toBe(id);
  });
});
