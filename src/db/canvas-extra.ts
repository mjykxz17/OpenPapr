import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./client";
import { items } from "./schema";
import type { NormalizedDiscussionItem } from "../connectors/canvas/normalize";
import type { CanvasMissing, CanvasPlannerItem } from "../connectors/canvas/types";
import { parseDiscussionMeta } from "../connectors/canvas/discussions";

const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

function itemBySource(db: Db, userId: number, sourceId: string) {
  return db.select().from(items).where(and(eq(items.userId, userId), eq(items.source, "canvas"), eq(items.sourceId, sourceId))).get();
}

export function discussionMetaFor(db: Db, userId: number, topicId: number) {
  return parseDiscussionMeta(itemBySource(db, userId, `discussion:${topicId}`)?.metaJson);
}

// Writes a course's discussions and staff replies. A graded discussion's due
// date is its assignment's, which the assignment sync has already stored.
export function applyDiscussions(db: Db, userId: number, moduleId: number, rows: NormalizedDiscussionItem[], now: number): void {
  for (const it of rows) {
    let dueAt = it.dueAt;
    if (it.type === "discussion") {
      const meta = parseDiscussionMeta(it.metaJson);
      if (meta?.assignmentId) dueAt = itemBySource(db, userId, `assignment:${meta.assignmentId}`)?.dueAt ?? dueAt;
    }
    const existing = itemBySource(db, userId, it.sourceId);
    const fields = { title: it.title, body: it.body, url: it.url, sender: it.sender, dueAt, submitted: it.submitted, metaJson: it.metaJson };
    if (!existing) {
      db.insert(items).values({ userId, moduleId, source: "canvas", type: it.type, sourceId: it.sourceId, sourceCreatedAt: it.sourceCreatedAt, firstSeenAt: now, ...fields }).run();
    } else {
      db.update(items).set(fields).where(eq(items.id, existing.id)).run();
    }
  }
}

// Canvas's own to-do state, refreshed wholesale each sync: what it flags as
// missing, what the student ticked off in the Canvas planner, their planner
// notes, and pages given a "read by" date.
export function applyPlanner(
  db: Db, userId: number, planner: CanvasPlannerItem[], missing: CanvasMissing[],
  moduleByCourse: Map<number, number>, window: { start: number; end: number }, now: number,
): { notes: number; missing: number; done: number } {
  const mine = db.select({ id: items.id, sourceId: items.sourceId, type: items.type, dueAt: items.dueAt }).from(items)
    .where(and(eq(items.userId, userId), eq(items.source, "canvas"))).all();
  const bySource = new Map(mine.map((r) => [r.sourceId, r]));
  const missingIds = new Set<number>();
  const doneIds = new Set<number>();
  const mark = (sourceId: string, set: Set<number>) => { const r = bySource.get(sourceId); if (r) set.add(r.id); };

  for (const m of missing) mark(`assignment:${m.id}`, missingIds);
  const seenNotes = new Set<string>();
  for (const p of planner) {
    const assignmentId = p.plannable_type === "assignment" ? p.plannable_id : p.plannable.assignment_id ?? null;
    const completed = Boolean(p.planner_override?.marked_complete) || (p.submissions !== false && p.submissions?.submitted === true);
    if (assignmentId) {
      if (completed) mark(`assignment:${assignmentId}`, doneIds);
      if (p.submissions !== false && p.submissions?.missing) mark(`assignment:${assignmentId}`, missingIds);
    }
    if (p.plannable_type === "discussion_topic" && p.planner_override?.marked_complete) mark(`discussion:${p.plannable_id}`, doneIds);
    const moduleId = p.course_id != null ? moduleByCourse.get(p.course_id) ?? null : null;
    if (p.plannable_type === "planner_note") {
      const sourceId = `planner_note:${p.plannable_id}`;
      seenNotes.add(sourceId);
      const fields = {
        title: p.plannable.title, body: p.plannable.details ?? null, dueAt: ts(p.plannable.todo_date ?? p.plannable_date),
        url: p.html_url ?? null, canvasDone: Boolean(p.planner_override?.marked_complete), moduleId,
      };
      const r = bySource.get(sourceId);
      if (r) db.update(items).set(fields).where(eq(items.id, r.id)).run();
      else db.insert(items).values({ userId, source: "canvas", type: "planner_note", sourceId, firstSeenAt: now, ...fields }).run();
    }
    if (p.plannable_type === "wiki_page" && p.plannable.todo_date && moduleId) {
      const sourceId = `page_todo:${p.plannable_id}`;
      const fields = { title: `Read: ${p.plannable.title}`, dueAt: ts(p.plannable.todo_date), url: p.html_url ?? null, canvasDone: Boolean(p.planner_override?.marked_complete) };
      const r = bySource.get(sourceId);
      if (r) db.update(items).set(fields).where(eq(items.id, r.id)).run();
      else db.insert(items).values({ userId, moduleId, source: "canvas", type: "deadline", sourceId, firstSeenAt: now, ...fields }).run();
    }
  }
  // A note deleted in Canvas disappears here too, within the window we read.
  const gone = mine.filter((r) => r.type === "planner_note" && !seenNotes.has(r.sourceId) && r.dueAt !== null && r.dueAt >= window.start && r.dueAt <= window.end);
  if (gone.length) db.update(items).set({ dismissed: true }).where(inArray(items.id, gone.map((g) => g.id))).run();

  const tracked = mine.filter((r) => r.type === "assignment" || r.type === "discussion").map((r) => r.id);
  if (tracked.length) {
    db.update(items).set({ missing: false, canvasDone: false }).where(inArray(items.id, tracked)).run();
    if (missingIds.size) db.update(items).set({ missing: true }).where(inArray(items.id, [...missingIds])).run();
    if (doneIds.size) db.update(items).set({ canvasDone: true }).where(inArray(items.id, [...doneIds])).run();
  }
  return { notes: seenNotes.size, missing: missingIds.size, done: doneIds.size };
}
