import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { items, modules, users } from "./schema";
import { applyDiscussions, applyPlanner } from "./canvas-extra";
import { normalizeDiscussion } from "../connectors/canvas/discussions";

const NOW = Date.UTC(2026, 8, 25, 2);
function setup() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "A" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 11, code: "ST2334", name: "Stats" }).run();
  db.insert(items).values([
    { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "assignment:50", title: "Forum post 1", dueAt: NOW + 86_400_000, firstSeenAt: NOW },
    { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "assignment:51", title: "Tutorial 3", dueAt: NOW - 86_400_000, firstSeenAt: NOW },
  ]).run();
  return db;
}

describe("applyDiscussions", () => {
  it("takes a graded discussion's due date from its assignment", () => {
    const db = setup();
    const rows = normalizeDiscussion({ id: 7, title: "Forum post 1", message: null, html_url: "u", posted_at: null, last_reply_at: null, assignment_id: 50 }, null, new Set(), 9, null);
    applyDiscussions(db, 1, 1, rows, NOW);
    const d = db.select().from(items).where(eq(items.sourceId, "discussion:7")).get()!;
    expect(d.dueAt).toBe(NOW + 86_400_000);
    applyDiscussions(db, 1, 1, rows, NOW + 1);
    expect(db.select().from(items).where(eq(items.type, "discussion")).all()).toHaveLength(1);
  });
});

describe("applyPlanner", () => {
  it("flags missing work, honours Canvas ticks, and keeps planner notes in step", () => {
    const db = setup();
    const window = { start: NOW - 14 * 86_400_000, end: NOW + 75 * 86_400_000 };
    const r = applyPlanner(db, 1, [
      { plannable_type: "assignment", plannable_id: 50, course_id: 11, plannable: { id: 50, title: "Forum post 1" }, planner_override: { marked_complete: true }, submissions: { submitted: false } },
      { plannable_type: "planner_note", plannable_id: 3, course_id: 11, plannable: { id: 3, title: "Email tutor", details: "about groups", todo_date: "2026-09-27T01:00:00Z" } },
      { plannable_type: "wiki_page", plannable_id: 8, course_id: 11, plannable: { id: 8, title: "Week 6 reading", todo_date: "2026-09-28T01:00:00Z" } },
    ], [{ id: 51, course_id: 11, name: "Tutorial 3", due_at: null, html_url: "u" }], new Map([[11, 1]]), window, NOW);
    expect(r).toEqual({ notes: 1, missing: 1, done: 1 });
    const bySrc = (s: string) => db.select().from(items).where(eq(items.sourceId, s)).get()!;
    expect(bySrc("assignment:50").canvasDone).toBe(true);
    expect(bySrc("assignment:51").missing).toBe(true);
    expect(bySrc("planner_note:3")).toMatchObject({ type: "planner_note", title: "Email tutor", moduleId: 1 });
    expect(bySrc("page_todo:8")).toMatchObject({ type: "deadline", title: "Read: Week 6 reading" });

    // Next sync: the tick was undone, the missing flag cleared, the note deleted.
    applyPlanner(db, 1, [], [], new Map([[11, 1]]), window, NOW + 1);
    expect(bySrc("assignment:50").canvasDone).toBe(false);
    expect(bySrc("assignment:51").missing).toBe(false);
    expect(bySrc("planner_note:3").dismissed).toBe(true);
  });
});
