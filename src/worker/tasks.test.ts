import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { fileHints, files, items, modules, taskPlans, tasks, users } from "../db/schema";
import { ensureCanvasCovered, ensureQuizSeries, moduleSignals, refreshTasks, tidyTasks, usersWithTaskRequests, type TaskDeps } from "./tasks";
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

// Answers the planner with `plan`; the roadmap reader (which runs first)
// with `roadmap`, kept out of the planner's log.
function llm(plan: unknown, log: string[] = [], roadmap: unknown = { items: [] }, roadLog: string[] = []) {
  return (async (_url: string, init?: RequestInit) => {
    const msgs = JSON.parse(String(init?.body)).messages;
    const isRoadmap = String(msgs[0].content).startsWith("You read a university course");
    (isRoadmap ? roadLog : log).push(String(msgs[1].content));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(isRoadmap ? roadmap : plan) } }] }));
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
  it("tells the planner a quiz is a quiz, and when it opens and closes", () => {
    const db = setup();
    db.insert(items).values({ userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "assignment:5", title: "Quiz 3", dueAt: NOW + 7 * 24 * H, firstSeenAt: NOW,
      metaJson: JSON.stringify({ quiz: true, opensAt: NOW + 5 * 24 * H, closesAt: NOW + 7 * 24 * H, closesOnly: true }) }).run();
    const { input } = moduleSignals(db, 1, db.select().from(modules).get()!, NOW);
    const line = input.canvas.find((c) => c.line.includes("Quiz 3"))!.line;
    expect(line).toMatch(/^Canvas quiz: Quiz 3 — closes .*, opens /);
  });
});

describe("discussions, planner notes and the safety net", () => {
  it("feeds staff replies, discussions and notes to the planner, and covers what it skips", async () => {
    const db = setup();
    db.insert(items).values([
      { userId: 1, moduleId: 1, type: "discussion", source: "canvas", sourceId: "discussion:7", title: "Forum: intro post", dueAt: NOW + 2 * 24 * H, firstSeenAt: NOW,
        metaJson: JSON.stringify({ graded: false, requireInitialPost: true, posted: false, replies: 4, locked: false, assignmentId: null }) },
      { userId: 1, moduleId: 1, type: "staff_reply", source: "canvas", sourceId: "discussion:7:entry:9", title: "Re: Forum: intro post", sender: "Dr Tan",
        body: "Quiz 2 only covers L1-L4.", sourceCreatedAt: NOW - H, firstSeenAt: NOW, metaJson: JSON.stringify({ topicSourceId: "discussion:7", topicTitle: "Forum: intro post" }) },
      { userId: 1, moduleId: 1, type: "planner_note", source: "canvas", sourceId: "planner_note:3", title: "Email tutor about groups", dueAt: NOW + 24 * H, firstSeenAt: NOW },
      { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a5", title: "Lab report 2", dueAt: NOW + 3 * 24 * H, missing: false, firstSeenAt: NOW },
    ]).run();
    const log: string[] = [];
    await refreshTasks(deps(db, llm(quizPlan, log)), 1);
    expect(log[0]).toContain("Dr Tan replied in the discussion “Forum: intro post”");
    expect(log[0]).toContain("Quiz 2 only covers L1-L4.");
    expect(log[0]).toMatch(/\[D4\] Discussion: Forum: intro post — due .* must post before seeing replies, you have NOT posted/);
    expect(log[0]).toContain("[P6] Your own Canvas planner note: Email tutor about groups");
    const keys = db.select().from(tasks).all().map((t) => t.key).sort();
    // The planner's plan did not mention the note or the lab report, so the net catches them.
    expect(keys).toEqual(expect.arrayContaining(["st2334-canvas-6", "st2334-canvas-7", "st2334-quiz-2"]));
  });

  it("marks a discussion task done once you post, and a note done once ticked in Canvas", async () => {
    const db = setup();
    db.insert(items).values({ userId: 1, moduleId: 1, type: "planner_note", source: "canvas", sourceId: "planner_note:3", title: "Email tutor", dueAt: NOW + 24 * H, firstSeenAt: NOW }).run();
    await refreshTasks({ ...deps(db, llm(quizPlan)), cfgFor: () => null }, 1);
    const note = db.select().from(tasks).where(eq(tasks.key, "st2334-canvas-4")).get()!;
    expect(note.status).toBe("open");
    db.update(items).set({ canvasDone: true }).where(eq(items.id, 4)).run();
    tidyTasks(db, 1, NOW);
    expect(db.select().from(tasks).where(eq(tasks.id, note.id)).get()!.status).toBe("done");
  });
});

describe("ensureQuizSeries", () => {
  it("anticipates the next quiz, then gives way to the real one", () => {
    const db = setup();   // Quiz 2 is open on Canvas: nothing to anticipate yet
    expect(ensureQuizSeries(db, 1, NOW)).toBe(0);
    db.update(items).set({ submitted: true }).where(eq(items.sourceId, "a1")).run();
    db.insert(items).values({ userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a2", title: "Quiz 1", dueAt: NOW - 2 * 24 * H, submitted: true, firstSeenAt: NOW }).run();
    expect(ensureQuizSeries(db, 1, NOW + 6 * 24 * H)).toBe(1);
    const t = db.select().from(tasks).where(eq(tasks.key, "st2334-series-quiz-3")).get()!;
    expect(t).toMatchObject({ title: "Quiz 3 (expected)", kind: "quiz", anticipated: true, dueConfidence: "estimated", status: "open" });
    expect(ensureQuizSeries(db, 1, NOW + 6 * 24 * H)).toBe(0);            // once only
    db.insert(items).values({ userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a3", title: "Quiz 3", dueAt: NOW + 12 * 24 * H, firstSeenAt: NOW }).run();
    ensureQuizSeries(db, 1, NOW + 7 * 24 * H);
    expect(db.select().from(tasks).where(eq(tasks.key, "st2334-series-quiz-3")).get()!.status).toBe("dismissed");
  });
});

describe("forms posted once per tutorial group", () => {
  it("become one task, replace per-form tasks, and finish when yours is in", () => {
    const db = setup();
    const due = NOW + 5 * 24 * H;
    db.insert(items).values(["TD1", "TD2", "TE1", "TE2", "TE3"].map((c, k) => ({ userId: 1, moduleId: 1, type: "assignment" as const, source: "canvas" as const, sourceId: `f${k}`, title: `Indemnity Form (${c})`, dueAt: due, firstSeenAt: NOW }))).run();
    const forms = db.select().from(items).where(eq(items.dueAt, due)).all().filter((r) => r.title.startsWith("Indemnity"));
    db.insert(tasks).values({ userId: 1, moduleId: 1, key: `st2334-canvas-${forms[4].id}`, title: forms[4].title, kind: "submission", dueAt: due, dueConfidence: "exact", anticipated: false, sourcesJson: JSON.stringify([{ kind: "canvas", label: forms[4].title, itemId: forms[4].id }]), stepsJson: "[]", status: "dismissed", touchedAt: NOW, createdAt: NOW, updatedAt: NOW }).run();
    db.insert(tasks).values({ userId: 1, moduleId: 1, key: `st2334-canvas-${forms[2].id}`, title: forms[2].title, kind: "submission", dueAt: due, dueConfidence: "exact", anticipated: false, sourcesJson: JSON.stringify([{ kind: "canvas", label: forms[2].title, itemId: forms[2].id }]), stepsJson: "[]", status: "open", createdAt: NOW, updatedAt: NOW }).run();
    ensureCanvasCovered(db, 1, NOW);
    const mine = db.select().from(tasks).all().filter((t) => t.title.startsWith("Indemnity") && t.status === "open");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ key: `st2334-canvas-set-${forms[0].id}`, title: "Indemnity Form (your group's)" });
    ensureCanvasCovered(db, 1, NOW);
    expect(db.select().from(tasks).all().filter((t) => t.title.startsWith("Indemnity") && t.status === "open")).toHaveLength(1);
    db.update(items).set({ submitted: true }).where(eq(items.id, forms[3].id)).run();
    tidyTasks(db, 1, NOW);
    expect(db.select().from(tasks).where(eq(tasks.id, mine[0].id)).get()!.status).toBe("done");
  });
});
