import { describe, expect, it } from "vitest";
import { answerMessage, inlineParts, isUngrounded, replyBlocks, turnsToSend, UNGROUNDED_NOTE } from "./chat";

describe("turnsToSend", () => {
  it("sends the last few turns, words only", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: `m${i}`, at: i, sources: [] }));
    expect(turnsToSend(msgs)).toHaveLength(8);
    expect(turnsToSend(msgs)[0]).toEqual({ role: "user", content: "m2" });
    expect(turnsToSend([])).toEqual([]);
  });
});

describe("an answer's markdown", () => {
  it("draws bullet and numbered lists as lists, not dashes", () => {
    const text = "The master theorem has three cases:\n- Case 1: f(n) is smaller [1]\n- Case 2: they match\n  and the log factor appears\n\n1. Find a, b\n2. Compare\n### Why it works";
    expect(replyBlocks(text)).toEqual([
      { kind: "p", text: "The master theorem has three cases:" },
      { kind: "ul", items: ["Case 1: f(n) is smaller [1]", "Case 2: they match and the log factor appears"] },
      { kind: "ol", items: ["Find a, b", "Compare"] },
      { kind: "h", text: "Why it works" },
    ]);
  });
  it("keeps plain lines as one paragraph, and blank lines between paragraphs", () => {
    expect(replyBlocks("One.\nTwo.\n\nThree.")).toEqual([{ kind: "p", text: "One.\nTwo." }, { kind: "p", text: "Three." }]);
    // "*emphasis*" at the start of a line is not a bullet.
    expect(replyBlocks("*Note* this")).toEqual([{ kind: "p", text: "*Note* this" }]);
  });
  it("finds bold, emphasis, code and citations in a line", () => {
    expect(inlineParts("Use **T(n)** with `a=2` and *b* [2].")).toEqual([
      { kind: "text", text: "Use " }, { kind: "bold", text: "T(n)" }, { kind: "text", text: " with " }, { kind: "code", text: "a=2" },
      { kind: "text", text: " and " }, { kind: "em", text: "b" }, { kind: "text", text: " " }, { kind: "cite", n: 2, text: "[2]" }, { kind: "text", text: "." },
    ]);
    expect(inlineParts("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
  });
});

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
