import { describe, expect, it } from "vitest";
import { createDb } from "./client";
import { users, items } from "./schema";
import { eq } from "drizzle-orm";

describe("createDb", () => {
  it("migrates an in-memory db and round-trips rows", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "aiden" }).run();
    const u = db.select().from(users).all();
    expect(u).toHaveLength(1);
    db.insert(items).values({
      userId: u[0].id, type: "email", source: "graph", sourceId: "mail:1",
      title: "hi", firstSeenAt: 123,
    }).run();
    expect(db.select().from(items).where(eq(items.sourceId, "mail:1")).all()[0].triage).toBeNull();
  });
  it("enforces the (userId, source, sourceId) unique index", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    const v = { userId: 1, type: "email" as const, source: "graph" as const, sourceId: "mail:1", title: "x", firstSeenAt: 1 };
    db.insert(items).values(v).run();
    expect(() => db.insert(items).values(v).run()).toThrow();
  });
});
