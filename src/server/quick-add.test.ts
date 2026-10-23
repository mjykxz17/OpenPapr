import { describe, expect, it } from "vitest";
import { guessKind, isAddRequest, parseQuickAdd } from "./quick-add";

// Thursday 1 October 2026, 10:00 in Singapore.
const now = Date.parse("2026-10-01T10:00:00+08:00");
const codes = ["CS4238", "IFS4103", "GEC1044"];

describe("quick add", () => {
  it("spots requests", () => {
    expect(isAddRequest("remind me to email Prof Tan")).toBe(true);
    expect(isAddRequest("Papi, can you remind me to print notes tomorrow")).toBe(true);
    expect(isAddRequest("add task: buy lab coat")).toBe(true);
    expect(isAddRequest("todo: read chapter 4")).toBe(true);
    expect(isAddRequest("when is my next quiz?")).toBe(false);
    expect(isAddRequest("remind me")).toBe(false);
  });
  it("reads days and modules", () => {
    expect(parseQuickAdd("remind me to email Prof Tan about CS4238 by Friday", codes, now)).toEqual({ title: "Email Prof Tan about CS4238", day: "2026-10-02", moduleCode: "CS4238" });
    expect(parseQuickAdd("remind me to print notes tomorrow", codes, now)).toMatchObject({ title: "Print notes", day: "2026-10-02" });
    expect(parseQuickAdd("remind me to submit form on thursday", codes, now).day).toBe("2026-10-08");
    expect(parseQuickAdd("remind me to call mum next monday", codes, now).day).toBe("2026-10-12");
    expect(parseQuickAdd("remind me to pay fees by 15 Oct at 5pm", codes, now)).toMatchObject({ title: "Pay fees", day: "2026-10-15" });
    expect(parseQuickAdd("todo: book room 3/9", codes, now).day).toBe("2027-09-03");
    expect(parseQuickAdd("remind me to revise ifs4103 week 5 in 3 days", codes, now)).toMatchObject({ day: "2026-10-04", moduleCode: "IFS4103" });
    expect(parseQuickAdd("remind me to buy a lab coat", codes, now)).toEqual({ title: "Buy a lab coat", day: null, moduleCode: null });
  });
  it("guesses the type from the title, or leaves it a plain task", () => {
    expect(guessKind("Quiz 3")).toBe("quiz");
    expect(guessKind("Revise for quiz 3")).toBe("prep");
    expect(guessKind("CS3230 midterm")).toBe("exam");
    expect(guessKind("Submit assignment 2")).toBe("submission");
    expect(guessKind("Problem Set 3")).toBe("submission");
    expect(guessKind("Read chapter 4")).toBe("reading");
    expect(guessKind("Project proposal")).toBe("project");
    expect(guessKind("Prepare presentation slides")).toBe("presentation");
    expect(guessKind("Consultation with Prof Tan")).toBe("meeting");
    expect(guessKind("Email Prof Tan")).toBe("admin");
    expect(guessKind("Buy a lab coat")).toBe("admin");
    expect(guessKind("")).toBe("admin");
  });
  it("calls something handed in a submission, whatever else the title says", () => {
    expect(guessKind("Final report")).toBe("submission");
    expect(guessKind("Final essay")).toBe("submission");
    expect(guessKind("Final submission")).toBe("submission");
    expect(guessKind("Peer review submission")).toBe("submission");
    expect(guessKind("Submit reading response")).toBe("submission");
    expect(guessKind("Finals")).toBe("exam");
    expect(guessKind("Final exam")).toBe("exam");
    expect(guessKind("Revise for finals")).toBe("prep");
  });
});
