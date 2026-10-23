import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { items, modules, taskFeedback, taskPlans, tasks, users } from "../db/schema";
import type { CleanTask, TaskStep } from "../enrich/tasks";
import type { WeakSpot } from "../server/weak-topics";

// The chapter quizzes' weak spots, set per test.
const spots = vi.hoisted(() => ({ list: [] as WeakSpot[] }));
vi.mock("../server/weak-topics", () => ({ weakSpots: () => spots.list }));

const { addRevisionSteps, applyPlan, ensureCanvasCovered, moduleSignals, refreshTasks, tidyTasks, MAX_STALE } = await import("./tasks");

const NOW = Date.parse("2026-09-25T10:00:00+08:00"); // Fri 25 Sep 2026
const H = 3_600_000, D = 24 * H;
const sgt = (s: string) => Date.parse(`${s}+08:00`);
const cfg = { baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };

function setup() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "Aiden" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 11, code: "ST2334", name: "Probability and Statistics", active: true }).run();
  const ann = db.insert(items).values({ userId: 1, moduleId: 1, type: "announcement", source: "canvas", sourceId: "n1", title: "Quiz 3 next week",
    body: "<p>Quiz 3 covers L1-L5.</p>", sourceCreatedAt: NOW - D, firstSeenAt: NOW - D }).returning().get();
  return { db, ann };
}
const task = (t: Partial<CleanTask> & { key: string; title: string }): CleanTask => ({
  kind: "quiz", dueAt: NOW + 5 * D, dueConfidence: "exact", anticipated: false, weightPct: null, why: null, sources: [{ kind: "announcement", label: "Quiz 3 next week", itemId: 1 }], steps: [], ...t,
});
const row = (db: ReturnType<typeof createDb>, key: string) => db.select().from(tasks).where(eq(tasks.key, key)).get();
const stepsOf = (db: ReturnType<typeof createDb>, key: string) => JSON.parse(row(db, key)!.stepsJson) as TaskStep[];
const st = (text: string, doBy: string, done = false, minutes = 30): TaskStep => ({ id: text, text, minutes, doBy, done });

function llm(plan: unknown, log: string[] = []) {
  return (async (_url: string, init?: RequestInit) => {
    const msgs = JSON.parse(String(init?.body)).messages;
    const isRoadmap = String(msgs[0].content).startsWith("You read a university course");
    if (!isRoadmap) log.push(String(msgs[1].content));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(isRoadmap ? { items: [] } : plan) } }] }));
  }) as unknown as typeof fetch;
}
const deps = (db: ReturnType<typeof createDb>, fetchFn: typeof fetch, now = NOW) => ({ db, now: () => now, cfgFor: () => cfg, fileText: async () => null, fetchFn });

describe("not a real task", () => {
  it("stays gone under a new key or a reworded title, whatever the prompt's cap", () => {
    const { db } = setup();
    applyPlan(db, 1, 1, [task({ key: "st2334-quiz-3", title: "Quiz 3" }), task({ key: "st2334-reading", title: "Weekly reading", kind: "reading" })], NOW);
    db.update(tasks).set({ status: "dismissed", touchedAt: NOW }).where(eq(tasks.key, "st2334-quiz-3")).run();
    // Twenty other corrections since: the prompt only sees the latest 15.
    db.insert(taskFeedback).values(Array.from({ length: 20 }, (_, i) => ({ userId: 1, moduleId: 1, kind: "not_task" as const, title: `Thing ${i}`, createdAt: NOW + i }))).run();
    db.insert(taskFeedback).values({ userId: 1, moduleId: 1, kind: "not_task", title: "Weekly reading", createdAt: NOW - 1 }).run();
    db.update(tasks).set({ status: "dismissed", touchedAt: NOW }).where(eq(tasks.key, "st2334-reading")).run();
    applyPlan(db, 1, 1, [task({ key: "st2334-q3-inclass", title: "Submit Quiz-3" }), task({ key: "st2334-readings", title: "Prepare for weekly reading", kind: "reading" }),
      task({ key: "st2334-quiz-4", title: "Quiz 4" })], NOW + H);
    const open = db.select().from(tasks).all().filter((t) => t.status === "open").map((t) => t.key);
    expect(open).toEqual(["st2334-quiz-4"]);
    expect(row(db, "st2334-quiz-3")!.status).toBe("dismissed");
  });

  it("comes back when Canvas posts the work after the student said so", () => {
    const { db } = setup();
    applyPlan(db, 1, 1, [task({ key: "st2334-quiz-3", title: "Quiz 3" })], NOW);
    db.update(tasks).set({ status: "dismissed", touchedAt: NOW }).where(eq(tasks.key, "st2334-quiz-3")).run();
    const q = db.insert(items).values({ userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a3", title: "Quiz 3", dueAt: NOW + 6 * D, firstSeenAt: NOW + D }).returning().get();
    applyPlan(db, 1, 1, [task({ key: "st2334-quiz-3-canvas", title: "Quiz 3", sources: [{ kind: "canvas", label: "Quiz 3", itemId: q.id }] })], NOW + D);
    expect(row(db, "st2334-quiz-3-canvas")!.status).toBe("open");
  });
});

describe("steps follow the date", () => {
  it("when a replan moves a touched task's date, and the planner's new steps are added", () => {
    const { db } = setup();
    applyPlan(db, 1, 1, [task({ key: "st2334-quiz-3", title: "Quiz 3", dueAt: sgt("2026-10-09T23:59:00"),
      steps: [st("Redo L4 examples", "2026-09-26"), st("Past paper", "2026-10-07")] })], NOW);
    const steps = stepsOf(db, "st2334-quiz-3");
    steps[0]!.done = true;
    db.update(tasks).set({ stepsJson: JSON.stringify(steps), touchedAt: NOW }).where(eq(tasks.key, "st2334-quiz-3")).run();
    // The quiz is now a week earlier, and covers more.
    applyPlan(db, 1, 1, [task({ key: "st2334-quiz-3", title: "Quiz 3", dueAt: sgt("2026-10-01T23:59:00"),
      steps: [st("Redo L4 examples", "2026-09-26"), st("Past paper", "2026-09-29"), st("Review L6-L7", "2026-09-28")] })], NOW + H);
    expect(stepsOf(db, "st2334-quiz-3").map((s) => [s.text, s.doBy, s.done])).toEqual([
      ["Redo L4 examples", "2026-09-26", true], ["Review L6-L7", "2026-09-28", false], ["Past paper", "2026-10-01", false],
    ]);
  });
});

describe("the safety net and the planner's own task", () => {
  it("is one task: the planner's takes the Canvas item on, with Canvas's date", () => {
    const { db } = setup();
    applyPlan(db, 1, 1, [task({ key: "st2334-quiz-3", title: "Quiz 3", dueAt: NOW + 4 * D, dueConfidence: "estimated", steps: [st("Review L5", "2026-09-28")] })], NOW);
    const q = db.insert(items).values({ userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a3", title: "Quiz-3", dueAt: NOW + 3 * D, firstSeenAt: NOW + H }).returning().get();
    expect(ensureCanvasCovered(db, 1, NOW + H)).toBe(0);
    const all = db.select().from(tasks).all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: "st2334-quiz-3", dueAt: NOW + 3 * D, dueConfidence: "exact" });
    expect(JSON.parse(all[0]!.sourcesJson)[0]).toMatchObject({ kind: "canvas", itemId: q.id });
    expect(stepsOf(db, "st2334-quiz-3")[0]!.doBy).toBe("2026-09-28");
  });
});

describe("tidyTasks", () => {
  it("doesn't let a hidden, only-expected task push the visible ones later", () => {
    const { db } = setup();
    db.insert(tasks).values([
      { userId: 1, moduleId: 1, key: "st2334-series-quiz-4", title: "Quiz 4 (expected)", kind: "quiz", dueAt: NOW + 20 * D, anticipated: true, dueConfidence: "estimated",
        sourcesJson: JSON.stringify([{ kind: "canvas", label: "Quiz 3", itemId: 1 }]), stepsJson: JSON.stringify([st("Skim L8", "2026-09-25", false, 150)]), createdAt: NOW, updatedAt: NOW },
      { userId: 1, moduleId: 1, key: "st2334-quiz-3", title: "Quiz 3", kind: "quiz", dueAt: NOW + 20 * D,
        sourcesJson: JSON.stringify([{ kind: "announcement", label: "Quiz 3 next week", itemId: 1 }]), stepsJson: JSON.stringify([st("Review L5", "2026-09-25", false, 60)]), createdAt: NOW, updatedAt: NOW },
    ]).run();
    tidyTasks(db, 1, NOW);
    expect(stepsOf(db, "st2334-quiz-3")[0]!.doBy).toBe("2026-09-25");
  });

  it("has less room on a day full of classes", () => {
    const { db } = setup();
    db.insert(items).values([0, 1, 2].map((i) => ({ userId: 1, moduleId: 1, type: "event" as const, source: "canvas" as const, sourceId: `e${i}`, title: `Class ${i}`, dueAt: sgt("2026-09-25T13:00:00") + i * H, firstSeenAt: NOW }))).run();
    db.insert(tasks).values({ userId: 1, moduleId: 1, key: "st2334-quiz-3", title: "Quiz 3", kind: "quiz", dueAt: NOW + 6 * D,
      sourcesJson: JSON.stringify([{ kind: "announcement", label: "Quiz 3 next week", itemId: 1 }]), stepsJson: JSON.stringify([st("a", "2026-09-25", false, 60), st("b", "2026-09-25", false, 60)]), createdAt: NOW, updatedAt: NOW }).run();
    tidyTasks(db, 1, NOW);
    // 180 minutes less three classes leaves 60: one of the two moves on.
    expect(stepsOf(db, "st2334-quiz-3").map((s) => s.doBy)).toEqual(["2026-09-25", "2026-09-26"]);
  });
});

describe("planning again", () => {
  const quiz = (due: string) => ({ tasks: [{ key: "st2334-quiz-2", title: "Quiz 2", kind: "quiz", due, dueConfidence: "exact",
    sources: [{ ref: "C2", quote: "Quiz 2" }], steps: [{ text: "Redo L4 examples", minutes: 40, doBy: "2026-09-26" }] }] });
  const withQuiz = () => {
    const s = setup();
    s.db.insert(items).values({ userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "assignment:2", title: "Quiz 2", dueAt: sgt("2026-09-30T23:59:00"), firstSeenAt: NOW }).run();
    return s;
  };

  it("takes Canvas's date over the planner's and reports the disagreement", async () => {
    const { db } = withQuiz();
    const r = await refreshTasks(deps(db, llm(quiz("2026-09-29T10:00:00+08:00"))), 1);
    expect(row(db, "st2334-quiz-2")).toMatchObject({ dueAt: sgt("2026-09-30T23:59:00"), dueConfidence: "exact" });
    expect(r.checked).toEqual(["ST2334 Quiz 2: date from Canvas: the planner said 2026-09-29 10:00 (Tue), Canvas says 2026-09-30 23:59 (Wed)"]);
  });

  it("doesn't ask the model again just because a day passed or a step was ticked, but does after a week", async () => {
    const { db } = withQuiz();
    const log: string[] = [];
    await refreshTasks(deps(db, llm(quiz("2026-09-30T23:59:00+08:00"), log)), 1);
    expect(log).toHaveLength(1);
    const steps = stepsOf(db, "st2334-quiz-2");
    steps[0]!.done = true;
    db.update(tasks).set({ stepsJson: JSON.stringify(steps), touchedAt: NOW + H }).where(eq(tasks.key, "st2334-quiz-2")).run();
    await refreshTasks(deps(db, llm(quiz("2026-09-30T23:59:00+08:00"), log), NOW + D), 1);
    await refreshTasks(deps(db, llm(quiz("2026-09-30T23:59:00+08:00"), log), NOW + 2 * D), 1);
    expect(log).toHaveLength(1);
    expect(db.select().from(taskPlans).get()!.generatedAt).toBe(NOW);
    await refreshTasks(deps(db, llm(quiz("2026-09-30T23:59:00+08:00"), log), NOW + MAX_STALE + H), 1);
    expect(log).toHaveLength(2);
  });
});

describe("revising what the chapter quizzes showed", () => {
  it("is study advice for the planner and a short step before the next quiz", () => {
    const { db } = setup();
    spots.list = [
      { deck: "L5 Bayes.pdf", page: 12, topicTitle: "Bayes", missed: 2, lastMissedAt: NOW - D },
      { deck: "L5 Bayes.pdf", page: 13, topicTitle: "Bayes", missed: 1, lastMissedAt: NOW - D },
    ];
    const { input } = moduleSignals(db, 1, db.select().from(modules).get()!, NOW);
    expect(input.studyAdvice[0]).toBe("revise L5 Bayes slides 12-13 (Bayes): missed 3 quiz questions");
    applyPlan(db, 1, 1, [task({ key: "st2334-quiz-3", title: "Quiz 3", dueAt: sgt("2026-10-01T10:00:00") }), task({ key: "st2334-final", title: "Final exam", kind: "exam", dueAt: NOW + 60 * D })], NOW);
    expect(addRevisionSteps(db, 1, 1, NOW)).toBe(1);
    expect(stepsOf(db, "st2334-quiz-3")).toEqual([expect.objectContaining({ text: "Revise L5 Bayes slides 12-13", minutes: 20, doBy: "2026-09-30", done: false })]);
    expect(addRevisionSteps(db, 1, 1, NOW)).toBe(0);            // once
    // Got right since: the step goes, unless it was done.
    spots.list = [];
    expect(addRevisionSteps(db, 1, 1, NOW + H)).toBe(1);
    expect(stepsOf(db, "st2334-quiz-3")).toEqual([]);
  });
});
