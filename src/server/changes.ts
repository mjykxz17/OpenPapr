import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { items, modules, taskChanges, taskFeedback, tasks } from "@/db/schema";
import { sameAssessment } from "@/lib/own-work";

// The bell: what the courses changed. A proposal (a date the student set that
// an announcement now contradicts) waits for "Use the new date" or "Keep
// mine"; a date moved for them can be undone; newly found work can be
// confirmed or thrown out. Handled ones stay for two weeks as history.

export type ChangeView = {
  id: number; kind: "date_proposed" | "date_moved" | "task_added"; status: string; title: string;
  code: string | null; moduleId: number | null; taskId: number | null;
  oldDueAt: number | null; newDueAt: number | null; estimated: boolean;
  source: { label: string | null; href: string | null; quote: string | null };
  createdAt: number; open: boolean;   // open = still asks for something (or unseen)
};

const D = 86_400_000;

// Notices that no longer apply settle themselves: a task that was deleted,
// finished or dismissed since can't be asked about or undone. They become
// history, so the badge and the list always agree.
export function reconcileChanges(db: Db, userId: number, now: number): void {
  const pending = db.select({ id: taskChanges.id, taskId: taskChanges.taskId, kind: taskChanges.kind }).from(taskChanges)
    .where(and(eq(taskChanges.userId, userId), eq(taskChanges.status, "pending"))).all();
  const ids = [...new Set(pending.map((c) => c.taskId).filter((x): x is number => x != null))];
  const state = new Map(ids.length ? db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(inArray(tasks.id, ids)).all().map((t) => [t.id, t.status]) : []);
  const settle = pending.filter((c) => c.taskId === null || !state.has(c.taskId) || state.get(c.taskId) !== "open").map((c) => c.id);
  if (settle.length) db.update(taskChanges).set({ status: "seen", resolvedAt: now }).where(inArray(taskChanges.id, settle)).run();
}

export function changesFor(db: Db, userId: number, now: number): ChangeView[] {
  reconcileChanges(db, userId, now);
  const rows = db.select().from(taskChanges)
    .where(and(eq(taskChanges.userId, userId), or(eq(taskChanges.status, "pending"), gte(taskChanges.resolvedAt, now - 14 * D))))
    .orderBy(desc(taskChanges.createdAt)).all();
  if (!rows.length) return [];
  const mods = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().map((m) => [m.id, m]));
  const itemIds = rows.map((r) => r.sourceItemId).filter((x): x is number => x != null);
  const urls = new Map(itemIds.length ? db.select({ id: items.id, type: items.type, moduleId: items.moduleId }).from(items).where(inArray(items.id, itemIds)).all().map((i) => [i.id, i]) : []);
  // History of a task that has since gone is kept; only open questions need it.
  return rows.map((r) => {
    const it = r.sourceItemId != null ? urls.get(r.sourceItemId) : undefined;
    return {
      id: r.id, kind: r.kind, status: r.status, title: r.title.replace(/\s*\(expected\)$/i, ""),
      code: r.moduleId ? mods.get(r.moduleId)?.code ?? null : null, moduleId: r.moduleId, taskId: r.taskId,
      oldDueAt: r.oldDueAt, newDueAt: r.newDueAt, estimated: r.newConfidence === "estimated",
      source: { label: r.sourceLabel, quote: r.quote, href: it?.moduleId ? `/modules/${it.moduleId}#a-${r.sourceItemId}` : null },
      createdAt: r.createdAt, open: r.status === "pending",
    };
  }).sort((a, b) => Number(b.open) - Number(a.open) || Number(b.kind === "date_proposed") - Number(a.kind === "date_proposed") || b.createdAt - a.createdAt);
}

// The badge: exactly the notices the list shows as open.
export function openChangeCount(db: Db, userId: number, now = Date.now()): number {
  reconcileChanges(db, userId, now);
  return db.select({ id: taskChanges.id }).from(taskChanges)
    .where(and(eq(taskChanges.userId, userId), eq(taskChanges.status, "pending"))).all().length;
}

export type ChangeAction = "accept" | "keep" | "undo" | "seen" | "not_task";

export function resolveChange(db: Db, userId: number, id: number, action: ChangeAction, now: number): boolean {
  const c = db.select().from(taskChanges).where(and(eq(taskChanges.id, id), eq(taskChanges.userId, userId))).get();
  if (!c) return false;
  const t = c.taskId != null ? db.select().from(tasks).where(and(eq(tasks.id, c.taskId), eq(tasks.userId, userId))).get() : undefined;
  const done = (status: "accepted" | "kept" | "undone" | "seen") => db.update(taskChanges).set({ status, resolvedAt: now }).where(eq(taskChanges.id, c.id)).run();

  if (action === "accept" && c.kind === "date_proposed") {
    if (!t || c.newDueAt === null) return false;
    // The course's date, which a later announcement may move again.
    db.update(tasks).set({ dueAt: c.newDueAt, dueConfidence: c.newConfidence ?? "exact", dueLocked: false, dueLockedAt: null, touchedAt: now, updatedAt: now }).where(eq(tasks.id, t.id)).run();
    // Their old correction is out of date; the planner must not be told it again.
    const stale = db.select().from(taskFeedback).where(and(eq(taskFeedback.userId, userId), eq(taskFeedback.kind, "wrong_date"))).all()
      .filter((f) => f.moduleId === t.moduleId && (f.title === t.title || sameAssessment(f.title, t.title)));
    if (stale.length) db.delete(taskFeedback).where(inArray(taskFeedback.id, stale.map((f) => f.id))).run();
    done("accepted");
    return true;
  }
  if (action === "keep" && c.kind === "date_proposed") {
    // Kept: the lock now dates from today, so this announcement doesn't ask again.
    if (t) db.update(tasks).set({ dueLocked: true, dueLockedAt: now, touchedAt: now }).where(eq(tasks.id, t.id)).run();
    done("kept");
    return true;
  }
  if (action === "undo" && c.kind === "date_moved") {
    if (!t || c.oldDueAt === null) return false;
    db.update(tasks).set({ dueAt: c.oldDueAt, dueConfidence: "exact", dueLocked: true, dueLockedAt: now, touchedAt: now, updatedAt: now }).where(eq(tasks.id, t.id)).run();
    done("undone");
    return true;
  }
  if (action === "not_task" && c.kind === "task_added") {
    if (t) {
      db.update(tasks).set({ status: "dismissed", touchedAt: now, updatedAt: now }).where(eq(tasks.id, t.id)).run();
      db.insert(taskFeedback).values({ userId, moduleId: t.moduleId, kind: "not_task", title: t.title, note: t.why, createdAt: now }).run();
    }
    done("undone");
    return true;
  }
  if (action === "seen" && c.kind !== "date_proposed") { done("seen"); return true; }
  return false;
}

// "Mark all seen": everything that only informs. Proposals still wait.
export function markAllSeen(db: Db, userId: number, now: number): number {
  return db.update(taskChanges).set({ status: "seen", resolvedAt: now })
    .where(and(eq(taskChanges.userId, userId), eq(taskChanges.status, "pending"), inArray(taskChanges.kind, ["date_moved", "task_added"]))).run().changes;
}

