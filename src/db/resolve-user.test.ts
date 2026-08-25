import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { users } from "./schema";
import { resolveCanvasUser } from "./repo";
import { decrypt, encrypt } from "../lib/crypto";

const key = "ab".repeat(32);
const self = (id: number, name = "Student") => ({ id, name });

describe("resolveCanvasUser", () => {
  it("creates an account on first sign-in", () => {
    const db = createDb(":memory:");
    const id = resolveCanvasUser(db, self(4242, "Ada"), "tok-a", key, 1000);
    const row = db.select().from(users).where(eq(users.id, id)).get()!;
    expect(row.canvasUserId).toBe(4242);
    expect(row.name).toBe("Ada");
    expect(row.createdAt).toBe(1000);
    expect(decrypt(row.canvasTokenEnc!, key)).toBe("tok-a");
  });

  it("returns the same account on a later sign-in rather than duplicating", () => {
    const db = createDb(":memory:");
    const first = resolveCanvasUser(db, self(4242), "tok-a", key, 1000);
    const second = resolveCanvasUser(db, self(4242), "tok-a", key, 2000);
    expect(second).toBe(first);
    expect(db.select().from(users).all()).toHaveLength(1);
  });

  it("stores a rotated token for a returning user", () => {
    const db = createDb(":memory:");
    const id = resolveCanvasUser(db, self(4242), "tok-old", key, 1000);
    resolveCanvasUser(db, self(4242), "tok-new", key, 2000);
    const row = db.select().from(users).where(eq(users.id, id)).get()!;
    expect(decrypt(row.canvasTokenEnc!, key)).toBe("tok-new");
  });

  it("keeps separate accounts for separate Canvas users", () => {
    const db = createDb(":memory:");
    const a = resolveCanvasUser(db, self(1), "tok-a", key, 1000);
    const b = resolveCanvasUser(db, self(2), "tok-b", key, 1000);
    expect(a).not.toBe(b);
    expect(db.select().from(users).all()).toHaveLength(2);
  });

  // The pre-multi-user row has no canvas_user_id. Its owner must land back in
  // their own account — with their modules, items and guides — rather than
  // getting a fresh empty one alongside it.
  it("adopts the legacy account when the same token signs in", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "Aiden", canvasTokenEnc: encrypt("tok-legacy", key) }).run();
    const id = resolveCanvasUser(db, self(4242, "Aiden Ma"), "tok-legacy", key, 5000);
    expect(id).toBe(1);
    expect(db.select().from(users).all()).toHaveLength(1);
    const row = db.select().from(users).where(eq(users.id, 1)).get()!;
    expect(row.canvasUserId).toBe(4242);
    expect(row.name).toBe("Aiden Ma");
  });

  it("does not hand the legacy account to a different person's token", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "Aiden", canvasTokenEnc: encrypt("tok-legacy", key) }).run();
    const id = resolveCanvasUser(db, self(999, "Someone Else"), "tok-theirs", key, 5000);
    expect(id).not.toBe(1);
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(users).where(eq(users.id, 1)).get()!.canvasUserId).toBeNull();
  });

  it("does not adopt a legacy account twice", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "Aiden", canvasTokenEnc: encrypt("tok-legacy", key) }).run();
    resolveCanvasUser(db, self(4242), "tok-legacy", key, 5000);
    const second = resolveCanvasUser(db, self(777), "tok-legacy", key, 6000);
    expect(second).not.toBe(1);
    expect(db.select().from(users).all()).toHaveLength(2);
  });
});
