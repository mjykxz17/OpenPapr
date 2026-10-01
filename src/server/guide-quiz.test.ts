import { describe, expect, it } from "vitest";
import { cleanQuiz } from "./guide-quiz";

const chapter = "## 1. Stacks\n\nCanaries [s4](slide:L3-stack#4) guard the return address.";
const q = (over: Record<string, unknown> = {}) => ({ q: "What does a canary protect?", options: ["Return address", "Heap", "TLB", "Registers"], answer: 0, why: "It sits before it.", slide: "slide:L3-stack#4", ...over });

describe("cleanQuiz", () => {
  it("keeps good questions and real slide refs", () => {
    const out = cleanQuiz({ questions: [q(), q({ slide: "slide:L9#1" }), q({ answer: "2" })] }, chapter);
    expect(out).toHaveLength(3);
    expect(out[0]!.slide).toEqual({ deck: "L3-stack", page: 4 });
    expect(out[1]!.slide).toBeNull();
    expect(out[2]!.answer).toBe(2);
  });
  it("drops malformed ones", () => {
    expect(cleanQuiz({ questions: [q({ options: ["a", "b", "c"] }), q()] }, chapter)).toHaveLength(1);
    expect(cleanQuiz({ questions: [q({ options: ["a", "a", "b", "c"] })] }, chapter)).toEqual([]);
    expect(cleanQuiz(null, chapter)).toEqual([]);
  });
});
