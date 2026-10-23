import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { items, taskChanges, tasks, users, weeklyPlans } from "../db/schema";
import { semesterView } from "../lib/acad-week";
import { htmlToText } from "../lib/html-text";
import { ensureCanvasCovered, ensureQuizSeries, tidyTasks } from "../worker/tasks";
import { seedSemester } from "./semester";

const H = 3_600_000;
const D = 24 * H;
const SGT = 8 * H;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sgtDay = (t: number) => new Date(t + SGT).toISOString().slice(0, 10);
const nextMidnight = (t: number) => Math.floor((t + SGT) / D) * D - SGT + D;

// "Friday 30 Oct" or "Fri 30 Oct", optionally followed by "(Week 11)".
const DATE_RE = /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?:\s*\(([^)]+)\))?/g;
const WEEKDAY_RE = /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g;

// Everything one seeding says, with what it is due at.
function seeded(db: ReturnType<typeof createDb>, u: number) {
  const its = db.select().from(items).where(eq(items.userId, u)).all();
  const ts = db.select().from(tasks).where(eq(tasks.userId, u)).all();
  const cs = db.select().from(taskChanges).where(eq(taskChanges.userId, u)).all();
  const plan = db.select().from(weeklyPlans).where(eq(weeklyPlans.userId, u)).get()!;
  const texts = [
    ...its.flatMap((i) => [i.title, htmlToText(i.body)]),
    ...ts.flatMap((t) => [t.title, t.why ?? "", ...(JSON.parse(t.stepsJson) as { text: string }[]).map((s) => s.text), ...(JSON.parse(t.sourcesJson) as { label: string; quote?: string }[]).flatMap((s) => [s.label, s.quote ?? ""])]),
    ...cs.flatMap((c) => [c.title, c.quote ?? "", c.sourceLabel ?? ""]),
    ...Object.values(JSON.parse(plan.planJson!) as object).flatMap((v) => (typeof v === "string" ? [v] : (v as object[]).flatMap((p) => Object.values(p)))),
  ].filter(Boolean) as string[];
  const dates = new Set([...its.map((i) => i.dueAt), ...ts.map((t) => t.dueAt), ...cs.flatMap((c) => [c.oldDueAt, c.newDueAt])].filter((x): x is number => x !== null).map(sgtDay));
  return { its, ts, cs, texts, dates };
}

// What the calendar calls a moment's week, worked out here independently.
function weekLabel(t: number): string | null {
  const v = semesterView(t);
  if (v.phase === "vacation") return null;
  return v.phase === "teaching" ? `Week ${v.week}` : v.title.toLowerCase();
}

// The date a "Fri 30 Oct" means: the one with that day and month nearest to now.
function resolve(dayOfMonth: number, month: number, now: number): number {
  const y = new Date(now + SGT).getUTCFullYear();
  return [y - 1, y, y + 1].map((yy) => Date.UTC(yy, month, dayOfMonth, 12) - SGT).sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0]!;
}

function check(db: ReturnType<typeof createDb>, u: number, now: number, labels: Set<string>): string[] {
  const bad: string[] = [];
  const { its, ts, cs, texts, dates } = seeded(db, u);
  const at = sgtDay(now);

  // A "Week N" in a title is the week the thing is due in.
  for (const x of [...its, ...ts]) {
    const m = /\bWeek (\d+)\b/.exec(x.title);
    if (!m) continue;
    const v = semesterView(x.dueAt!);
    if (v.phase !== "teaching" || v.week !== Number(m[1])) bad.push(`${at}: "${x.title}" is due in ${v.title}`);
  }
  // A midterm is never in reading or exam week.
  for (const t of ts.filter((x) => /midterm/i.test(x.title))) if (["reading", "exams"].includes(semesterView(t.dueAt!).phase)) bad.push(`${at}: a midterm in ${semesterView(t.dueAt!).title}`);
  for (const text of texts) {
    if (/\b(today|tomorrow|yesterday|tonight)\b/i.test(text)) bad.push(`${at}: relative day in "${text}"`);
    if (/https?:\/\//.test(text)) bad.push(`${at}: a link in "${text}"`);
    const named = [...text.matchAll(DATE_RE)];
    // Every weekday named is part of a full date.
    if ((text.match(WEEKDAY_RE) ?? []).length !== named.length) bad.push(`${at}: a weekday without its date in "${text}"`);
    for (const [whole, wd, dd, mon, label] of named) {
      labels.add(label ?? "none");
      const t = resolve(Number(dd), MONTHS.indexOf(mon!), now);
      if (!DAYS[new Date(t + SGT).getUTCDay()]!.startsWith(wd!)) bad.push(`${at}: "${whole}" is not a ${wd}`);
      if (!dates.has(sgtDay(t))) bad.push(`${at}: "${whole}" is no date anything is due`);
      if (label !== undefined && label !== weekLabel(t)) bad.push(`${at}: "${whole}" is in ${weekLabel(t) ?? "the vacation"}`);
    }
  }
  // Open work stays ahead of the student until the next nightly reset.
  const reset = nextMidnight(now);
  for (const t of ts.filter((x) => x.status === "open")) {
    if (t.dueAt === null || t.dueAt <= reset) bad.push(`${at}: open task "${t.title}" is due ${t.dueAt === null ? "never" : new Date(t.dueAt).toISOString()}`);
    for (const s of JSON.parse(t.stepsJson) as { text: string; doBy: string; done: boolean }[]) {
      if (!s.done && s.doBy < at) bad.push(`${at}: step "${s.text}" is late`);
      if (t.dueAt !== null && s.doBy > sgtDay(t.dueAt)) bad.push(`${at}: step "${s.text}" is after "${t.title}" is due`);
    }
  }
  for (const i of its.filter((x) => x.type === "assignment" && !x.submitted)) if (i.dueAt! <= reset) bad.push(`${at}: open assignment "${i.title}" is past due`);
  for (const c of cs.filter((x) => x.status === "pending")) for (const d of [c.oldDueAt, c.newDueAt]) if (d !== null && d <= reset) bad.push(`${at}: the bell's "${c.title}" is past due`);
  if (its.some((i) => i.url !== null)) bad.push(`${at}: an item links out`);
  // The worker's safety nets have nothing to add or fix on a fresh seed.
  const fixes = ensureCanvasCovered(db, u, now) + ensureQuizSeries(db, u, now) + tidyTasks(db, u, now);
  if (fixes) bad.push(`${at}: the worker changed ${fixes} task(s) straight after seeding`);
  return bad;
}

describe("demo semester", () => {
  it("is coherent on every day of the year, at the nightly reset and late in the day", () => {
    const db = createDb(":memory:");
    const bad: string[] = [];
    const labels = new Set<string>();
    const start = Date.parse("2026-08-01T00:00:30+08:00");
    for (let d = 0; d < 366; d++) {
      for (const now of d % 7 === 3 ? [start + d * D, start + d * D + 23 * H + 29 * 60_000] : [start + d * D]) {
        const u = db.insert(users).values({ name: "demo" }).returning().get().id;
        seedSemester(db, u, now);
        bad.push(...check(db, u, now, labels));
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
    // It did meet every kind of week on the way.
    for (const l of ["Week 1", "Week 13", "recess week", "reading week", "exam week 1", "orientation week", "none"]) expect(labels).toContain(l);
  }, 60_000);

  it("names this week's quiz for this week, and dates the midterm on the Friday it says", () => {
    const db = createDb(":memory:");
    const u = db.insert(users).values({ name: "demo" }).returning().get().id;
    const now = Date.parse("2026-10-23T00:00:30+08:00"); // Friday of Week 10
    seedSemester(db, u, now);
    const ts = db.select().from(tasks).where(eq(tasks.userId, u)).all();
    // Fri → next weekday is Monday 26 Oct, in Week 11.
    expect(ts.find((t) => t.kind === "quiz" && t.status === "open" && /Week/.test(t.title))?.title).toBe("Week 11 quiz");
    const mid = ts.find((t) => t.key === "cs3230-midterm" && t.title === "Midterm")!;
    expect(sgtDay(mid.dueAt!)).toBe("2026-10-30");
    const ann = db.select().from(items).where(eq(items.sourceId, "announcement:31")).get()!;
    expect(htmlToText(ann.body)).toContain("Friday 30 Oct (Week 11) at 10am");
  });

  it("keeps week numbers out of what falls between semesters", () => {
    const db = createDb(":memory:");
    const u = db.insert(users).values({ name: "demo" }).returning().get().id;
    seedSemester(db, u, Date.parse("2026-12-24T00:00:30+08:00"));
    const titles = db.select().from(tasks).where(eq(tasks.userId, u)).all().map((t) => t.title);
    expect(titles).toContain("Practice quiz");
    expect(titles.some((t) => /Week \d/.test(t))).toBe(false);
  });

  it("calls the test in exam week the final", () => {
    const db = createDb(":memory:");
    const u = db.insert(users).values({ name: "demo" }).returning().get().id;
    seedSemester(db, u, Date.parse("2026-11-16T00:00:30+08:00")); // reading week; the Friday after next is in exam week 1
    const exam = db.select().from(tasks).where(eq(tasks.userId, u)).all().find((t) => t.key === "cs3230-final-exam")!;
    expect(exam).toMatchObject({ title: "Final exam", weightPct: 50 });
    expect(semesterView(exam.dueAt!).title).toBe("Exam week 1");
  });
});
