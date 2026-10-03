import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { items, modules, taskFeedback, taskPlans, tasks, users } from "@/db/schema";
import { sgtDate, type TaskKind, type TaskSource, type TaskStep } from "@/enrich/tasks";
import { TASK_KINDS } from "@/db/schema";
import { dueLabel, shortDate } from "@/lib/format-date";

export type SourceLink = TaskSource & { href: string | null; external: boolean };
export type TaskView = {
  id: number; moduleId: number | null; code: string | null; title: string; kind: string;
  dueAt: number | null; dueConfidence: "exact" | "estimated"; anticipated: boolean; weightPct: number | null; why: string | null;
  sources: SourceLink[]; steps: TaskStep[]; status: "open" | "done" | "dismissed"; done: number; total: number;
  // Formatted here, on the server, so the page and the browser never disagree
  // about the time zone.
  dueText: string; overdue: boolean;
  missing: boolean;  // Canvas flags work this task covers as missing
  manual: boolean; notes: string | null; started: boolean; time: string | null;
};
export type TodayStep = TaskStep & { taskId: number; taskTitle: string; code: string | null; dueAt: number | null; late: boolean };
export type TasksView = {
  today: TodayStep[]; todayMinutes: number; nextDay: { date: string; steps: number; minutes: number } | null;
  soon: TaskView[]; later: TaskView[]; done: TaskView[];
};

const parse = <T,>(json: string): T[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; } };
const D = 86_400_000;

export function tasksView(db: Db, userId: number, now: number): TasksView {
  const mods = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().map((m) => [m.id, m]));
  const rows = db.select().from(tasks).where(eq(tasks.userId, userId)).all();
  const itemIds = rows.flatMap((t) => parse<TaskSource>(t.sourcesJson).filter((s) => s.itemId).map((s) => s.itemId!));
  // Also the source rows' own flags (missing), read once for all tasks.
  const urls = new Map(itemIds.length
    ? db.select({ id: items.id, url: items.url, type: items.type, missing: items.missing }).from(items).where(and(eq(items.userId, userId), inArray(items.id, itemIds))).all().map((i) => [i.id, i])
    : []);

  const link = (s: TaskSource, moduleId: number | null): SourceLink => {
    if (s.kind === "file" && s.fileId && moduleId) return { ...s, href: `/modules/${moduleId}/files/${s.fileId}`, external: false };
    if ((s.kind === "announcement" || s.kind === "discussion") && s.itemId && moduleId) return { ...s, href: `/modules/${moduleId}#a-${s.itemId}`, external: false };
    if (s.kind === "planner") return { ...s, href: null, external: false };
    if ((s.kind === "weightage" || s.kind === "nusmods") && moduleId) return { ...s, href: `/modules/${moduleId}`, external: false };
    const it = s.itemId ? urls.get(s.itemId) : undefined;
    if (it?.url) return { ...s, href: it.url, external: true };
    return { ...s, href: moduleId ? `/modules/${moduleId}` : null, external: false };
  };
  const view = (t: typeof rows[number]): TaskView => {
    const steps = parse<TaskStep>(t.stepsJson);
    return {
      id: t.id, moduleId: t.moduleId, code: t.moduleId ? mods.get(t.moduleId)?.code ?? null : null, title: t.title, kind: t.kind,
      dueAt: t.dueAt, dueConfidence: t.dueConfidence, anticipated: t.anticipated, weightPct: t.weightPct, why: t.why,
      sources: parse<TaskSource>(t.sourcesJson).map((s) => link(s, t.moduleId)), steps, status: t.status,
      done: steps.filter((s) => s.done).length, total: steps.length,
      dueText: t.dueAt === null ? (t.key.startsWith("manual-") ? "No date" : "Date not announced") : t.dueConfidence === "estimated" ? `around ${shortDate(t.dueAt)}` : dueLabel(t.dueAt, now),
      overdue: t.dueAt !== null && t.dueAt < now,
      missing: parse<TaskSource>(t.sourcesJson).some((s) => s.itemId != null && urls.get(s.itemId)?.missing === true),
      manual: isManual(t.key), notes: t.notes, started: t.startedAt !== null || steps.some((s) => s.done),
      time: t.dueAt === null ? null : timeOf(t.dueAt),
    };
  };
  const byDue = (a: TaskView, b: TaskView) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER) || a.id - b.id;

  const open = rows.filter((t) => t.status === "open").map(view).sort(byDue);
  const today = sgtDate(now);
  const todaySteps: TodayStep[] = open.flatMap((t) => t.steps.filter((s) => !s.done && s.doBy <= today)
    .map((s) => ({ ...s, taskId: t.id, taskTitle: t.title, code: t.code, dueAt: t.dueAt, late: s.doBy < today })));
  let nextDay: TasksView["nextDay"] = null;
  if (!todaySteps.length) {
    const upcoming = open.flatMap((t) => t.steps.filter((s) => !s.done && s.doBy > today)).sort((a, b) => a.doBy.localeCompare(b.doBy));
    if (upcoming.length) {
      const date = upcoming[0]!.doBy;
      const those = upcoming.filter((s) => s.doBy === date);
      nextDay = { date, steps: those.length, minutes: those.reduce((n, s) => n + s.minutes, 0) };
    }
  }
  return {
    today: todaySteps,
    todayMinutes: todaySteps.reduce((n, s) => n + s.minutes, 0),
    nextDay,
    soon: open.filter((t) => t.dueAt !== null && t.dueAt <= now + 14 * D),
    later: open.filter((t) => t.dueAt === null || t.dueAt > now + 14 * D),
    done: rows.filter((t) => t.status === "done" && t.updatedAt >= now - 7 * D).map(view).sort((a, b) => (b.dueAt ?? 0) - (a.dueAt ?? 0)),
  };
}

export function taskPlanStatus(db: Db, userId: number) {
  const u = db.select().from(users).where(eq(users.id, userId)).get();
  const ids = db.select({ id: modules.id }).from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => m.id);
  const rows = ids.length ? db.select().from(taskPlans).where(inArray(taskPlans.moduleId, ids)).orderBy(desc(taskPlans.generatedAt)).all() : [];
  const builtAt = rows.find((r) => r.generatedAt)?.generatedAt ?? null;
  const failing = rows.find((r) => r.error);
  return { builtAt, pending: Boolean(u?.tasksRequestedAt), error: failing?.error ?? null };
}

// The student's changes. Any change marks the task touched, after which a
// replan refreshes its date and sources but never rewrites its steps.
//
// Two of them also teach the planner: "not a real task" and a date the
// student corrects are written down and shown to it on the next plan.
export type TaskChange = {
  stepId?: string; done?: boolean; status?: "open" | "done" | "dismissed";
  notTask?: boolean;      // dismiss, and tell the planner not to make it again
  dueDate?: string;       // YYYY-MM-DD the student says it is really due
  time?: string | null;   // HH:MM on that day; null = by the end of it
  noDate?: boolean;       // their own task only: take the date off
  title?: string; kind?: TaskKind;  // renamed or re-typed: kept through rebuilds
  moduleId?: number | null;         // their own task only
  notes?: string | null;
  started?: boolean;      // "Doing" on the board
};

export const USER_KINDS: TaskKind[] = ["admin", "personal", "meeting", "submission", "prep", "reading", "project", "quiz", "exam", "presentation"];
export const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
// A time on a Singapore day; without one, by the end of it.
export const sgtAt = (day: string, time: string | null | undefined) => (time ? Date.parse(`${day}T${time}:00+08:00`) : endOfSgtDay(day));
export const isManual = (key: string) => key.startsWith("manual-");

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
// The end of that day in Singapore: "due Friday" means by Friday night.
export const endOfSgtDay = (day: string) => Date.parse(`${day}T23:59:00+08:00`);
const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" });
// "15:00", or null for "by the end of the day".
export const timeOf = (ms: number) => { const t = hhmm.format(ms); return t === "23:59" ? null : t; };

export function updateTask(db: Db, userId: number, taskId: number, change: TaskChange, now: number): boolean {
  const t = db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId))).get();
  if (!t) return false;
  const patch: Partial<typeof tasks.$inferInsert> = { touchedAt: now, updatedAt: now };
  if (change.notTask) {
    patch.status = "dismissed";
    db.insert(taskFeedback).values({ userId, moduleId: t.moduleId, kind: "not_task", title: t.title, note: t.why, createdAt: now }).run();
  }
  const mine = isManual(t.key);
  if (change.title !== undefined) {
    const title = change.title.replace(/\s+/g, " ").trim().slice(0, 120);
    if (title.length < 2) return false;
    if (title !== t.title) { patch.title = title; patch.titleLocked = true; }
  }
  if (change.kind !== undefined) {
    if (!(TASK_KINDS as readonly string[]).includes(change.kind)) return false;
    if (change.kind !== t.kind) { patch.kind = change.kind; patch.titleLocked = true; }
  }
  if (change.moduleId !== undefined) {
    if (!mine) return false;
    if (change.moduleId !== null && !db.select({ id: modules.id }).from(modules).where(and(eq(modules.id, change.moduleId), eq(modules.userId, userId))).get()) return false;
    patch.moduleId = change.moduleId;
  }
  if (change.notes !== undefined) patch.notes = change.notes === null ? null : change.notes.trim().slice(0, 4000) || null;
  if (change.started !== undefined) { patch.startedAt = change.started ? (t.startedAt ?? now) : null; if (change.started && t.status !== "open") patch.status = "open"; }
  if (change.noDate) {
    if (!mine) return false;
    patch.dueAt = null; patch.dueLocked = false;
  }
  // Only the time moves: same day.
  if (change.time !== undefined && change.dueDate === undefined) {
    if (change.time !== null && !isTime(change.time)) return false;
    if (t.dueAt === null) return false;
    change = { ...change, dueDate: sgtDate(t.dueAt) };
  }
  if (change.dueDate !== undefined) {
    if (!isDay(change.dueDate)) return false;
    if (change.time !== undefined && change.time !== null && !isTime(change.time)) return false;
    // No time given keeps the one it had, unless that was only a guess.
    const keep = change.time === undefined && t.dueAt !== null && t.dueConfidence === "exact" ? timeOf(t.dueAt) : null;
    const dueAt = sgtAt(change.dueDate, change.time === undefined ? keep : change.time);
    patch.dueAt = dueAt;
    patch.dueConfidence = "exact";
    patch.dueLocked = true;
    // Steps planned for after the new date move up to it.
    const steps = parse<TaskStep>(t.stepsJson);
    if (steps.some((s) => s.doBy > change.dueDate!)) patch.stepsJson = JSON.stringify(steps.map((s) => (s.doBy > change.dueDate! ? { ...s, doBy: change.dueDate! } : s)));
    const was = t.dueAt === null ? "no date" : `${sgtDate(t.dueAt)}${t.dueConfidence === "estimated" ? " (estimated)" : ""}`;
    if (!mine && dueAt !== t.dueAt && change.dueDate !== (t.dueAt === null ? null : sgtDate(t.dueAt))) {
      db.insert(taskFeedback).values({ userId, moduleId: t.moduleId, kind: "wrong_date", title: t.title, note: `you said ${was}; really ${change.dueDate}`, createdAt: now }).run();
    }
  }
  if (change.stepId !== undefined) {
    const steps = parse<TaskStep>(t.stepsJson);
    const s = steps.find((x) => x.id === change.stepId);
    if (!s) return false;
    s.done = Boolean(change.done);
    if (s.done && !t.startedAt) patch.startedAt = now;
    patch.stepsJson = JSON.stringify(steps);
    // Ticking the last step finishes the task; unticking one reopens it.
    if (steps.length && steps.every((x) => x.done)) patch.status = "done";
    else if (t.status === "done") patch.status = "open";
  }
  if (change.status) patch.status = change.status;
  db.update(tasks).set(patch).where(eq(tasks.id, t.id)).run();
  return true;
}

// Something the student added themselves: from the Tasks page, or by asking
// Papi to remind them. It is theirs, so the planner never moves or removes it.
export function createManualTask(db: Db, userId: number, input: { title: string; dueAt: number | null; moduleId: number | null; kind?: TaskKind; notes?: string | null }, now: number): number | null {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (title.length < 2) return null;
  let moduleId = input.moduleId;
  if (moduleId !== null && !db.select({ id: modules.id }).from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).get()) moduleId = null;
  const today = sgtDate(now);
  // One step, on the day before it is due (or today, if that is sooner).
  const due = input.dueAt === null ? null : sgtDate(input.dueAt);
  const dayBefore = due ? sgtDate(Date.parse(`${due}T12:00:00+08:00`) - D) : today;
  const doBy = !due ? today : dayBefore < today ? (due < today ? today : due) : dayBefore;
  const row = db.insert(tasks).values({
    userId, moduleId, key: `manual-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, title,
    kind: input.kind && (TASK_KINDS as readonly string[]).includes(input.kind) ? input.kind : "admin", dueAt: input.dueAt, notes: input.notes?.slice(0, 4000) || null, dueConfidence: "exact", anticipated: false, weightPct: null, why: null,
    sourcesJson: JSON.stringify([{ kind: "planner", label: "You added this" }]),
    // An appointment is something to turn up to, not work to plan.
    stepsJson: JSON.stringify(input.kind === "meeting" || input.kind === "personal" ? [] : [{ id: "s1", text: title.slice(0, 70), minutes: 30, doBy, done: false }]),
    status: "open", touchedAt: now, dueLocked: input.dueAt !== null, createdAt: now, updatedAt: now,
  }).returning({ id: tasks.id }).get();
  return row?.id ?? null;
}

// Only what the student added can be deleted outright; the planner's own
// tasks are dismissed instead, so it remembers not to bring them back.
export function deleteManualTask(db: Db, userId: number, taskId: number): boolean {
  const t = db.select({ key: tasks.key }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId))).get();
  if (!t || !isManual(t.key)) return false;
  db.delete(tasks).where(eq(tasks.id, taskId)).run();
  return true;
}
