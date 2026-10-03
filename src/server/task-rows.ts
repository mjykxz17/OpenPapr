import type { Overview } from "@/server/overview";
import type { SourceLink, TasksView, TaskView } from "@/server/tasks";
import type { CalDue } from "@/server/calendar-dues";
import type { TaskStep } from "@/enrich/tasks";
import { sgtDate } from "@/enrich/tasks";
import { findWeightComponent } from "@/lib/component-display";
import { shortComponentName } from "@/lib/module-name";

// The Tasks page's one list. Every view (table, calendar, board) is this list
// shown a different way. Each row says where it came from, because that
// decides what the student can change:
//   canvas   — Canvas's own date and title; mark the plan done, or hide it
//   ai       — the planner's guess; rename, re-date, re-type, dismiss
//   schedule — on the course's schedule, nothing made for it yet; read only,
//              but it can be turned into a task
//   you      — added by the student; everything, including delete

export type Origin = "canvas" | "ai" | "schedule" | "you";
export type RowStatus = "todo" | "doing" | "done";
export type TaskRow = {
  id: string; taskId: number | null; itemId: number | null; origin: Origin;
  title: string; code: string | null; moduleId: number | null; kind: string;
  day: string | null; time: string | null;
  estimated: boolean; week: string | null;   // "Week 8" when only the week is known
  overdue: boolean; missing: boolean; status: RowStatus;
  weightPct: number | null; counts: string | null;   // "Quizzes 40%"
  steps: TaskStep[]; why: string | null; notes: string | null; sources: SourceLink[];
  link: { href: string; label: string; external: boolean } | null;
  event: boolean;                                    // a class: calendar only
  can: { title: boolean; date: boolean; kind: boolean; module: boolean; done: boolean; remove: "delete" | "dismiss" | "hide" | null; makeTask: boolean };
};

const NONE = { title: false, date: false, kind: false, module: false, done: false, remove: null, makeTask: false } as const;

export function taskRows(overview: Overview, tv: TasksView, cal: CalDue[]): TaskRow[] {
  const todo = new Map(overview.todos.map((t) => [t.id, t]));
  const rows: TaskRow[] = [];
  const owned = new Map<number, number>();   // Canvas item -> the open task that is its work
  for (const d of cal) {
    const m = /^i(\d+)$/.exec(d.key);
    const t = /^\/tasks#task-(\d+)$/.exec(d.href);
    if (m && t) owned.set(Number(m[1]), Number(t[1]));
  }
  const ownsCanvas = new Map<number, number>([...owned].map(([item, task]) => [task, item]));
  const counts = (moduleId: number | null, title: string) => {
    const c = findWeightComponent({ moduleId, title }, overview.modules);
    return c ? `${shortComponentName(c.name)} ${c.pct}%` : null;
  };

  const fromTask = (t: TaskView): TaskRow => {
    const canvasItem = ownsCanvas.get(t.id) ?? null;
    const origin: Origin = t.manual ? "you" : canvasItem !== null ? "canvas" : "ai";
    const ext = t.sources.find((s) => s.external && s.href);
    const file = t.sources.find((s) => s.kind === "file" && s.href);
    const status: RowStatus = t.status === "done" ? "done" : t.started ? "doing" : "todo";
    return {
      id: `t${t.id}`, taskId: t.id, itemId: canvasItem, origin, title: t.title.replace(/\s*\(expected\)$/i, ""), code: t.code, moduleId: t.moduleId, kind: t.kind,
      day: t.dueAt === null ? null : sgtDate(t.dueAt), time: t.time, estimated: t.dueConfidence === "estimated", week: null,
      overdue: t.overdue && t.status === "open", missing: t.missing, status,
      weightPct: t.weightPct, counts: counts(t.moduleId, t.title), steps: t.steps, why: t.why, notes: t.notes, sources: t.sources,
      link: ext ? { href: ext.href!, label: "Open in Canvas", external: true } : file ? { href: file.href!, label: file.label, external: false } : null,
      event: false,
      can: {
        title: origin !== "canvas", date: origin !== "canvas", kind: origin !== "canvas", module: origin === "you", done: true,
        remove: origin === "you" ? "delete" : "dismiss", makeTask: false,
      },
    };
  };
  for (const t of [...tv.soon, ...tv.later, ...tv.done]) rows.push(fromTask(t));

  for (const d of cal) {
    const m = /^i(\d+)$/.exec(d.key);
    if (m) {
      const id = Number(m[1]);
      if (owned.has(id)) continue;
      const it = todo.get(id);
      rows.push({
        id: d.key, taskId: null, itemId: id, origin: "canvas", title: d.title, code: d.code, moduleId: d.moduleId, kind: d.event ? "class" : it?.type === "assignment" ? "submission" : "admin",
        day: d.day, time: d.time === "23:59" ? null : d.time, estimated: false, week: null, overdue: d.overdue, missing: Boolean(it?.missing), status: "todo",
        weightPct: d.counts?.pct ?? null, counts: d.counts ? `${d.counts.name} ${d.counts.pct}%` : null, steps: [], why: d.event?.note ?? null, notes: null, sources: [],
        link: it?.url ? { href: it.url, label: "Open in Canvas", external: true } : null,
        event: Boolean(d.event), can: { ...NONE, remove: d.event ? null : "hide" },
      });
    } else if (d.schedule) {
      rows.push({
        id: d.key, taskId: null, itemId: null, origin: "schedule", title: d.title, code: d.code, moduleId: d.moduleId,
        kind: d.exam ? "exam" : /quiz/i.test(d.title) ? "quiz" : "submission",
        day: d.day, time: d.schedule.placed === "week" ? null : d.time === "23:59" ? null : d.time, estimated: true,
        week: d.schedule.placed === "week" ? d.schedule.week : null, overdue: false, missing: false, status: "todo",
        weightPct: d.counts?.pct ?? null, counts: d.counts ? `${d.counts.name} ${d.counts.pct}%` : null, steps: [],
        why: d.schedule.covers ? `Covers ${d.schedule.covers}` : null, notes: null, sources: [],
        link: { href: d.href, label: d.schedule.source, external: false }, event: false, can: { ...NONE, makeTask: true },
      });
    }
  }
  // Overdue and today first within a day; the client groups by week.
  rows.sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999") || (a.time ?? "99").localeCompare(b.time ?? "99") || a.title.localeCompare(b.title));
  return rows;
}

// Week headings for the table: the NUS teaching week a day falls in, or the
// Monday it starts on outside the semester.
export type WeekBand = { label: string; from: string; to: string };
export function weekBands(weeks: { label: string; monday: number; sunday: number }[]): WeekBand[] {
  return weeks.map((w) => ({ label: w.label, from: sgtDate(w.monday + 12 * 3_600_000), to: sgtDate(w.sunday + 12 * 3_600_000) }));
}
