import { describe, expect, it } from "vitest";
import { balanceDays, cleanPlan, dailyCap, mergeTasks, obligationLines, rollForward, sgtDate, stepId, type TaskSource, type TaskStep } from "./tasks";

const NOW = Date.UTC(2026, 8, 25, 2, 0); // Fri 25 Sep 2026, 10:00 SGT
const refs = new Map<string, TaskSource>([
  ["C1", { kind: "canvas", label: "Quiz 2", itemId: 1 }],
  ["A9", { kind: "announcement", label: "Quiz 2 reminder", itemId: 9 }],
  ["F4p12", { kind: "file", label: "L5 p.12", fileId: 4, page: 12 }],
  ["W", { kind: "weightage", label: "Assessment weightage" }],
]);
const step = (text: string, doBy: string, minutes = 30, done = false): TaskStep => ({ id: stepId("k", text), text, minutes, doBy, done });

describe("cleanPlan", () => {
  it("keeps grounded tasks, merges their sources and quotes, and clamps steps into range", () => {
    const out = cleanPlan({ tasks: [{
      key: "quiz-2", title: "Quiz 2", kind: "quiz", due: "2026-09-30T23:59:00+08:00", dueConfidence: "exact", anticipated: false, weightPct: 10,
      why: "10% — covers L1-L5", sources: [{ ref: "C1", quote: "Quiz 2 opens" }, { ref: "[A9]" }, { ref: "Z99" }],
      steps: [{ text: "Redo L5 examples", minutes: 400, doBy: "2026-09-20" }, { text: "Do practice quiz", minutes: 30, doBy: "2026-10-09" }],
    }] }, refs, NOW, "ST2334")!;
    expect(out).toHaveLength(1);
    const t = out[0]!;
    expect(t.key).toBe("st2334-quiz-2");
    expect(t.sources.map((s) => s.label)).toEqual(["Quiz 2", "Quiz 2 reminder"]);
    expect(t.sources[0]!.quote).toBe("Quiz 2 opens");
    expect(t.steps.map((s) => s.doBy)).toEqual(["2026-09-25", "2026-09-30"]); // past → today, after due → due day
    expect(t.steps[0]!.minutes).toBe(180);
  });

  it("drops tasks with no real source, past tasks, and bad kinds become prep", () => {
    const out = cleanPlan({ tasks: [
      { key: "st2334-made-up", title: "Made up", kind: "quiz", due: null, sources: [{ ref: "nope" }] },
      { key: "st2334-old", title: "Old", kind: "quiz", due: "2026-09-01T10:00:00+08:00", sources: [{ ref: "C1" }] },
      { key: "st2334-read", title: "Read ch 4", kind: "homework", due: null, sources: [{ ref: "F4p12" }] },
    ] }, refs, NOW, "ST2334")!;
    expect(out.map((t) => [t.key, t.kind, t.dueConfidence])).toEqual([["st2334-read", "prep", "estimated"]]);
  });

  it("drops attendance, and gives weightage-only tasks no date and one step", () => {
    const out = cleanPlan({ tasks: [
      { key: "st2334-lab", title: "Attend lab 3", kind: "prep", due: "2026-09-27T14:00:00+08:00", sources: [{ ref: "A9" }] },
      { key: "st2334-midterm", title: "Midterm revision", kind: "exam", due: "2026-10-06T09:00:00+08:00", dueConfidence: "estimated", sources: [{ ref: "W" }],
        steps: [{ text: "Review L1-L4", minutes: 60, doBy: "2026-09-28" }, { text: "Past paper", minutes: 90, doBy: "2026-10-03" }] },
      { key: "st2334-w2", title: "Quizzes", kind: "quiz", sources: [{ ref: "W" }] },
      { key: "st2334-w3", title: "Project", kind: "project", sources: [{ ref: "W" }] },
    ] }, refs, NOW, "ST2334")!;
    expect(out.map((t) => [t.key, t.dueAt, t.anticipated, t.steps.length])).toEqual([["st2334-midterm", null, true, 1], ["st2334-w2", null, true, 0]]);
  });

  it("returns null for an answer that is not a plan", () => {
    expect(cleanPlan("nope", refs, NOW, "X")).toBeNull();
  });
});

describe("mergeTasks", () => {
  const planned = (key: string) => ({ key, title: key, kind: "quiz" as const, dueAt: null, dueConfidence: "estimated" as const, anticipated: false, weightPct: null, why: null, sources: [], steps: [] });
  it("inserts new, refreshes known, keeps progress, and removes only untouched stale tasks", () => {
    const ops = mergeTasks([
      { id: 1, key: "a", status: "open", touchedAt: null, steps: [] },
      { id: 2, key: "b", status: "open", touchedAt: null, steps: [step("x", "2026-09-25", 30, true)] },
      { id: 3, key: "c", status: "open", touchedAt: null, steps: [] },
      { id: 4, key: "d", status: "open", touchedAt: 5, steps: [] },
      { id: 5, key: "e", status: "done", touchedAt: null, steps: [] },
    ], [planned("a"), planned("b"), planned("e"), planned("new")]);
    expect(ops.insert.map((t) => t.key)).toEqual(["new"]);
    expect(ops.update.map((u) => [u.id, u.keepSteps])).toEqual([[1, false], [2, true], [5, true]]);
    expect(ops.remove).toEqual([3]);
  });
});

describe("schedule", () => {
  it("rolls missed steps forward, spread before the due date", () => {
    const due = Date.parse("2026-09-29T23:59:00+08:00");
    const out = rollForward([step("a", "2026-09-22"), step("b", "2026-09-23"), step("c", "2026-09-24", 30, true), step("d", "2026-09-27")], "2026-09-25", due);
    const byText = Object.fromEntries(out.map((s) => [s.text, s.doBy]));
    expect(byText.a).toBe("2026-09-25");
    expect(byText.b >= "2026-09-25" && byText.b <= "2026-09-28").toBe(true);
    expect(byText.c).toBe("2026-09-24"); // done steps stay where they were
    expect(byText.d).toBe("2026-09-27");
  });

  it("moves work off an overloaded day, from the task with the most slack", () => {
    const soon = { key: "soon", dueAt: Date.parse("2026-09-26T12:00:00+08:00"), steps: [step("s1", "2026-09-25", 120)] };
    const later = { key: "later", dueAt: Date.parse("2026-10-05T12:00:00+08:00"), steps: [step("l1", "2026-09-25", 90), step("l2", "2026-09-25", 60)] };
    const moved = balanceDays([soon, later], "2026-09-25", () => 180);
    expect([...moved]).toEqual(["later"]);
    expect(soon.steps[0]!.doBy).toBe("2026-09-25");
    const load = [...soon.steps, ...later.steps].filter((s) => s.doBy === "2026-09-25").reduce((n, s) => n + s.minutes, 0);
    expect(load).toBeLessThanOrEqual(180);
  });

  it("gives weekends more room", () => {
    expect(dailyCap("2026-09-26")).toBeGreaterThan(dailyCap("2026-09-25"));
    expect(sgtDate(Date.parse("2026-09-25T23:30:00+08:00"))).toBe("2026-09-25");
  });
});

describe("obligationLines", () => {
  it("finds dated obligations in slide text with their page", () => {
    const text = "Intro to probability\nRandom variables\n-- 1 of 3 --\nQuiz 2 in Week 7 covers L1-L5\nSee you\n-- 2 of 3 --\nRead Chapter 4 before the next lecture\nThanks\n-- 3 of 3 --";
    const lines = obligationLines(text);
    expect(lines).toEqual([
      { page: 2, text: "Quiz 2 in Week 7 covers L1-L5" },
      { page: 3, text: "Read Chapter 4 before the next lecture" },
    ]);
  });

  it("ignores lecture content that only sounds like work", () => {
    const text = "To pen-test your own systems too\n23% owner's correct name and physical address\nMandatory Access Control\nGoogle Project Zero: 90-day window\nIndividual Quizzes (approx. 4): 40%\nTry to get the local environment sorted by Week 2 of the course!\n-- 1 of 1 --";
    expect(obligationLines(text).map((l) => l.text)).toEqual(["Try to get the local environment sorted by Week 2 of the course!", "Individual Quizzes (approx. 4): 40%"]);
  });
});
