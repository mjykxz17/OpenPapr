import { describe, expect, it } from "vitest";
import { assessmentNumber, assessmentNumbers, sameAssessment, sameTask } from "./own-work";

describe("sameAssessment", () => {
  it("matches kind and number however they are written", () => {
    expect(sameAssessment("Quiz 3", "Submit Quiz-3")).toBe(true);
    expect(sameAssessment("Quiz 3", "Quiz 4")).toBe(false);
    expect(sameAssessment("Mid-term 1", "Midterm 1")).toBe(true);
    expect(assessmentNumber("Mid-term 2")).toBe(2);
  });

  it("matches the unnumbered midterm and final however they are spelt", () => {
    expect(sameAssessment("Mid-term", "Midterm")).toBe(true);
    expect(sameAssessment("Mid term test", "Midterm")).toBe(true);
    expect(sameAssessment("Final Examination", "Final exam")).toBe(true);
    expect(sameAssessment("Finals", "Final Exam")).toBe(true);
    expect(sameAssessment("Final exam", "Practical exam")).toBe(false);
    expect(sameAssessment("Midterm", "Final exam")).toBe(false);
  });

  it("needs the same name for other unnumbered work", () => {
    expect(sameAssessment("Project proposal", "Submit the project proposal")).toBe(true);
    expect(sameAssessment("Project proposal", "Project report")).toBe(false);
    expect(sameAssessment("Lab report", "Lab safety quiz")).toBe(false);
    expect(sameAssessment("Quiz", "Quiz 3")).toBe(false);
  });

  it("finds every number a text names", () => {
    expect(assessmentNumbers("Quiz 2 results, and Quiz-3 is next week")).toEqual([2, 3]);
    expect(assessmentNumbers("Welcome to the course")).toEqual([]);
  });

  it("sameTask also matches a reworded title", () => {
    expect(sameTask("Weekly reading", "weekly reading!")).toBe(true);
    expect(sameTask("Prepare for weekly reading", "Weekly reading")).toBe(true);
    expect(sameTask("Weekly reading", "Weekly quiz")).toBe(false);
  });
});
