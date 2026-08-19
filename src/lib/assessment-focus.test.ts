import { describe, expect, it } from "vitest";
import { focusAssessmentText } from "./assessment-focus";

describe("focusAssessmentText", () => {
  it("returns short text unchanged", () => {
    expect(focusAssessmentText("Quizzes: 17%")).toBe("Quizzes: 17%");
  });
  it("keeps late assessment lines that a head-slice would cut off", () => {
    const filler = Array.from({ length: 2000 }, (_, i) => `Lecture note line ${i} about C programming.`).join("\n");
    const text = `${filler}\nCourse Assessment\nQuizzes: 17%\nLabs: 28%\nAssignments: 25%\nMidterm: 30%`;
    const out = focusAssessmentText(text, 18_000);
    expect(out.length).toBeLessThanOrEqual(18_000);
    expect(out).toContain("Quizzes: 17%");
    expect(out).toContain("Midterm: 30%");
  });
  it("falls back to a head slice when nothing matches", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `plain line ${i}`).join("\n");
    expect(focusAssessmentText(text, 18_000)).toBe(text.slice(0, 18_000));
  });
});
