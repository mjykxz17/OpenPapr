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
  it("keeps graphAuthBroken true when the latest graph run is a backing-off skip carrying the 401 text", () => {
    const { db } = setup();
    db.insert(syncRuns).values([
      { userId: 1, source: "graph", startedAt: 0, finishedAt: 1, ok: false, error: "Graph 401: invalid_grant" },
      {
        userId: 1,
        source: "graph",
        startedAt: 2,
        finishedAt: 3,
        ok: false,
        error: "backing off graph after 1 consecutive failure(s); last error: Error: Graph 401: invalid_grant",
      },
    ]).run();
    expect(getOverview(db, 1, 1000, 300_000).graphAuthBroken).toBe(true);
  });
  it("flags stale sources", () => {
    const { db } = setup();
    db.insert(syncRuns).values({ userId: 1, source: "graph", startedAt: 0, finishedAt: 0, ok: true }).run();
    const o = getOverview(db, 1, 10_000_000, 300_000);
    expect(o.syncStatus.find((s) => s.source === "graph")!.stale).toBe(true);
  });
});

describe("active-term scoping", () => {
  it("hides inactive modules' cards, todos, and what's-new items; mail unaffected", () => {
    const { db, moduleId } = setup();
    const old = db.insert(modules).values({ userId: 1, canvasCourseId: 8, code: "GES1035", name: "old", active: false }).returning().get();
    db.insert(items).values([
      { userId: 1, moduleId: old.id, source: "canvas", type: "assignment", sourceId: "a:old", title: "old essay", firstSeenAt: 500, dueAt: 9999 },
      { userId: 1, moduleId, source: "canvas", type: "assignment", sourceId: "a:new", title: "new lab", firstSeenAt: 500, dueAt: 9999 },
      { userId: 1, moduleId: null, source: "graph", type: "email", sourceId: "m:x", title: "mail", firstSeenAt: 500, triage: "important" },
    ]).run();
    const o = getOverview(db, 1, 1000, 300_000);
    expect(o.modules.map((m) => m.code)).toEqual(["CS2103T"]);
    expect(o.todos.map((t) => t.title)).toEqual(["new lab"]);
    expect(o.whatsNew.map((i) => i.title).sort()).toEqual(["mail", "new lab"]);
    expect(o.mail.important.map((m) => m.title)).toEqual(["mail"]);
  });
});

describe("extracted deadlines", () => {
  it("appear in todos ordered with everything else", () => {
    const { db, moduleId } = setup();
    db.insert(items).values([
      { userId: 1, moduleId, source: "canvas", type: "deadline", sourceId: "a:9:action:quiz", title: "In-person quiz", firstSeenAt: 1, dueAt: 2000 },
      { userId: 1, moduleId, source: "canvas", type: "assignment", sourceId: "a:1", title: "later", firstSeenAt: 1, dueAt: 5000 },
    ]).run();
    expect(getOverview(db, 1, 1000, 300_000).todos.map((t) => t.title)).toEqual(["In-person quiz", "later"]);
  });
});

describe("todo tidying", () => {
  const HOUR = 3_600_000;
  const ev = (moduleId: number, sourceId: string, title: string, dueAt: number) =>
    ({ userId: 1, moduleId, source: "canvas" as const, type: "event" as const, sourceId, title, firstSeenAt: 1, dueAt });
  it("collapses a recurring event series to its next occurrence with a count", () => {
    const { db, moduleId } = setup();
    const now = 100 * HOUR;
    db.insert(items).values([
      ev(moduleId, "e:1", "Security Practice", now - 50 * HOUR),
      ev(moduleId, "e:2", "Security Practice", now + 50 * HOUR),
      ev(moduleId, "e:3", "Security Practice", now + 200 * HOUR),
      ev(moduleId, "e:4", "Security Practice", now + 400 * HOUR),
    ]).run();
    const todos = getOverview(db, 1, now, 300_000).todos;
    expect(todos).toHaveLength(1);
    expect(todos[0].dueAt).toBe(now + 50 * HOUR);
    expect(todos[0].seriesCount).toBe(3);
  });
  it("hides past events and past routine deadlines after a 12h grace, keeps overdue submittables", () => {
    const { db, moduleId } = setup();
    const now = 100 * HOUR;
    db.insert(items).values([
      ev(moduleId, "e:1", "Old lab", now - 24 * HOUR),
      { userId: 1, moduleId, source: "canvas", type: "deadline", sourceId: "d:1", title: "Attend old lab", firstSeenAt: 1, dueAt: now - 24 * HOUR, category: "routine" },
      { userId: 1, moduleId, source: "canvas", type: "deadline", sourceId: "d:2", title: "Submit old report", firstSeenAt: 1, dueAt: now - 24 * HOUR, category: "deliverable" },
      { userId: 1, moduleId, source: "canvas", type: "assignment", sourceId: "a:1", title: "Old assignment", firstSeenAt: 1, dueAt: now - 24 * HOUR },
      ev(moduleId, "e:2", "Recent lab", now - 6 * HOUR),
    ]).run();
    const titles = getOverview(db, 1, now, 300_000).todos.map((t) => t.title).sort();
    expect(titles).toEqual(["Old assignment", "Recent lab", "Submit old report"]);
  });
  it("treats unclassified deadlines as deliverable (kept when overdue)", () => {
    const { db, moduleId } = setup();
    const now = 100 * HOUR;
    db.insert(items).values(
      { userId: 1, moduleId, source: "canvas", type: "deadline", sourceId: "d:9", title: "Unclassified overdue", firstSeenAt: 1, dueAt: now - 24 * HOUR },
    ).run();
    expect(getOverview(db, 1, now, 300_000).todos.map((t) => t.title)).toEqual(["Unclassified overdue"]);
  });
});
