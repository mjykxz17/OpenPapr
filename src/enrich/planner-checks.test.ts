import { describe, expect, it } from "vitest";
import {
  balanceDays, capWithClasses, cleanPlan, dailyCap, dayLoads, fitSteps, mergeTasks, newSteps, parseSgt, quoteFound, refFacts, revisionStepText,
  sgtDate, stepId, weakSpotAdvice, weakSpotGroups, type ModuleTaskInput, type TaskSource, type TaskStep,
} from "./tasks";

// Every date here is written with its offset, and every check reads Singapore
// days, so these pass whatever zone the process runs in (try TZ=UTC).
const NOW = Date.parse("2026-09-25T10:00:00+08:00"); // Fri 25 Sep 2026
const sgt = (s: string) => Date.parse(`${s}+08:00`);
const step = (text: string, doBy: string, minutes = 30, done = false): TaskStep => ({ id: stepId("k", text), text, minutes, doBy, done });

const input: ModuleTaskInput = {
  today: "2026-09-25 (Fri)", module: { code: "ST2334", name: "Stats" },
  canvas: [{ ref: "C1", line: "Canvas quiz: Quiz 2 — due 2026-10-02 23:59 (Fri)" }],
  past: [{ ref: "C7", line: "Quiz 1 — due 2026-09-18 23:59 (Fri) (submitted)" }],
  announcements: [{ ref: "A9", line: "Quiz 2 reminder (posted 2026-09-24 09:00 (Thu))", body: "Quiz 2 covers L1-L5 and is held in Week 7." }],
  discussions: [], notes: [], fileHints: [{ ref: "F4p12", line: "L5.pdf p.12: Project report due Week 9" }],
  weightage: [{ name: "Quizzes", weightPct: 30 }], examDate: null, studyAdvice: [], existing: [],
};
const refs = new Map<string, TaskSource>([
  ["C1", { kind: "canvas", label: "Quiz 2", itemId: 1 }],
  ["C7", { kind: "canvas", label: "Quiz 1", itemId: 7 }],
  ["A9", { kind: "announcement", label: "Quiz 2 reminder", itemId: 9 }],
  ["F4p12", { kind: "file", label: "L5 p.12", fileId: 4, page: 12 }],
  ["W", { kind: "weightage", label: "Assessment weightage" }],
]);
const facts = refFacts(input, new Map([["C1", { dueAt: sgt("2026-10-02T23:59:00"), title: "Quiz 2" }]]));
const plan = (t: Record<string, unknown>) => cleanPlan({ tasks: [{ key: "st2334-x", title: "Quiz 2", kind: "quiz", due: "2026-10-01T10:00:00+08:00", dueConfidence: "exact", ...t }] }, refs, NOW, "ST2334", facts)!;

describe("checking the planner against its sources", () => {
  it("takes the date of the Canvas item a task cites, and says the planner disagreed", () => {
    const [t] = plan({ sources: [{ ref: "C1", quote: "Quiz 2" }] });
    expect(t).toMatchObject({ dueAt: sgt("2026-10-02T23:59:00"), dueConfidence: "exact", dueFromSource: true });
    expect(t!.checks).toEqual(["date from Canvas: the planner said 2026-10-01 10:00 (Thu), Canvas says 2026-10-02 23:59 (Fri)"]);
    // Agreeing is not worth a note; no date at all takes Canvas's.
    expect(plan({ due: "2026-10-02T23:59:00+08:00", sources: [{ ref: "C1" }] })[0]!.checks).toBeUndefined();
    expect(plan({ due: null, dueConfidence: "estimated", sources: [{ ref: "C1" }] })[0]).toMatchObject({ dueAt: sgt("2026-10-02T23:59:00"), dueConfidence: "exact" });
  });

  it("doesn't take the date of an earlier quiz cited as the pattern, nor give a prep task its quiz's date", () => {
    const [q3] = plan({ title: "Quiz 3", anticipated: true, dueConfidence: "estimated", sources: [{ ref: "C1" }] });
    expect(q3!.dueAt).toBe(sgt("2026-10-01T10:00:00"));
    expect(q3!.dueFromSource).toBeUndefined();
    const [prep] = plan({ title: "Prepare for Quiz 2", kind: "prep", due: "2026-09-30T20:00:00+08:00", sources: [{ ref: "C1" }] });
    expect(prep!.dueAt).toBe(sgt("2026-09-30T20:00:00"));
  });

  it("drops a quote that isn't in its source, and the date it backed is only an estimate", () => {
    const [t] = plan({ title: "Project report", kind: "submission", sources: [{ ref: "F4p12", quote: "Project report due Friday 1 Oct" }, { ref: "W" }] });
    expect(t!.sources.find((s) => s.kind === "file")!.quote).toBeUndefined();
    expect(t!.dueConfidence).toBe("estimated");
    expect(t!.checks![0]).toMatch(/^quote not in \[F4p12\]/);
    // A quote that is there, give or take case and punctuation, stays.
    const [ok] = plan({ title: "Project report", kind: "submission", sources: [{ ref: "F4p12", quote: "project report — due week 9" }] });
    expect(ok).toMatchObject({ dueConfidence: "exact", sources: [{ quote: "project report — due week 9" }] });
  });

  it("drops a task whose only evidence is a quote that isn't there", () => {
    expect(plan({ title: "Quiz 9", sources: [{ ref: "A9", quote: "Quiz 9 is on Friday" }] })).toEqual([]);
    // A real Quiz 2 cited with a fake "Quiz 9" quote is no evidence for Quiz 9 either.
    expect(plan({ title: "Quiz 9", sources: [{ ref: "C1", quote: "Quiz 9 opens Monday" }] })).toEqual([]);
  });

  it("keeps a task's own Canvas item as evidence when only the quote is off", () => {
    const [t] = plan({ sources: [{ ref: "C1", quote: "the second quiz, due next Friday" }] });
    expect(t).toMatchObject({ title: "Quiz 2", dueAt: sgt("2026-10-02T23:59:00"), dueConfidence: "exact", sources: [{ label: "Quiz 2" }] });
    expect(t!.sources[0]!.quote).toBeUndefined();
  });

  it("takes the final exam's date from NUSMods", () => {
    const examInput = { ...input, examDate: "2026-11-28 09:00 (Sat)" };
    const withExam = refFacts(examInput, new Map([["X", { dueAt: sgt("2026-11-28T09:00:00"), title: "Final exam", from: "NUSMods" }]]));
    const xRefs = new Map([...refs, ["X", { kind: "nusmods" as const, label: "Final exam (NUSMods)" }]]);
    const [t] = cleanPlan({ tasks: [{ key: "st2334-final", title: "Final Examination", kind: "exam", due: "2026-11-27T09:00:00+08:00", dueConfidence: "estimated",
      sources: [{ ref: "X", quote: "Final exam on 28 November" }] }] }, xRefs, NOW, "ST2334", withExam)!;
    expect(t).toMatchObject({ dueAt: sgt("2026-11-28T09:00:00"), dueConfidence: "exact" });
    expect(t!.checks).toContain("date from NUSMods: the planner said 2026-11-27 09:00 (Fri), NUSMods says 2026-11-28 09:00 (Sat)");
  });

  it("makes an assessment no source names only anticipated", () => {
    const [t] = plan({ title: "Quiz 9", due: "2026-10-09T10:00:00+08:00", sources: [{ ref: "A9" }] });
    expect(t).toMatchObject({ anticipated: true, dueConfidence: "estimated" });
    expect(t!.checks).toContain('no source names "Quiz 9"');
    // Named in the announcement it cites: fine.
    expect(plan({ title: "Quiz 2", sources: [{ ref: "A9", quote: "held in Week 7" }] })[0]!.anticipated).toBe(false);
  });

  it("finds quotes word for word, in pieces, or nearly, but never with a different number", () => {
    const text = "Quiz 2 covers L1-L5 and is held in Week 7.";
    expect(quoteFound("Quiz2 covers L1–L5", text)).toBe(true);
    expect(quoteFound("Quiz 2 … held in Week 7", text)).toBe(true);
    expect(quoteFound("Quiz 2 covers L1-L5, held in Week 7", text)).toBe(true);
    expect(quoteFound("Quiz 2 covers L1-L6 and is held in Week 7", text)).toBe(false);
    expect(quoteFound("held in Week 8", text)).toBe(false);
  });

  it("reads a date-only due as the end of that Singapore day", () => {
    expect(parseSgt("2026-10-30")).toBe(sgt("2026-10-30T23:59:00"));
    expect(parseSgt("2026-10-30T14:00")).toBe(sgt("2026-10-30T14:00:00"));
    expect(parseSgt("2026-10-30T14:00:00Z")).toBe(Date.parse("2026-10-30T14:00:00Z"));
    expect(Number.isNaN(parseSgt("next Friday"))).toBe(true);
    const [t] = cleanPlan({ tasks: [{ key: "st2334-r", title: "Project report", kind: "submission", due: "2026-10-30", sources: [{ ref: "F4p12" }] }] }, refs, NOW, "ST2334")!;
    expect(t!.dueAt).toBe(sgt("2026-10-30T23:59:00"));
    expect(sgtDate(t!.dueAt!)).toBe("2026-10-30");
  });
});

describe("steps follow the due date", () => {
  it("pulls steps planned after a new, earlier date in before it, keeping order and done steps", () => {
    const steps = [step("a", "2026-09-24", 30, true), step("b", "2026-09-26"), step("c", "2026-10-03"), step("d", "2026-10-06")];
    const out = fitSteps(steps, "2026-09-25", sgt("2026-09-30T23:59:00"));
    expect(out.map((s) => [s.text, s.doBy])).toEqual([["a", "2026-09-24"], ["b", "2026-09-26"], ["c", "2026-09-28"], ["d", "2026-09-30"]]);
  });
  it("rolls late steps on, and leaves steps alone when the date moves later", () => {
    const steps = [step("a", "2026-09-22"), step("b", "2026-09-27")];
    expect(fitSteps(steps, "2026-09-25", sgt("2026-10-20T23:59:00")).map((s) => s.doBy)).toEqual(["2026-09-25", "2026-09-27"]);
    // A date already gone: what is left goes on today.
    expect(fitSteps([step("x", "2026-09-28")], "2026-09-25", sgt("2026-09-24T12:00:00")).map((s) => s.doBy)).toEqual(["2026-09-25"]);
  });
});

describe("balancing the days", () => {
  it("lets a light task give way before a heavy one due a little later", () => {
    const quiz = { key: "quiz", dueAt: sgt("2026-09-29T12:00:00"), weightPct: 5, steps: [step("q", "2026-09-25", 120)] };
    const exam = { key: "exam", dueAt: sgt("2026-09-28T12:00:00"), weightPct: 40, steps: [step("e", "2026-09-25", 120)] };
    balanceDays([quiz, exam], "2026-09-25", () => 180);
    expect(exam.steps[0]!.doBy).toBe("2026-09-25");
    expect(quiz.steps[0]!.doBy).toBe("2026-09-26");
    // By due date alone the exam (due first, less slack) would also stay; weight
    // decides when the dates are close.
    const a = { key: "a", dueAt: sgt("2026-09-29T12:00:00"), weightPct: 40, steps: [step("a", "2026-09-25", 120)] };
    const b = { key: "b", dueAt: sgt("2026-09-29T12:00:00"), weightPct: 5, steps: [step("b", "2026-09-25", 120)] };
    balanceDays([a, b], "2026-09-25", () => 180);
    expect([a.steps[0]!.doBy, b.steps[0]!.doBy]).toEqual(["2026-09-25", "2026-09-26"]);
  });

  it("pulls work earlier when a day is full and nothing can wait", () => {
    const t1 = { key: "t1", dueAt: sgt("2026-09-28T09:00:00"), steps: [step("x", "2026-09-27", 150)] };
    const t2 = { key: "t2", dueAt: sgt("2026-09-28T09:00:00"), steps: [step("y1", "2026-09-25", 30), step("y2", "2026-09-27", 120)] };
    balanceDays([t1, t2], "2026-09-25", () => 180);
    const all = [...t1.steps, ...t2.steps];
    expect(all.filter((s) => s.doBy === "2026-09-27").reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(240);
    expect(dayLoads([t1, t2], "2026-09-25", () => 180, 4).every((d) => !d.overloaded)).toBe(true);
    // Never before an earlier step of the same task.
    expect(t2.steps[0]!.doBy <= t2.steps[1]!.doBy).toBe(true);
  });

  it("flags a day it could not fix", () => {
    const t = { key: "t", dueAt: sgt("2026-09-25T23:59:00"), steps: [step("big", "2026-09-25", 200)] };
    balanceDays([t], "2026-09-25", () => 180);
    const days = dayLoads([t, { steps: [step("late", "2026-09-20", 10)] }], "2026-09-25", () => 180, 2);
    expect(days[0]).toEqual({ date: "2026-09-25", minutes: 210, cap: 180, overloaded: true });
    expect(days[1]).toMatchObject({ date: "2026-09-26", minutes: 0, overloaded: false });
  });

  it("has less room on days with classes", () => {
    const cap = capWithClasses(new Map([["2026-09-28", 2], ["2026-09-29", 5]]));
    expect(cap("2026-09-28")).toBe(dailyCap("2026-09-28") - 120);
    expect(cap("2026-09-29")).toBe(60);
    expect(cap("2026-09-26")).toBe(240);
  });
});

describe("adding steps to a touched task", () => {
  const have = [step("Redo L4 examples", "2026-09-26", 40, true), step("Do the practice quiz", "2026-09-29")];
  it("adds what the planner now asks for beyond what the task has, never changing the student's steps", () => {
    const planned = [step("Redo the L4 worked examples", "2026-09-26"), step("Do the practice quiz", "2026-09-29"), step("Review L5 notes", "2026-09-27"), step("Past paper Q1-5", "2026-09-28")];
    expect(newSteps(have, planned).map((s) => s.text)).toEqual(["Review L5 notes", "Past paper Q1-5"]);
    const ops = mergeTasks([{ id: 1, key: "k", status: "open", touchedAt: 5, steps: have }],
      [{ key: "k", title: "Quiz 2", kind: "quiz", dueAt: null, dueConfidence: "estimated", anticipated: false, weightPct: null, why: null, sources: [], steps: planned }]);
    expect(ops.update[0]).toMatchObject({ keepSteps: true });
    expect(ops.update[0]!.addSteps).toHaveLength(2);
  });
  it("adds a step for new material even when the planner gives no more steps than before", () => {
    expect(newSteps(have, [step("Redo L4 examples", "2026-09-26"), step("Review L6-L7", "2026-09-28")]).map((s) => s.text)).toEqual(["Review L6-L7"]);
    expect(newSteps(have, [step("Redo L4 examples", "2026-09-26"), step("Go over the notes", "2026-09-28")])).toEqual([]);
  });
  it("adds nothing to a task that is done or dismissed", () => {
    const ops = mergeTasks([{ id: 1, key: "k", status: "done", touchedAt: 5, steps: have }],
      [{ key: "k", title: "Quiz 2", kind: "quiz", dueAt: null, dueConfidence: "estimated", anticipated: false, weightPct: null, why: null, sources: [], steps: [step("Review L9", "2026-09-27")] }]);
    expect(ops.update[0]!.addSteps).toEqual([]);
  });
});

describe("what the chapter quizzes say to revise", () => {
  const spot = (deck: string | null, page: number | null, missed: number, topicTitle: string | null = "Bayes", lastMissedAt = 1) => ({ deck, page, topicTitle, missed, lastMissedAt });
  it("groups neighbouring slides into ranges, most missed first, at most three", () => {
    const groups = weakSpotGroups([
      spot("L5 Bayes.pdf", 12, 1), spot("L5 Bayes.pdf", 13, 2), spot("L5 Bayes.pdf", 14, 1), spot("L5 Bayes.pdf", 20, 1, "Priors", 5),
      spot("L2 Counting.pdf", 4, 2, "Permutations"), spot(null, null, 1, "Independence"), spot("L9.pdf", 1, 1, null, 0),
    ]);
    expect(weakSpotAdvice(groups)).toEqual([
      "revise L5 Bayes slides 12-14 (Bayes): missed 4 quiz questions",
      "revise L2 Counting slide 4 (Permutations): missed 2 quiz questions",
      "revise L5 Bayes slide 20 (Priors): missed 1 quiz question",
    ]);
    expect(revisionStepText(groups[0]!)).toBe("Revise L5 Bayes slides 12-14");
  });
  it("says something sensible without a deck or a slide", () => {
    const [g] = weakSpotGroups([spot(null, null, 3, "Independence")]);
    expect(weakSpotAdvice([g!])).toEqual(["revise Independence: missed 3 quiz questions"]);
    expect(revisionStepText(g!)).toBe("Revise Independence");
    expect(revisionStepText(weakSpotGroups([spot("A very long deck name that goes on and on and on and on and on.pdf", 3, 1)])[0]!).length).toBeLessThanOrEqual(70);
    expect(weakSpotGroups([])).toEqual([]);
  });
});
