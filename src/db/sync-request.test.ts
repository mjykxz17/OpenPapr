import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { users } from "./schema";
import { requestSync, selectRequestedUsers, takeSyncRequest } from "./repo";

const setup = (n = 1) => {
  const db = createDb(":memory:");
  for (let i = 0; i < n; i++) db.insert(users).values({ name: `u${i}` }).run();
  return db;
};

describe("requestSync", () => {
  it("marks the user as wanting a sync", () => {
    const db = setup();
    requestSync(db, 1, 5000);
    expect(db.select().from(users).where(eq(users.id, 1)).get()!.syncRequestedAt).toBe(5000);
  });

  it("does not disturb other users", () => {
    const db = setup(2);
    requestSync(db, 1, 5000);
    expect(db.select().from(users).where(eq(users.id, 2)).get()!.syncRequestedAt).toBeNull();
  });
});

describe("takeSyncRequest", () => {
  it("reports a pending request and clears it in the same step", () => {
    const db = setup();
    requestSync(db, 1, 5000);
    expect(takeSyncRequest(db, 1)).toBe(true);
    expect(db.select().from(users).where(eq(users.id, 1)).get()!.syncRequestedAt).toBeNull();
  });

  it("reports nothing pending when none was made", () => {
    const db = setup();
    expect(takeSyncRequest(db, 1)).toBe(false);
  });

  // The worker ticks every couple of seconds. If taking a request did not
  // clear it, one press would restart the cycle on every tick forever.
  it("does not fire twice for one request", () => {
    const db = setup();
    requestSync(db, 1, 5000);
    expect(takeSyncRequest(db, 1)).toBe(true);
    expect(takeSyncRequest(db, 1)).toBe(false);
    expect(takeSyncRequest(db, 1)).toBe(false);
  });
});

describe("selectRequestedUsers", () => {
  it("returns only users with a request outstanding", () => {
    const db = setup(3);
    requestSync(db, 2, 5000);
    expect(selectRequestedUsers(db).map((u) => u.id)).toEqual([2]);
  });

  it("is empty once the request is taken", () => {
    const db = setup(2);
    requestSync(db, 1, 5000);
    takeSyncRequest(db, 1);
    expect(selectRequestedUsers(db)).toHaveLength(0);
  });
});
