import { describe, expect, it } from "vitest";
import { moduleCodeFromCourse, normalizeCanvasCourse } from "./normalize";
import type { CanvasAnnouncement, CanvasAssignmentGroup, CanvasCourse } from "./types";

const course: CanvasCourse = { id: 7, name: "Software Engineering", course_code: "CS2103T Software Engineering", term: { name: "AY26/27 S1" }, syllabus_body: "<p>tP 45%</p>" };
const groups: CanvasAssignmentGroup[] = [
  { id: 1, name: "Finals", group_weight: 25, assignments: [] },
  { id: 2, name: "tP", group_weight: 45, assignments: [
    { id: 11, name: "tP v1.3", due_at: "2026-08-21T16:00:00Z", html_url: "u", points_possible: 100, submission: { workflow_state: "unsubmitted", score: null } },
  ]},
];
const ann: CanvasAnnouncement[] = [{ id: 9, title: "Venue change", message: "<p>MPSH2</p>", html_url: "a", posted_at: "2026-08-12T02:00:00Z" }];

describe("normalizeCanvasCourse", () => {
  it("extracts the module code", () => {
    expect(moduleCodeFromCourse("CS2103T Software Engineering")).toBe("CS2103T");
    expect(moduleCodeFromCourse("ST2334")).toBe("ST2334");
  });
  it("maps weighted groups to canvas_api components", () => {
    const n = normalizeCanvasCourse(course, groups, ann, []);
    expect(n.components).toEqual([
      { name: "Finals", weightPct: 25, scorePct: null, source: "canvas_api" },
      { name: "tP", weightPct: 45, scorePct: null, source: "canvas_api" },
    ]);
  });
  it("emits no components when no group has weight (prof didn't configure weights)", () => {
    const unweighted = groups.map((g) => ({ ...g, group_weight: 0 }));
    expect(normalizeCanvasCourse(course, unweighted, [], []).components).toEqual([]);
  });
  it("maps assignments and announcements to items with parsed timestamps", () => {
    const n = normalizeCanvasCourse(course, groups, ann, []);
    const a = n.items.find((i) => i.sourceId === "assignment:11")!;
    expect(a.type).toBe("assignment");
    expect(a.dueAt).toBe(Date.parse("2026-08-21T16:00:00Z"));
    expect(a.submitted).toBe(false);
    const an = n.items.find((i) => i.sourceId === "announcement:9")!;
    expect(an.type).toBe("announcement");
  });
  it("marks graded/submitted submissions", () => {
    const g = [{ ...groups[1], assignments: [{ ...groups[1].assignments![0], submission: { workflow_state: "submitted", score: null } }] }];
    expect(normalizeCanvasCourse(course, g, [], []).items[0].submitted).toBe(true);
  });
});

describe("quizzes", () => {
  const quizGroup = (a: Partial<import("./types").CanvasAssignment>): CanvasAssignmentGroup[] => [{ id: 3, name: "Quizzes", group_weight: 20, assignments: [
    { id: 31, name: "Quiz 3", due_at: null, html_url: "q", points_possible: 10, submission: { workflow_state: "unsubmitted", score: null }, ...a },
  ]}];
  it("uses the close time as the deadline when a quiz has only a window", () => {
    const n = normalizeCanvasCourse(course, quizGroup({ is_quiz_assignment: true, unlock_at: "2026-09-28T01:00:00Z", lock_at: "2026-10-02T15:59:00Z" }), [], []);
    const q = n.items[0];
    expect(q.dueAt).toBe(Date.parse("2026-10-02T15:59:00Z"));
    expect(JSON.parse(q.metaJson!)).toEqual({ quiz: true, opensAt: Date.parse("2026-09-28T01:00:00Z"), closesAt: Date.parse("2026-10-02T15:59:00Z"), closesOnly: true });
  });
  it("keeps the due date when there is one, and spots New Quizzes and quiz names", () => {
    const lti = normalizeCanvasCourse(course, quizGroup({ due_at: "2026-10-01T15:59:00Z", lock_at: "2026-10-03T15:59:00Z", submission_types: ["external_tool"], is_quiz_lti_assignment: true }), [], []).items[0];
    expect(lti.dueAt).toBe(Date.parse("2026-10-01T15:59:00Z"));
    expect(JSON.parse(lti.metaJson!).closesOnly).toBe(false);
    expect(JSON.parse(normalizeCanvasCourse(course, quizGroup({ name: "Weekly MCQ 4", due_at: "2026-10-01T15:59:00Z" }), [], []).items[0].metaJson!).quiz).toBe(true);
  });
  it("leaves plain assignments without meta", () => {
    expect(normalizeCanvasCourse(course, groups, [], []).items[0].metaJson).toBeNull();
    expect(normalizeCanvasCourse(course, quizGroup({ name: "Pen Test Report", due_at: "2026-10-01T15:59:00Z" }), [], []).items[0].metaJson).toBeNull();
  });
});
