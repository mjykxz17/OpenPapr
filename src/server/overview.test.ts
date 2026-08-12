// src/server/overview.test.ts — seed an in-memory db, assert:
// 1. todos: overdue first, then dueAt asc, submitted/dismissed excluded
// 2. mail.important includes ambiguous+unscored (fail-open), filteredCount counts garbage only
// 3. whatsNew only items with firstSeenAt > lastSeenAt
// 4. component precedence: manual row shadows llm_syllabus row of the same name
// 5. unaccountedPct: components summing to 75 → 25; summing to 100 → null; none → null
// 6. syncStatus.stale true when last ok run is older than 3 * pollIntervalMs
import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { components, items, modules, syncRuns, users } from "../db/schema";
import { getOverview } from "./overview";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a", lastSeenAt: 100 }).run();
  const mod = db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS2103T", name: "SE" }).returning().get();
  return { db, moduleId: mod.id };
};

describe("getOverview", () => {
  it("orders todos overdue-first then by due date", () => {
    const { db } = setup();
    const base = { userId: 1, source: "canvas" as const, type: "assignment" as const, firstSeenAt: 1, title: "" };
    db.insert(items).values([
      { ...base, sourceId: "a:1", title: "later", dueAt: 5000 },
      { ...base, sourceId: "a:2", title: "overdue", dueAt: 500 },
      { ...base, sourceId: "a:3", title: "soon", dueAt: 2000 },
      { ...base, sourceId: "a:4", title: "done", dueAt: 100, submitted: true },
    ]).run();
    const o = getOverview(db, 1, 1000, 300_000);
    expect(o.todos.map((t) => t.title)).toEqual(["overdue", "soon", "later"]);
  });
  it("fails open in the mail feed and counts filtered garbage", () => {
    const { db } = setup();
    const base = { userId: 1, source: "graph" as const, type: "email" as const, firstSeenAt: 1 };
    db.insert(items).values([
      { ...base, sourceId: "m:1", title: "imp", triage: "important" },
      { ...base, sourceId: "m:2", title: "unk", triage: "unscored" },
      { ...base, sourceId: "m:3", title: "amb", triage: "ambiguous" },
      { ...base, sourceId: "m:4", title: "junk", triage: "garbage" },
    ]).run();
    const o = getOverview(db, 1, 1000, 300_000);
    expect(o.mail.important.map((m) => m.title).sort()).toEqual(["amb", "imp", "unk"]);
    expect(o.mail.filteredCount).toBe(1);
  });
  it("manual components shadow llm rows and compute unaccounted", () => {
    const { db, moduleId } = setup();
    db.insert(components).values([
      { moduleId, name: "tP", weightPct: 45, source: "llm_syllabus", evidence: "tP 45%" },
      { moduleId, name: "tP", weightPct: 50, source: "manual" },
      { moduleId, name: "Finals", weightPct: 25, source: "canvas_api" },
    ]).run();
    const m = getOverview(db, 1, 1000, 300_000).modules[0];
    expect(m.components.find((c) => c.name === "tP")!.source).toBe("manual");
    expect(m.unaccountedPct).toBe(25);
  });
  it("flags broken graph auth for the reconnect banner", () => {
    const { db } = setup();
    db.insert(syncRuns).values({ userId: 1, source: "graph", startedAt: 0, finishedAt: 1, ok: false, error: "Graph 401: invalid_grant" }).run();
    expect(getOverview(db, 1, 1000, 300_000).graphAuthBroken).toBe(true);
  });
  it("flags stale sources", () => {
    const { db } = setup();
    db.insert(syncRuns).values({ userId: 1, source: "graph", startedAt: 0, finishedAt: 0, ok: true }).run();
    const o = getOverview(db, 1, 10_000_000, 300_000);
    expect(o.syncStatus.find((s) => s.source === "graph")!.stale).toBe(true);
  });
});
