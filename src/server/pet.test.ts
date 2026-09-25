import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { components, items, modules, tasks, users } from "@/db/schema";
import { dueList, factSheet, reminders, ruleAnswer, sgt } from "./pet";

const NOW = Date.UTC(2026, 8, 25, 2); // Fri 25 Sep, 10:00 SGT
const H = 3_600_000, D = 24 * H;
function setup() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "A" }).run();
  db.insert(modules).values([
    { userId: 1, canvasCourseId: 1, code: "CS4238", name: "Computer Security Practice", active: true },
    { userId: 1, canvasCourseId: 2, code: "ST2334", name: "Probability and Statistics", active: true },
  ]).run();
  db.insert(components).values({ moduleId: 1, name: "Quizzes", weightPct: 40, source: "canvas_api" }).run();
  db.insert(items).values([
    { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a1", title: "Quiz 2", dueAt: NOW - 2 * D, submitted: true, firstSeenAt: NOW },
    { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a2", title: "Quiz 3", dueAt: NOW + 5 * D + 13 * H, firstSeenAt: NOW },
    { userId: 1, moduleId: 1, type: "assignment", source: "canvas", sourceId: "a3", title: "Incident report 1", dueAt: NOW + 6 * H, firstSeenAt: NOW },
    { userId: 1, moduleId: 2, type: "assignment", source: "canvas", sourceId: "a4", title: "Tutorial 4", dueAt: NOW - D, missing: true, firstSeenAt: NOW },
    { userId: 1, moduleId: 2, type: "event", source: "canvas", sourceId: "e1", title: "Lecture", dueAt: NOW + D, firstSeenAt: NOW },
    { userId: 1, moduleId: 2, type: "event", source: "canvas", sourceId: "e2", title: "Lecture", dueAt: NOW + 8 * D, firstSeenAt: NOW },
    { userId: 1, moduleId: 1, type: "staff_reply", source: "canvas", sourceId: "r1", title: "Re: Quiz 3 thread", sender: "Dr Lim", body: "<p>Quiz 3 covers L4-L6.</p>", sourceCreatedAt: NOW - H, firstSeenAt: NOW },
  ]).run();
  db.insert(tasks).values({ userId: 1, moduleId: 1, key: "k", title: "Quiz 3 prep", kind: "quiz", dueAt: NOW + 5 * D, stepsJson: JSON.stringify([{ id: "s", text: "Redo L5 exercises", minutes: 30, doBy: "2026-09-25", done: false }]), createdAt: NOW, updatedAt: NOW }).run();
  return db;
}
const codes = ["CS4238", "ST2334"];

describe("pet facts", () => {
  it("formats Singapore time with the weekday", () => {
    expect(sgt(NOW)).toBe("Fri 25 Sep, 10:00");
  });
  it("lists dated work once, with weight, state and only the next class", () => {
    const d = dueList(setup(), 1, NOW);
    expect(d.map((x) => [x.title, x.kind, x.done, x.missing])).toEqual([
      ["Quiz 2", "quiz", true, false], ["Tutorial 4", "tutorial", false, true], ["Incident report 1", "assignment", false, false],
      ["Lecture", "class", false, false], ["Quiz 3", "quiz", false, false],
    ]);
    expect(d.find((x) => x.title === "Quiz 3")!.weightPct).toBe(40);
  });
  it("gives the model modules, weights, dates, tasks and what lecturers said", () => {
    const f = factSheet(setup(), 1, NOW);
    expect(f).toContain("CS4238 Computer Security Practice; weightage: Quizzes 40%");
    expect(f).toContain("CS4238 | quiz | Quiz 3 | due Wed 30 Sep, 23:00 | open | counts toward Quizzes (40% of grade in total)");
    expect(f).toContain("ST2334 | tutorial | Tutorial 4 | due Thu 24 Sep, 10:00 | MISSING on Canvas");
    expect(f).toContain("next: Redo L5 exercises");
    expect(f).toContain("Dr Lim in a discussion | Re: Quiz 3 thread: Quiz 3 covers L4-L6.");
  });
});

describe("rule answers", () => {
  const due = dueList(setup(), 1, NOW);
  it("answers 'when is the next quiz for 4238'", () => {
    expect(ruleAnswer("when is next quiz for 4238", due, codes, NOW)).toBe("Next quiz for CS4238: CS4238 Quiz 3 — Wed 30 Sep, 23:00 (part of Quizzes, 40%).");
  });
  it("lists what is due this week and flags missing work", () => {
    const a = ruleAnswer("what's due this week for st2334?", due, codes, NOW);
    expect(a).toMatch(/can't see any upcoming thing due for ST2334/);
    expect(a).toContain("Canvas says Tutorial 4 is missing");
  });
});

describe("rule answers about missing work and what was said", () => {
  it("names missing or late work, and recent staff replies", () => {
    const db = setup();
    const due = dueList(db, 1, NOW);
    expect(ruleAnswer("anything missing?", due, codes, NOW)).toBe("One thing: ST2334 Tutorial 4 (Canvas says missing).");
    const said = [{ code: "CS4238", who: "Dr Lim", title: "Quiz 3 thread", at: NOW - 3_600_000 }];
    expect(ruleAnswer("what did lecturers say recently?", due, codes, NOW, said)).toContain('CS4238 Dr Lim — "Quiz 3 thread" (Fri 25 Sep)');
  });
});

describe("reminders", () => {
  it("speaks up about missing work, soon deadlines, today's steps and staff replies", () => {
    const r = reminders(setup(), 1, NOW).join("\n");
    expect(r).toContain("Canvas thinks ST2334 Tutorial 4 is missing");
    expect(r).toContain("CS4238 Incident report 1 is due in about 6 hours");
    expect(r).toContain("1 step on today's list (30m)");
    expect(r).toContain("Dr Lim just replied in \"Quiz 3 thread\"");
  });
});
