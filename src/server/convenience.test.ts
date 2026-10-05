import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { guideQuizzes, items, llmUsage, modules, studyGuides, taskFeedback, tasks, users } from "../db/schema";
import { calendarEvents } from "./calendar";
import { deleteAccount, exportAccount } from "./account-data";
import { recordLlmCall, sharedAllowanceLeft, usageThisMonth } from "./llm-usage";
import { createManualTask, deleteManualTask, updateTask } from "./tasks";
import { applyPlan } from "../worker/tasks";
import { moduleSignals } from "../worker/tasks";
import { search } from "./search";

const now = Date.parse("2026-10-01T10:00:00+08:00");
const D = 86_400_000;

function setup() {
  const db = createDb(":memory:");
  db.insert(users).values([{ name: "a", passwordHash: "secret-hash", calendarToken: "tok" }, { name: "b" }]).run();
  const mod = db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS4238", name: "Computer Security Practice" }).returning().get();
  const other = db.insert(modules).values({ userId: 2, canvasCourseId: 8, code: "CS1010", name: "Programming" }).returning().get();
  return { db, mod, other };
}
const base = { userId: 1, source: "canvas" as const, firstSeenAt: now - D };

describe("calendar feed", () => {
  it("has open Canvas work, expected quizzes and added tasks — not done work", () => {
    const { db, mod } = setup();
    const a = db.insert(items).values([
      { ...base, moduleId: mod.id, type: "assignment", sourceId: "assignment:1", title: "Lab 3", dueAt: now + 2 * D, url: "https://canvas/x" },
      { ...base, moduleId: mod.id, type: "assignment", sourceId: "assignment:2", title: "Lab 2", dueAt: now + D, submitted: true },
    ]).returning().all();
    db.insert(tasks).values({ userId: 1, moduleId: mod.id, key: "cs4238-series-quiz-4", title: "Quiz 4 (expected)", kind: "quiz", dueAt: now + 5 * D, dueConfidence: "estimated", anticipated: true,
      sourcesJson: JSON.stringify([{ kind: "canvas", label: "Quiz 3", itemId: a[0]!.id }]), stepsJson: "[]", status: "open", createdAt: now, updatedAt: now }).run();
    createManualTask(db, 1, { title: "Print notes", dueAt: now + 3 * D, moduleId: null }, now);
    const ev = calendarEvents(db, 1, now, { steps: false, baseUrl: "https://op" });
    const titles = ev.map((e) => e.title);
    expect(titles).toContain("CS4238: Lab 3 due");
    expect(titles).not.toContain("CS4238: Lab 2 due");
    expect(titles).toContain("CS4238: Quiz 4 (expected) (date estimated)");
    expect(titles).toContain("Print notes");
  });
});

describe("account data", () => {
  it("exports without secrets and deletes only this student", () => {
    const { db, mod, other } = setup();
    db.insert(items).values([{ ...base, moduleId: mod.id, type: "announcement", sourceId: "ann:1", title: "Hi" }, { ...base, userId: 2, moduleId: other.id, type: "announcement", sourceId: "ann:2", title: "Yo" }]).run();
    db.insert(studyGuides).values({ moduleId: mod.id, markdown: "## 1. X\n\ny", generatedAt: now }).run();
    db.insert(guideQuizzes).values({ moduleId: mod.id, chapterHash: "h", questionsJson: "[]", createdAt: now }).run();
    recordLlmCall(db, 1, true, now);
    const ex = exportAccount(db, 1)!;
    expect(ex.user).not.toHaveProperty("passwordHash");
    expect(ex.user).not.toHaveProperty("calendarToken");
    expect(ex.items).toHaveLength(1);
    deleteAccount(db, 1);
    expect(db.select().from(users).all().map((u) => u.id)).toEqual([2]);
    expect(db.select().from(modules).all().map((m) => m.id)).toEqual([other.id]);
    expect(db.select().from(items).all()).toHaveLength(1);
    expect(db.select().from(llmUsage).all()).toHaveLength(0);
  });
});

describe("shared AI allowance", () => {
  it("counts shared calls per month", () => {
    const { db } = setup();
    for (let i = 0; i < 3; i++) recordLlmCall(db, 1, true, now);
    recordLlmCall(db, 1, false, now);
    expect(usageThisMonth(db, 1, now)).toEqual({ calls: 4, sharedCalls: 3 });
    expect(sharedAllowanceLeft(db, 1, now, 3)).toBe(0);
    expect(sharedAllowanceLeft(db, 1, now + 31 * D, 3)).toBe(3);
  });
});

describe("teaching the planner", () => {
  it("records not-a-task and a corrected date, and shows them to the planner", () => {
    const { db, mod } = setup();
    const t = db.insert(tasks).values({ userId: 1, moduleId: mod.id, key: "cs4238-bring-laptop", title: "Bring laptop", kind: "prep", dueAt: now + D, stepsJson: JSON.stringify([{ id: "a", text: "x", minutes: 30, doBy: "2026-10-09", done: false }]), createdAt: now, updatedAt: now }).returning().get();
    const u = db.insert(tasks).values({ userId: 1, moduleId: mod.id, key: "cs4238-midterm", title: "Midterm", kind: "exam", dueAt: now + 20 * D, dueConfidence: "estimated", createdAt: now, updatedAt: now }).returning().get();
    expect(updateTask(db, 1, t.id, { notTask: true }, now)).toBe(true);
    expect(updateTask(db, 1, u.id, { dueDate: "2026-10-08" }, now)).toBe(true);
    expect(updateTask(db, 1, u.id, { dueDate: "8 Oct" }, now)).toBe(false);
    expect(db.select().from(tasks).where(eq(tasks.id, t.id)).get()!.status).toBe("dismissed");
    const mid = db.select().from(tasks).where(eq(tasks.id, u.id)).get()!;
    expect(mid).toMatchObject({ dueLocked: true, dueConfidence: "exact", dueAt: Date.parse("2026-10-08T23:59:00+08:00") });
    expect(db.select().from(taskFeedback).all().map((f) => f.kind)).toEqual(["not_task", "wrong_date"]);
    const { input } = moduleSignals(db, 1, mod, now);
    expect(input.feedback!.join("\n")).toMatch(/Bring laptop" is NOT a real task/);
    expect(input.feedback!.join("\n")).toMatch(/really 2026-10-08/);
  });
  it("adds manual tasks with one step", () => {
    const { db, mod } = setup();
    const id = createManualTask(db, 1, { title: "  Email   Prof Tan ", dueAt: Date.parse("2026-10-05T23:59:00+08:00"), moduleId: mod.id }, now)!;
    const t = db.select().from(tasks).where(eq(tasks.id, id)).get()!;
    expect(t.title).toBe("Email Prof Tan");
    expect(JSON.parse(t.stepsJson)[0]).toMatchObject({ doBy: "2026-10-04" });
    expect(createManualTask(db, 1, { title: "x", dueAt: null, moduleId: null }, now)).toBeNull();
    // Someone else's module is not attached.
    const id2 = createManualTask(db, 1, { title: "Thing", dueAt: null, moduleId: 999 }, now)!;
    expect(db.select().from(tasks).where(eq(tasks.id, id2)).get()!.moduleId).toBeNull();
  });
  it("edits like a calendar app: rename, re-time, notes, doing, delete only your own", () => {
    const { db, mod, other } = setup();
    const dentist = createManualTask(db, 1, { title: "Dentist", dueAt: Date.parse("2026-10-08T15:00:00+08:00"), moduleId: null, kind: "personal" }, now)!;
    expect(JSON.parse(db.select().from(tasks).where(eq(tasks.id, dentist)).get()!.stepsJson)).toEqual([]);
    // Moving the day keeps the time; a new time keeps the day.
    expect(updateTask(db, 1, dentist, { dueDate: "2026-10-07" }, now)).toBe(true);
    expect(db.select().from(tasks).where(eq(tasks.id, dentist)).get()!.dueAt).toBe(Date.parse("2026-10-07T15:00:00+08:00"));
    expect(updateTask(db, 1, dentist, { time: "09:30" }, now)).toBe(true);
    expect(db.select().from(tasks).where(eq(tasks.id, dentist)).get()!.dueAt).toBe(Date.parse("2026-10-07T09:30:00+08:00"));
    expect(updateTask(db, 1, dentist, { time: "9pm" }, now)).toBe(false);
    expect(updateTask(db, 1, dentist, { moduleId: other.id }, now)).toBe(false);
    expect(updateTask(db, 1, dentist, { moduleId: mod.id, notes: "  bring card  ", started: true }, now)).toBe(true);
    expect(db.select().from(tasks).where(eq(tasks.id, dentist)).get()).toMatchObject({ moduleId: mod.id, notes: "bring card" });
    expect(db.select().from(tasks).where(eq(tasks.id, dentist)).get()!.startedAt).toBe(now);
    expect(updateTask(db, 1, dentist, { noDate: true }, now)).toBe(true);
    expect(db.select().from(tasks).where(eq(tasks.id, dentist)).get()!.dueAt).toBeNull();

    const quiz = db.insert(tasks).values({ userId: 1, moduleId: mod.id, key: "cs4238-quiz-3", title: "Quiz 3 (expected)", kind: "quiz", dueAt: now + 5 * D, createdAt: now, updatedAt: now }).returning().get();
    expect(updateTask(db, 1, quiz.id, { moduleId: null }, now)).toBe(false);
    expect(updateTask(db, 1, quiz.id, { noDate: true }, now)).toBe(false);
    expect(updateTask(db, 1, quiz.id, { title: "Quiz 3 — in lecture" }, now)).toBe(true);
    expect(deleteManualTask(db, 1, quiz.id)).toBe(false);
    expect(deleteManualTask(db, 2, dentist)).toBe(false);
    expect(deleteManualTask(db, 1, dentist)).toBe(true);
    expect(db.select().from(tasks).where(eq(tasks.id, dentist)).get()).toBeUndefined();

    // A rebuild keeps the student's title.
    applyPlan(db, 1, mod.id, [{ key: "cs4238-quiz-3", title: "Quiz 3", kind: "quiz", dueAt: now + 5 * D, dueConfidence: "exact", anticipated: false, weightPct: 10, why: null, sources: [], steps: [] }], now);
    expect(db.select().from(tasks).where(eq(tasks.id, quiz.id)).get()).toMatchObject({ title: "Quiz 3 — in lecture", weightPct: 10 });
  });

  it("keeps a date the student set, until an announcement posted after it moves it", () => {
    const { db, mod } = setup();
    const quiz = db.insert(tasks).values({ userId: 1, moduleId: mod.id, key: "cs4238-quiz-3", title: "Quiz 3", kind: "quiz", dueAt: Date.parse("2026-10-04T23:59:00+08:00"), createdAt: now, updatedAt: now }).returning().get();
    expect(updateTask(db, 1, quiz.id, { dueDate: "2026-10-06" }, now)).toBe(true);
    const plan = (dueAt: number, itemId?: number) => [{ key: "cs4238-quiz-3", title: "Quiz 3", kind: "quiz" as const, dueAt, dueConfidence: "exact" as const, anticipated: false, weightPct: null, why: null,
      sources: itemId ? [{ kind: "announcement" as const, label: "Quiz-3 in Week 9", itemId }] : [], steps: [] }];
    const week9 = Date.parse("2026-10-13T18:30:00+08:00");
    // The planner disagreeing on its own changes nothing…
    applyPlan(db, 1, mod.id, plan(week9), now + D);
    expect(db.select().from(tasks).where(eq(tasks.id, quiz.id)).get()!.dueAt).toBe(Date.parse("2026-10-06T23:59:00+08:00"));
    // …nor does an announcement from before the student's change…
    const old = db.insert(items).values({ ...base, moduleId: mod.id, type: "announcement", sourceId: "announcement:1", title: "Schedule", sourceCreatedAt: now - D }).returning().get();
    applyPlan(db, 1, mod.id, plan(week9, old.id), now + D);
    expect(db.select().from(tasks).where(eq(tasks.id, quiz.id)).get()!.dueLocked).toBe(true);
    // …but one posted after it does, and the student's stale correction goes.
    const moved = db.insert(items).values({ ...base, moduleId: mod.id, type: "announcement", sourceId: "announcement:2", title: "Quiz-3 in Week 9", sourceCreatedAt: now + D / 2 }).returning().get();
    applyPlan(db, 1, mod.id, plan(week9, moved.id), now + D);
    expect(db.select().from(tasks).where(eq(tasks.id, quiz.id)).get()).toMatchObject({ dueAt: week9, dueLocked: false });
    expect(db.select().from(taskFeedback).all().filter((f) => f.kind === "wrong_date")).toEqual([]);
  });
});

describe("search", () => {
  it("finds guide sections, announcements and tasks, only the student's own", () => {
    const { db, mod, other } = setup();
    db.insert(studyGuides).values({ moduleId: mod.id, markdown: "# G\n\n## 1. Memory safety\n\n### Stack canaries\n\nA canary value sits before the return address.", generatedAt: now }).run();
    db.insert(items).values([
      { ...base, moduleId: mod.id, type: "announcement", sourceId: "ann:1", title: "Quiz 2 venue", body: "<p>The canary quiz is in LT19</p>" },
      { ...base, userId: 2, moduleId: other.id, type: "announcement", sourceId: "ann:2", title: "canary for b" },
    ]).run();
    createManualTask(db, 1, { title: "Revise canary notes", dueAt: null, moduleId: mod.id }, now);
    const hits = search(db, 1, "canary", now);
    expect(hits.map((h) => h.kind).sort()).toEqual(["announcement", "guide", "task"]);
    expect(hits.find((h) => h.kind === "guide")!.href).toBe(`/modules/${mod.id}/guide#stack-canaries`);
    expect(search(db, 1, "cs4238", now)[0]!.kind).toBe("module");
    expect(search(db, 1, "x", now)).toEqual([]);
  });
});
