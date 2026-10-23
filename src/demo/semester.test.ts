import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { items, taskChanges, tasks, users, weeklyPlans } from "../db/schema";
import { semesterView } from "../lib/acad-week";
import { htmlToText } from "../lib/html-text";
import { ensureCanvasCovered, ensureQuizSeries, tidyTasks } from "../worker/tasks";
import { isHoliday, seedSemester } from "./semester";

const H = 3_600_000;
const D = 24 * H;
const SGT = 8 * H;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sgtDay = (t: number) => new Date(t + SGT).toISOString().slice(0, 10);
const nextMidnight = (t: number) => Math.floor((t + SGT) / D) * D - SGT + D;

// "Friday 30 Oct" or "Fri 30 Oct", optionally followed by "(Week 11)".
const DATE_RE = /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?:\s*\(([^)]+)\))?/g;
// Singapore's public holidays from August 2026 to August 2027, as days off
// (a Sunday holiday moves to the Monday).
const HOLIDAYS = ["2026-08-10", "2026-11-09", "2026-12-25", "2027-01-01", "2027-02-08", "2027-03-10", "2027-03-26", "2027-05-01", "2027-05-17", "2027-05-20", "2027-08-09"];
const WEEKDAY_RE =/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g;

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
  // A test sits where the calendar has room for it, on its own date and on
  // the one the bell proposes: a midterm in teaching weeks up to Week 12,
  // after the last lecture it covers; a final in the exam weeks; a practice
  // test between semesters. None is on a public holiday.
  for (const t of ts.filter((x) => x.kind === "exam")) {
    labels.add(t.key);
    const when = [t.dueAt!, ...cs.filter((c) => c.taskId === t.id).flatMap((c) => [c.oldDueAt, c.newDueAt])].filter((x): x is number => x !== null);
    for (const d of when) {
      const v = semesterView(d);
      const where = `${at}: ${t.key} on ${sgtDay(d)} (${v.title})`;
      if (HOLIDAYS.includes(sgtDay(d))) bad.push(`${where} is a public holiday`);
      if (new Date(d + SGT).getUTCDay() % 6 === 0) bad.push(`${where} is a weekend`);
      if (t.title === "Midterm") {
        const lastLecture = Number(/Lectures 1 to (\d+)/.exec(t.why ?? "")?.[1]);
        if (v.phase !== "teaching" || v.week! > 12 || !(v.week! > lastLecture)) bad.push(`${where}: a midterm on Lectures 1 to ${lastLecture}`);
      } else if (t.title === "Final exam") {
        if (v.phase !== "exams") bad.push(`${where}: a final out of the exam weeks`);
      } else if (t.title === "Practice test") {
        if (v.phase !== "vacation") bad.push(`${where}: a practice test in term`);
      } else bad.push(`${where}: an exam called "${t.title}"`);
    }
  }
  // The two modules' tests are on different days.
  const testDays = ts.filter((x) => x.kind === "exam").map((x) => sgtDay(x.dueAt!));
  if (new Set(testDays).size !== testDays.length) bad.push(`${at}: two tests on one day`);
  // Other teams review v1.2 pull requests after they are opened and before
  // the milestone is due.
  const v12 = ts.find((x) => x.key === "cs2103t-v1-2")!;
  const review = ts.find((x) => x.key === "cs2103t-v1-2-peer-review")!;
  const opened = (JSON.parse(v12.stepsJson) as { text: string; doBy: string }[]).find((s) => s.text === "Open the pull request")!.doBy;
  if (!(opened < sgtDay(review.dueAt!) && review.dueAt! < v12.dueAt!)) bad.push(`${at}: pull requests opened ${opened}, reviewed by ${sgtDay(review.dueAt!)}, due ${sgtDay(v12.dueAt!)}`);
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
    expect(bad.slice(0, 200)).toEqual([]);
    // It did meet every kind of week on the way.
    for (const l of ["Week 1", "Week 13", "recess week", "reading week", "exam week 1", "orientation week", "none"]) expect(labels).toContain(l);
    // And every kind of test, in both modules that set one.
    for (const code of ["cs3230", "cs2105"]) for (const k of ["midterm", "final-exam", "practice-test"]) expect(labels).toContain(`${code}-${k}`);
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

  it("sets each test where the calendar has room for it", () => {
    const testOn = (date: string, key: string) => {
      const db = createDb(":memory:");
      const u = db.insert(users).values({ name: "demo" }).returning().get().id;
      seedSemester(db, u, Date.parse(`${date}T00:00:30+08:00`));
      const t = db.select().from(tasks).where(eq(tasks.userId, u)).all().find((x) => x.key.startsWith(key) && x.kind === "exam")!;
      return { title: t.title, day: sgtDay(t.dueAt!), week: semesterView(t.dueAt!).title };
    };
    // Week 1: the midterm waits until Week 7, after the six lectures it covers.
    expect(testOn("2026-08-12", "cs3230")).toEqual({ title: "Midterm", day: "2026-10-02", week: "Week 7" });
    expect(testOn("2026-08-12", "cs2105")).toMatchObject({ title: "Midterm", week: "Week 6" });
    // Week 13: the final is in the exam weeks, not reading week.
    expect(testOn("2026-11-12", "cs3230")).toMatchObject({ title: "Final exam", week: "Exam week 1" });
    // Late in the exams it is the last weekday left, never the vacation.
    expect(testOn("2026-11-28", "cs3230")).toEqual({ title: "Final exam", day: "2026-11-30", week: "Exam week 2" });
    // Over the December break: a practice test, and not on New Year's Day.
    const xmas = testOn("2026-12-24", "cs3230");
    expect(xmas).toMatchObject({ title: "Practice test", week: "Vacation" });
    expect(xmas.day).not.toBe("2027-01-01");
  });

  it("knows Singapore's public holidays", () => {
    for (const d of HOLIDAYS) expect(isHoliday(d), d).toBe(true);
    for (const d of ["2026-08-11", "2026-11-10", "2027-01-04", "2027-03-25", "2027-03-29"]) expect(isHoliday(d), d).toBe(false);
  });
});
