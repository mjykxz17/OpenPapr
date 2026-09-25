import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { items, modules, taskPlans, tasks, users } from "@/db/schema";
import { sgtDate, type TaskSource, type TaskStep } from "@/enrich/tasks";
import { dueLabel, shortDate } from "@/lib/format-date";

export type SourceLink = TaskSource & { href: string | null; external: boolean };
export type TaskView = {
  id: number; moduleId: number | null; code: string | null; title: string; kind: string;
  dueAt: number | null; dueConfidence: "exact" | "estimated"; anticipated: boolean; weightPct: number | null; why: string | null;
  sources: SourceLink[]; steps: TaskStep[]; status: "open" | "done" | "dismissed"; done: number; total: number;
  // Formatted here, on the server, so the page and the browser never disagree
  // about the time zone.
  dueText: string; overdue: boolean;
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
  const urls = new Map(itemIds.length
    ? db.select({ id: items.id, url: items.url, type: items.type }).from(items).where(and(eq(items.userId, userId), inArray(items.id, itemIds))).all().map((i) => [i.id, i])
    : []);

  const link = (s: TaskSource, moduleId: number | null): SourceLink => {
    if (s.kind === "file" && s.fileId && moduleId) return { ...s, href: `/modules/${moduleId}/files/${s.fileId}`, external: false };
    if (s.kind === "announcement" && s.itemId && moduleId) return { ...s, href: `/modules/${moduleId}#a-${s.itemId}`, external: false };
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
      dueText: t.dueAt === null ? "Date not announced" : t.dueConfidence === "estimated" ? `around ${shortDate(t.dueAt)}` : dueLabel(t.dueAt, now),
      overdue: t.dueAt !== null && t.dueAt < now,
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
export function updateTask(db: Db, userId: number, taskId: number, change: { stepId?: string; done?: boolean; status?: "open" | "done" | "dismissed" }, now: number): boolean {
  const t = db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId))).get();
  if (!t) return false;
  const patch: Partial<typeof tasks.$inferInsert> = { touchedAt: now, updatedAt: now };
  if (change.stepId !== undefined) {
    const steps = parse<TaskStep>(t.stepsJson);
    const s = steps.find((x) => x.id === change.stepId);
    if (!s) return false;
    s.done = Boolean(change.done);
    patch.stepsJson = JSON.stringify(steps);
    // Ticking the last step finishes the task; unticking one reopens it.
    if (steps.length && steps.every((x) => x.done)) patch.status = "done";
    else if (t.status === "done") patch.status = "open";
  }
  if (change.status) patch.status = change.status;
  db.update(tasks).set(patch).where(eq(tasks.id, t.id)).run();
  return true;
}
