import type { Overview } from "@/server/overview";
import type { TasksView } from "@/server/tasks";
import { sgtDate } from "@/enrich/tasks";
import { findWeightComponent } from "@/lib/component-display";
import { shortComponentName } from "@/lib/module-name";
import { htmlToText } from "@/lib/html-text";
import { assessmentNumber, ownWork } from "@/lib/own-work";
import type { RoadmapEntry } from "@/worker/roadmap";

// Every deadline for the home calendar, filed under its Singapore day, with
// what the hover card needs: the time, the part of the grade it counts
// toward, and how far the student's plan for it has got.

export type CalDue = {
  key: string; day: string; time: string; title: string; code: string | null; moduleId: number | null; href: string;
  counts: { name: string; pct: number } | null;
  estimated: boolean; exam: boolean; overdue: boolean;
  plan: { done: number; total: number; minutesLeft: number } | null;
  // A Canvas calendar event (a class, a talk, a slot) rather than something
  // to hand in: it starts at its time, and isn't "due".
  event: { note: string | null; repeats: number | null } | null;
  // On the course's own schedule, with no task or Canvas item for it yet.
  schedule?: { source: string; week: string | null; placed: "date" | "slot" | "week"; covers: string | null } | null;
};

// NUS course names end in the term, "CS4238 Computer Security Practice
// [2610]", and lecturers often name calendar events after the course. Such a
// title says nothing about the event, so it becomes "Class session".
export function eventTitle(title: string, mod: { code: string; name: string } | undefined): string {
  if (!mod) return title;
  const strip = (s: string) => s.toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const left = strip(title).replace(strip(mod.name), " ").replace(strip(mod.code), " ").trim();
  return left ? title.replace(/\s*\[\d{3,5}\]\s*$/, "") : "Class session";
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" });

export function calendarDues(overview: Overview, tv: TasksView, now: number,
  extra: { roadmap?: RoadmapEntry[]; allTasks?: { moduleId: number | null; title: string; dueAt: number | null }[] } = {}): { today: string; dues: CalDue[] } {
  const codeOf = (id: number | null) => overview.modules.find((m) => m.id === id)?.code ?? null;
  const open = [...tv.soon, ...tv.later];
  const planOf = (t: (typeof open)[number] | undefined) => !t || t.total === 0 ? null
    : { done: t.done, total: t.total, minutesLeft: t.steps.filter((s) => !s.done).reduce((n, s) => n + s.minutes, 0) };
  const counts = (c: { name: string; pct: number } | null) => c ? { name: shortComponentName(c.name), pct: c.pct } : null;
  const dues: CalDue[] = [];

  // Dated Canvas work, overdue included, with the task planned for it.
  for (const t of overview.todos) {
    if (t.category === "routine" || t.dueAt === null) continue;
    const task = open.find((x) => x.sources.some((s) => s.itemId === t.id) && ownWork(x.title, t.title, x.dueAt, t.dueAt));
    const isEvent = t.type === "event";
    const mod = overview.modules.find((m) => m.id === t.moduleId);
    const note = isEvent ? htmlToText(t.body).replace(/\s+/g, " ").trim().slice(0, 160) || null : null;
    dues.push({
      key: `i${t.id}`, day: sgtDate(t.dueAt), time: timeFmt.format(t.dueAt),
      title: isEvent ? eventTitle(t.title, mod) : t.title, code: codeOf(t.moduleId), moduleId: t.moduleId,
      href: task ? `/tasks#task-${task.id}` : t.moduleId ? `/modules/${t.moduleId}` : "/tasks",
      counts: isEvent ? null : counts(findWeightComponent(t, overview.modules)), estimated: false, exam: false,
      overdue: !isEvent && t.dueAt < now, plan: planOf(task),
      event: isEvent ? { note, repeats: t.seriesCount && t.seriesCount > 1 ? t.seriesCount - 1 : null } : null,
    });
  }
  // Exams, expected quizzes and the student's own tasks: no Canvas item.
  // A task shows itself unless an open Canvas item it is the work for
  // already does; one that only cites an earlier quiz as its pattern shows.
  const todoById = new Map(overview.todos.filter((x) => x.dueAt !== null).map((x) => [x.id, x]));
  for (const t of open) {
    const shownAsCanvas = t.sources.some((s) => s.itemId != null && todoById.has(s.itemId) && ownWork(t.title, todoById.get(s.itemId)!.title, t.dueAt, todoById.get(s.itemId)!.dueAt));
    if (t.dueAt === null || t.dueAt < now || shownAsCanvas) continue;
    const title = t.title.replace(/\s*\(expected\)$/i, "");
    dues.push({
      key: `t${t.id}`, day: sgtDate(t.dueAt), time: timeFmt.format(t.dueAt), title, code: t.code, moduleId: t.moduleId, href: `/tasks#task-${t.id}`,
      counts: counts(findWeightComponent({ moduleId: t.moduleId, title }, overview.modules)),
      estimated: t.dueConfidence === "estimated", exam: t.kind === "exam", overdue: false, plan: planOf(t), event: null,
    });
  }
  // The course's own schedule fills in what nothing else has yet — the quiz
  // in Week 10, the CTF in Week 11 — so the whole semester is on the calendar.
  const known = [...dues.filter((d) => !d.event).map((d) => ({ moduleId: d.moduleId, title: d.title, at: Date.parse(`${d.day}T12:00:00+08:00`) })),
    ...(extra.allTasks ?? []).filter((t) => t.dueAt !== null).map((t) => ({ moduleId: t.moduleId, title: t.title, at: t.dueAt! }))];
  const sameThing = (a: string, b: string) => {
    const na = assessmentNumber(a), nb = assessmentNumber(b);
    const word = (x: string) => x.toLowerCase().replace(/^(submit|complete|prepare( for)?|do|finish)\s+/, "").match(/[a-z]+/)?.[0] ?? "";
    return word(a) === word(b) && (na === null || nb === null || na === nb);
  };
  for (const r of extra.roadmap ?? []) {
    if (r.at < now - 12 * 3_600_000) continue;
    const from = r.weekFrom ?? r.at - 3 * 86_400_000, to = r.weekTo ?? r.at + 3 * 86_400_000;
    if (known.some((k) => k.moduleId === r.moduleId && k.at >= from - 86_400_000 && k.at <= to + 86_400_000 && sameThing(k.title, r.title))) continue;
    const title = r.title.replace(/\s*\([^)]*\)\s*$/, "") || r.title;
    dues.push({
      key: `r${r.moduleId}-${r.title}-${r.at}`, day: sgtDate(r.at), time: timeFmt.format(r.at), title, code: codeOf(r.moduleId), moduleId: r.moduleId,
      href: r.fileId ? `/modules/${r.moduleId}/files/${r.fileId}` : `/modules/${r.moduleId}`,
      counts: r.weightPct != null ? { name: r.kind === "quiz" ? "Quizzes" : title, pct: r.weightPct } : counts(findWeightComponent({ moduleId: r.moduleId, title }, overview.modules)),
      estimated: r.placed !== "date", exam: ["exam", "midterm", "test"].includes(r.kind), overdue: false, plan: null, event: null,
      schedule: { source: r.source, week: r.week, placed: r.placed, covers: r.covers },
    });
  }
  // A class session that a deadline sits in (the quiz held in Tuesday's
  // lecture) is said by the deadline; the bare session would only repeat it.
  const covered = new Set(dues.filter((d) => !d.event).map((d) => `${d.moduleId}|${d.day}`));
  const shown = dues.filter((d) => !(d.event && d.title === "Class session" && covered.has(`${d.moduleId}|${d.day}`)));
  shown.sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time));
  return { today: sgtDate(now), dues: shown };
}
