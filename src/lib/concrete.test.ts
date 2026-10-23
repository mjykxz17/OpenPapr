import { describe, expect, it } from "vitest";
import { citedItemIds, concreteTasks, isConcrete } from "./concrete";

const types = new Map<number, string>([[1, "assignment"], [2, "announcement"], [3, "event"], [4, "planner_note"]]);
const typeOf = (id: number) => types.get(id);

describe("isConcrete", () => {
  it("shows what the course posted or the student added", () => {
    expect(isConcrete("manual-abc", [], typeOf)).toBe(true);
    expect(isConcrete("cs-quiz-2", [{ kind: "canvas", label: "Quiz 2", itemId: 1 }], typeOf, "Quiz 2")).toBe(true);
    expect(isConcrete("cs-quiz-2", [{ kind: "announcement", label: "Quiz 2 on Friday", itemId: 2 }], typeOf, "Quiz 2")).toBe(true);
    expect(isConcrete("cs-final", [{ kind: "nusmods", label: "Final exam (NUSMods)" }], typeOf, "Final exam")).toBe(true);
    expect(isConcrete("cs-note", [{ kind: "planner", label: "Your note: email tutor", itemId: 4 }], typeOf, "Email tutor")).toBe(true);
  });

  it("hides what is only expected", () => {
    // Read from the course schedule, a class event, a slide, or the weightage.
    expect(isConcrete("cs-quiz-3", [{ kind: "file", label: "L1 p.4 (course schedule)", fileId: 1 }], typeOf, "Quiz 3")).toBe(false);
    expect(isConcrete("cs-quiz-3", [{ kind: "announcement", label: "Welcome (course schedule)", itemId: 2 }], typeOf, "Quiz 3")).toBe(false);
    expect(isConcrete("cs-quiz-3", [{ kind: "canvas", label: "Lecture", itemId: 3 }], typeOf, "Quiz 3")).toBe(false);
    expect(isConcrete("cs-mid", [{ kind: "weightage", label: "Assessment weightage" }], typeOf, "Midterm")).toBe(false);
    // An item we no longer have is not evidence.
    expect(isConcrete("cs-quiz-3", [{ kind: "canvas", label: "Quiz 3", itemId: 99 }], typeOf, "Quiz 3")).toBe(false);
  });

  it("doesn't count the earlier quiz an expected one follows", () => {
    const pattern = [{ kind: "canvas", label: "Quiz 2 — the last one", itemId: 1 }];
    expect(isConcrete("cs-series-quiz-3", pattern, typeOf, "Quiz 3 (expected)")).toBe(false);
    expect(isConcrete("cs-quiz-3", pattern, typeOf, "Quiz 3")).toBe(false);
    expect(isConcrete("cs-tut-5", [{ kind: "canvas", label: "Tutorial 4", itemId: 1 }], typeOf, "Tutorial 5")).toBe(false);
    // An announcement that names this quiz too does confirm it.
    expect(isConcrete("cs-quiz-3", [...pattern, { kind: "announcement", label: "Quiz 2 results", quote: "Quiz 3 is next Friday", itemId: 2 }], typeOf, "Quiz 3")).toBe(true);
    // Without a number to compare, a posted source still counts.
    expect(isConcrete("cs-proposal", [{ kind: "canvas", label: "Project proposal", itemId: 1 }], typeOf, "Project proposal")).toBe(true);
    expect(isConcrete("cs-prep", [{ kind: "canvas", label: "Quiz 2", itemId: 1 }], typeOf, "Read chapter 3")).toBe(true);
  });

  it("filters task rows the same way", () => {
    const rows = [
      { key: "a-quiz-2", title: "Quiz 2", sourcesJson: JSON.stringify([{ kind: "canvas", label: "Quiz 2", itemId: 1 }]) },
      { key: "a-series-quiz-3", title: "Quiz 3 (expected)", sourcesJson: JSON.stringify([{ kind: "canvas", label: "Quiz 2", itemId: 1 }]) },
      { key: "a-bad", title: "Bad", sourcesJson: "not json" },
    ];
    expect(concreteTasks(rows, typeOf).map((t) => t.key)).toEqual(["a-quiz-2"]);
    expect(citedItemIds(rows)).toEqual([1]);
  });
});
