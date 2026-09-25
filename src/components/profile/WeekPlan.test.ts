import { describe, expect, it } from "vitest";
import { clip, firstSentence, fmtMinutes } from "./WeekPlan";

describe("week plan text trimming", () => {
  it("keeps short text as is", () => expect(clip("Do Tutorial 5", 60)).toBe("Do Tutorial 5"));
  it("cuts long text at a word boundary with an ellipsis", () => {
    const out = clip("Revise lecture 6 slides 12 to 30 before the quiz on Friday afternoon, then redo the practice set", 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
  it("takes only the first sentence", () => {
    expect(firstSentence("A heavy week for CS2040. Also the lab.")).toBe("A heavy week for CS2040.");
    expect(firstSentence("No full stop here")).toBe("No full stop here");
    expect(firstSentence("Covers v1.2 of the API. Then more.")).toBe("Covers v1.2 of the API.");
  });
  it("formats minutes", () => {
    expect(fmtMinutes(45)).toBe("45m");
    expect(fmtMinutes(120)).toBe("2h");
    expect(fmtMinutes(165)).toBe("2h 45m");
  });
});
