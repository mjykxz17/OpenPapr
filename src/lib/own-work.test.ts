import { describe, expect, it } from "vitest";
import { assessmentNumber, assessmentNumbers, isPrep, sameAssessment, sameTask } from "./own-work";

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

describe("two exams that are not the final", () => {
  it("are one only when they have the same name", () => {
    expect(sameAssessment("Practical exam", "Oral exam")).toBe(false);
    expect(sameAssessment("Mock exam", "Lab test exam")).toBe(false);
    expect(sameAssessment("Practical exam", "Sit the practical examination")).toBe(true);
  });
});

describe("isPrep", () => {
  it("tells getting ready for an assessment from the assessment", () => {
    expect(isPrep("prep", "Quiz 3")).toBe(true);
    expect(isPrep(null, "Prepare for Quiz 3")).toBe(true);
    expect(isPrep(null, "Quiz 3 prep")).toBe(true);
    expect(isPrep("exam", "Revise L1-L6 for the midterm")).toBe(true);
    expect(isPrep("reading", "Weekly reading")).toBe(true);
    expect(isPrep("quiz", "Quiz 3")).toBe(false);
    expect(isPrep(null, "Midterm")).toBe(false);
    expect(isPrep("submission", "Lab 4 report")).toBe(false);
  });
});
