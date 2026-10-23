import { describe, expect, it } from "vitest";
import { missedFirst, unpick } from "./ChapterQuiz";

const q = (missedBefore?: boolean) => ({ q: "Q", options: ["a", "b", "c", "d"], answer: 0, why: "", slide: null, ...(missedBefore ? { missedBefore } : {}) });

describe("missedFirst", () => {
  it("puts wrong answers first, then the rest in order", () => {
    const d = { questions: [q(), q(), q()], answers: [{ question: 0, chosen: 0, correct: true }, { question: 2, chosen: 1, correct: false }] };
    expect(missedFirst(d)).toEqual({ missed: [2], order: [2, 0, 1] });
  });
  it("flags questions carried over from the last set until they are answered", () => {
    const d = { questions: [q(true), q(true), q()], answers: [{ question: 1, chosen: 0, correct: true }] };
    expect(missedFirst(d)).toEqual({ missed: [0], order: [0, 1, 2] });
  });
});

describe("unpick", () => {
  it("takes back an answer that was not saved, but not one picked since", () => {
    expect(unpick({ 0: 1, 2: 3 }, 2, 3)).toEqual({ 0: 1 });
    expect(unpick({ 0: 1, 2: 0 }, 2, 3)).toEqual({ 0: 1, 2: 0 });
  });
});
