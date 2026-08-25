import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { users } from "./schema";
import { markSyncStarted, selectDueUsers } from "./repo";

const seed = (db: ReturnType<typeof createDb>, n: number, lastSyncStartedAt = 0) => {
  for (let i = 0; i < n; i++) db.insert(users).values({ name: `u${i}`, lastSyncStartedAt }).run();
  return db;
};

const INTERVAL = 300_000;

describe("selectDueUsers", () => {
  it("treats a never-synced user as due", () => {
    const db = seed(createDb(":memory:"), 1);
    expect(selectDueUsers(db, 1_000_000, INTERVAL, 10)).toHaveLength(1);
  });

  it("does not re-select a user synced within the interval", () => {
    const db = seed(createDb(":memory:"), 1, 1_000_000);
    expect(selectDueUsers(db, 1_000_000 + INTERVAL - 1, INTERVAL, 10)).toHaveLength(0);
  });

  it("selects a user once the interval has elapsed", () => {
    const db = seed(createDb(":memory:"), 1, 1_000_000);
    expect(selectDueUsers(db, 1_000_000 + INTERVAL, INTERVAL, 10)).toHaveLength(1);
  });

  it("returns the longest-waiting user first", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "recent", lastSyncStartedAt: 500 }).run();
    db.insert(users).values({ name: "stale", lastSyncStartedAt: 100 }).run();
    expect(selectDueUsers(db, 9_000_000, INTERVAL, 10).map((u) => u.name)).toEqual(["stale", "recent"]);
  });

  it("honours the batch cap", () => {
    const db = seed(createDb(":memory:"), 40);
    expect(selectDueUsers(db, 1_000_000, INTERVAL, 4)).toHaveLength(4);
  });

  // The point of the stagger: a cohort that all arrives at once must not stay
  // synchronised, or every user is polled in the same burst forever.
  it("spreads a cohort across the interval instead of bursting", () => {
    const db = seed(createDb(":memory:"), 20);
    const tick = 30_000;
    let now = 1_000_000;
    const syncedAt = new Map<number, number>();
    for (let t = 0; t < INTERVAL / tick; t++) {
      for (const u of selectDueUsers(db, now, INTERVAL, 2)) {
        markSyncStarted(db, u.id, now);
        syncedAt.set(u.id, now);
      }
      now += tick;
    }
    // Every user got synced, and they are spread over distinct times rather
    // than all sharing one timestamp.
    expect(syncedAt.size).toBe(20);
    expect(new Set(syncedAt.values()).size).toBeGreaterThan(5);
  });
});

describe("markSyncStarted", () => {
  it("records the time and takes the user out of the due set", () => {
    const db = seed(createDb(":memory:"), 1);
    markSyncStarted(db, 1, 1_000_000);
    expect(db.select().from(users).where(eq(users.id, 1)).get()!.lastSyncStartedAt).toBe(1_000_000);
    expect(selectDueUsers(db, 1_000_000, INTERVAL, 10)).toHaveLength(0);
  });
});
