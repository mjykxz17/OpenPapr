import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { items, users, modules } from "./schema";
import { MAX_ACTION_ATTEMPTS, recordActionFailure, selectActionCandidates } from "./repo";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS4239", name: "SS", active: true }).run();
  return db;
};

const announcement = (db: ReturnType<typeof setup>, sourceId: string, firstSeenAt: number, attempts = 0) =>
  db.insert(items).values({
    userId: 1, moduleId: 1, type: "announcement", source: "canvas",
    sourceId, title: `ann ${sourceId}`, body: "text", firstSeenAt, actionsAttempts: attempts,
  }).run();

describe("selectActionCandidates", () => {
  it("offers a fresh item for extraction", () => {
    const db = setup();
    announcement(db, "a:1", 100);
    expect(selectActionCandidates(db, 1, new Set([1]))).toHaveLength(1);
  });

  it("stops offering an item once it has failed MAX_ACTION_ATTEMPTS times", () => {
    const db = setup();
    announcement(db, "a:1", 100, MAX_ACTION_ATTEMPTS);
    expect(selectActionCandidates(db, 1, new Set([1]))).toHaveLength(0);
  });

  it("still offers an item that has failed fewer times", () => {
    const db = setup();
    announcement(db, "a:1", 100, MAX_ACTION_ATTEMPTS - 1);
    expect(selectActionCandidates(db, 1, new Set([1]))).toHaveLength(1);
  });

  // The regression that motivated this: the candidate pool is capped, so
  // permanently-failing items sitting at the head of the list occupied every
  // slot and newer items were never reached.
  it("does not let exhausted items starve newer ones out of a capped pool", () => {
    const db = setup();
    for (let i = 0; i < 25; i++) announcement(db, `old:${i}`, 100 + i, MAX_ACTION_ATTEMPTS);
    announcement(db, "new:1", 9999);
    const picked = selectActionCandidates(db, 1, new Set([1]), 25);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.sourceId).toBe("new:1");
  });

  it("honours the cap", () => {
    const db = setup();
    for (let i = 0; i < 40; i++) announcement(db, `a:${i}`, 100 + i);
    expect(selectActionCandidates(db, 1, new Set([1]), 25)).toHaveLength(25);
  });

  it("ignores items from inactive modules", () => {
    const db = setup();
    announcement(db, "a:1", 100);
    expect(selectActionCandidates(db, 1, new Set())).toHaveLength(0);
  });
});

describe("recordActionFailure", () => {
  it("increments the attempt count", () => {
    const db = setup();
    announcement(db, "a:1", 100);
    recordActionFailure(db, 1);
    recordActionFailure(db, 1);
    expect(db.select().from(items).where(eq(items.id, 1)).get()!.actionsAttempts).toBe(2);
  });

  it("drives an item out of the pool after enough failures", () => {
    const db = setup();
    announcement(db, "a:1", 100);
    for (let i = 0; i < MAX_ACTION_ATTEMPTS; i++) {
      expect(selectActionCandidates(db, 1, new Set([1]))).toHaveLength(1);
      recordActionFailure(db, 1);
    }
    expect(selectActionCandidates(db, 1, new Set([1]))).toHaveLength(0);
  });

  it("leaves the extraction marker alone — giving up is not the same as extracting", () => {
    const db = setup();
    announcement(db, "a:1", 100);
    for (let i = 0; i < MAX_ACTION_ATTEMPTS; i++) recordActionFailure(db, 1);
    expect(db.select().from(items).where(eq(items.id, 1)).get()!.actionsExtractedAt).toBeNull();
  });
});
