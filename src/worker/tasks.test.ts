import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { fileHints, files, items, modules, taskPlans, tasks, users } from "../db/schema";
import { moduleSignals, refreshTasks, tidyTasks, usersWithTaskRequests, type TaskDeps } from "./tasks";
import type { TaskStep } from "../enrich/tasks";

const NOW = Date.UTC(2026, 8, 25, 2, 0); // Fri 25 Sep 2026, 10:00 SGT
const H = 3_600_000;
const cfg = { baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };

function setup() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "Aiden" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 11, code: "ST2334", name: "Probability and Statistics", active: true }).run();
  db.insert(items).values([
    { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a1", title: "Quiz 2", dueAt: NOW + 5 * 24 * H, firstSeenAt: NOW },
    { userId: 1, moduleId: 1, type: "announcement", source: "canvas", sourceId: "n1", title: "Quiz 2 next Wednesday", body: "<p>Quiz 2 covers L1-L5.</p>", sourceCreatedAt: NOW - 24 * H, firstSeenAt: NOW },
    { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a0", title: "Tutorial 3", dueAt: NOW - 3 * 24 * H, submitted: true, firstSeenAt: NOW },
  ]).run();
  db.insert(files).values({ moduleId: 1, canvasFileId: 7, displayName: "L5 Bayes.pdf", discoveredAt: NOW, category: "slides" }).run();
  return db;
}

function llm(plan: unknown, log: string[] = []) {
  return (async (_url: string, init?: RequestInit) => {
    log.push(String(JSON.parse(String(init?.body)).messages[1].content));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  }) as unknown as typeof fetch;
}

const quizPlan = { tasks: [{
  key: "st2334-quiz-2", title: "Quiz 2", kind: "quiz", due: "2026-09-30T10:00:00+08:00", dueConfidence: "exact",
  sources: [{ ref: "C1", quote: "Quiz 2" }, { ref: "A2", quote: "covers L1-L5" }, { ref: "F1p2", quote: "Quiz 2 in Week 7" }],
  steps: [{ text: "Redo L4 examples", minutes: 40, doBy: "2026-09-26" }, { text: "Do the practice quiz", minutes: 30, doBy: "2026-09-29" }],
}, {
  key: "st2334-tutorial-4", title: "Tutorial 4", kind: "submission", due: "2026-09-28T23:59:00+08:00", dueConfidence: "estimated", anticipated: true,
  sources: [{ ref: "C3" }], steps: [{ text: "Attempt Q1-4", minutes: 45, doBy: "2026-09-27" }],
}] };

function deps(db: ReturnType<typeof createDb>, fetchFn: typeof fetch, now = NOW, text = "Intro\n-- 1 of 2 --\nQuiz 2 in Week 7 covers L1-L5\n-- 2 of 2 --"): TaskDeps {
  return { db, now: () => now, cfgFor: () => cfg, fileText: async () => text, fetchFn };
}

describe("refreshTasks", () => {
  it("reads slide hints, plans one task per obligation from every source, and anticipates the next tutorial", async () => {
    const db = setup();
    const log: string[] = [];
    const r = await refreshTasks(deps(db, llm(quizPlan, log)), 1);
    expect(r).toMatchObject({ files: 1, planned: 1, errors: [] });
    expect(log[0]).toContain("[C1] Canvas: Quiz 2");
    expect(log[0]).toContain("[A2] Quiz 2 next Wednesday");
    expect(log[0]).toContain("[F1p2] L5 Bayes.pdf p.2: Quiz 2 in Week 7 covers L1-L5");
    expect(log[0]).toContain("[C3] Tutorial 3");
    const rows = db.select().from(tasks).all();
    expect(rows.map((t) => [t.key, t.anticipated, JSON.parse(t.sourcesJson).length])).toEqual([["st2334-quiz-2", false, 3], ["st2334-tutorial-4", true, 1]]);
    expect(db.select().from(taskPlans).get()?.generatedAt).toBe(NOW);
  });

  it("keeps ticked steps through a rebuild and does not replan within the TTL", async () => {
    const db = setup();
    await refreshTasks(deps(db, llm(quizPlan)), 1);
    const quiz = db.select().from(tasks).where(eq(tasks.key, "st2334-quiz-2")).get()!;
    const steps = JSON.parse(quiz.stepsJson) as TaskStep[];
    steps[0]!.done = true;
    db.update(tasks).set({ stepsJson: JSON.stringify(steps), touchedAt: NOW }).where(eq(tasks.id, quiz.id)).run();

    const calls: string[] = [];
    await refreshTasks(deps(db, llm(quizPlan, calls), NOW + H), 1);
    expect(calls).toHaveLength(0); // inputs changed but inside the TTL

    const replanned = { tasks: [{ ...quizPlan.tasks[0], steps: [{ text: "Something else", minutes: 20, doBy: "2026-09-27" }] }] };
    await refreshTasks(deps(db, llm(replanned, calls), NOW + 4 * H), 1);
    expect(calls).toHaveLength(1);
    const after = JSON.parse(db.select().from(tasks).where(eq(tasks.key, "st2334-quiz-2")).get()!.stepsJson) as TaskStep[];
    expect(after.map((s) => [s.text, s.done])).toEqual([["Redo L4 examples", true], ["Do the practice quiz", false]]);
    // The untouched anticipated task the planner dropped is gone.
    expect(db.select().from(tasks).where(eq(tasks.key, "st2334-tutorial-4")).get()).toBeUndefined();
  });

  it("replans at once when asked, and clears the request", async () => {
    const db = setup();
    await refreshTasks(deps(db, llm(quizPlan)), 1);
    db.update(items).set({ title: "Quiz 2 (moved)" }).where(eq(items.id, 1)).run();
    db.update(users).set({ tasksRequestedAt: NOW }).run();
    expect(usersWithTaskRequests(db)).toEqual([1]);
    const calls: string[] = [];
    await refreshTasks(deps(db, llm(quizPlan, calls), NOW + H), 1);
    expect(calls).toHaveLength(1);
    expect(usersWithTaskRequests(db)).toEqual([]);
  });

  it("records a model failure without touching existing tasks", async () => {
    const db = setup();
    await refreshTasks(deps(db, llm(quizPlan)), 1);
    db.update(users).set({ tasksRequestedAt: NOW }).run();
    db.update(items).set({ title: "changed" }).where(eq(items.id, 2)).run();
    const r = await refreshTasks(deps(db, llm("not json at all"), NOW + H), 1);
    expect(r.errors[0]).toMatch(/ST2334/);
    expect(db.select().from(tasks).all()).toHaveLength(2);
    expect(db.select().from(taskPlans).get()?.error).toMatch(/expected shape/);
  });

  it("without a model still reads hints and tidies, but plans nothing", async () => {
    const db = setup();
    const r = await refreshTasks({ ...deps(db, llm(quizPlan)), cfgFor: () => null }, 1);
    expect(r).toMatchObject({ files: 1, planned: 0 });
    expect(db.select().from(fileHints).all()).toHaveLength(1);
  });
});

describe("tidyTasks", () => {
  it("marks work done once Canvas shows it submitted, and retires untouched tasks long past", async () => {
    const db = setup();
    await refreshTasks(deps(db, llm(quizPlan)), 1);
    db.update(items).set({ submitted: true }).where(eq(items.id, 1)).run();
    tidyTasks(db, 1, NOW);
    expect(db.select().from(tasks).where(eq(tasks.key, "st2334-quiz-2")).get()!.status).toBe("done");
    tidyTasks(db, 1, NOW + 10 * 24 * H);
    expect(db.select().from(tasks).where(eq(tasks.key, "st2334-tutorial-4")).get()!.status).toBe("dismissed");
  });
});

describe("moduleSignals", () => {
  it("leaves out dismissed and routine work", () => {
    const db = setup();
    db.insert(items).values([
      { userId: 1, moduleId: 1, type: "deadline", source: "canvas", sourceId: "d1", title: "Attend lab", dueAt: NOW + H, category: "routine", firstSeenAt: NOW },
      { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a9", title: "Old thing", dueAt: NOW + H, dismissed: true, firstSeenAt: NOW },
    ]).run();
    const { input } = moduleSignals(db, 1, db.select().from(modules).get()!, NOW);
    expect(input.canvas.map((c) => c.ref)).toEqual(["C1"]);
    expect(input.today).toBe("2026-09-25 (Fri)");
  });
});
