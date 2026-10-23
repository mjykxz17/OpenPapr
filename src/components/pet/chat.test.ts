import { describe, expect, it } from "vitest";
import { answerMessage, isUngrounded, UNGROUNDED_NOTE } from "./chat";

describe("answerMessage", () => {
  it("marks an answer the API says wasn't found in the student's material", () => {
    const m = answerMessage({ reply: "Probably week 7.", grounded: false }, 1);
    expect(isUngrounded(m)).toBe(true);
  });
  it("treats a missing or non-false grounded as grounded", () => {
    expect(isUngrounded(answerMessage({ reply: "Week 7 [1]", sources: [] }, 1))).toBe(false);
    expect(isUngrounded(answerMessage({ reply: "Week 7", grounded: true }, 1))).toBe(false);
    expect(isUngrounded(answerMessage({ reply: "Week 7", grounded: "false" }, 1))).toBe(false);
  });
  it("keeps the sources, and falls back to a friendly line when there is no reply", () => {
    const src = [{ n: 1, kind: "slide", title: "L3", code: "CS2040", moduleId: 1, href: "/x", slide: null }];
    expect(answerMessage({ reply: "Hi", sources: src }, 1).sources).toEqual(src);
    expect(answerMessage(null, 1).content).toMatch(/couldn't reach my notes/);
  });
});

describe("isUngrounded", () => {
  it("never flags the student's own message, or a saved answer without the field", () => {
    expect(isUngrounded({ role: "user", content: "hi", grounded: false })).toBe(false);
    expect(isUngrounded({ role: "assistant", content: "hi" })).toBe(false);
  });
  it("has the note's wording", () => {
    expect(UNGROUNDED_NOTE).toBe("Not found in your material — double-check this.");
  });
});
