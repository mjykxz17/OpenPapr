import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { canvasMessages, modules, users } from "../db/schema";
import type { CanvasConversationDetail } from "../connectors/canvas/types";
import { staffMessages, syncInbox } from "./inbox";

const SELF = 1;
const detail = (over: Partial<CanvasConversationDetail> = {}): CanvasConversationDetail => ({
  id: 50, subject: "Quiz 2 venue", last_message_at: "2026-10-02T00:00:00Z", context_code: "course_7", context_name: "CS3230",
  participants: [
    { id: SELF, name: "Me", common_courses: { 7: ["StudentEnrollment"] } },
    { id: 900, name: "Dr Tan", common_courses: { 7: ["TeacherEnrollment"] } },
    { id: 901, name: "A tutor", common_courses: { 7: ["TaEnrollment"] } },
    { id: 555, name: "A classmate", common_courses: { 7: ["StudentEnrollment"] } },
  ],
  messages: [
    { id: 4, author_id: 555, body: "me too", created_at: "2026-10-02T00:00:00Z" },
    { id: 3, author_id: SELF, body: "Is it in LT19?", created_at: "2026-10-01T02:00:00Z" },
    { id: 2, author_id: 901, body: "Quiz 2 is in LT19, bring your matric card.", created_at: "2026-10-01T01:00:00Z" },
    { id: 1, author_id: 900, body: "Quiz 2 moves to LT19.", created_at: "2026-10-01T00:00:00Z" },
    { id: 0, author_id: 900, body: "x was added", created_at: "2026-09-30T00:00:00Z", generated: true },
  ],
  ...over,
});

describe("Inbox", () => {
  it("keeps what lecturers, TAs and the student wrote, never a classmate", () => {
    const r = staffMessages(detail(), SELF);
    expect(r.courseId).toBe(7);
    expect(r.subject).toBe("Quiz 2 venue");
    expect(r.messages.map((m) => [m.messageId, m.author])).toEqual([[3, "You"], [2, "A tutor"], [1, "Dr Tan"]]);
  });

  it("drops a subject a classmate wrote", () => {
    const d = detail({ messages: [
      { id: 2, author_id: 900, body: "Please ask on the forum.", created_at: "2026-10-01T01:00:00Z" },
      { id: 1, author_id: 555, body: "hi", created_at: "2026-10-01T00:00:00Z" },
    ] });
    expect(staffMessages(d, SELF).subject).toBeNull();
  });

  it("opens only conversations that moved, and stores them under their module", async () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS3230", name: "x" }).run();
    const canvas = {
      listConversations: vi.fn(async () => [{ id: 50, subject: "Quiz 2 venue", last_message_at: "2026-10-02T00:00:00Z" }]),
      getConversation: vi.fn(async () => detail()),
    };
    expect(await syncInbox(db, canvas, 1, SELF)).toBe(3);
    expect(await syncInbox(db, canvas, 1, SELF)).toBe(0);
    expect(canvas.getConversation).toHaveBeenCalledTimes(1);
    const rows = db.select().from(canvasMessages).all();
    expect(rows.every((r) => r.moduleId === 1 && r.courseName === "CS3230")).toBe(true);
    expect(rows.map((r) => r.body).join(" ")).not.toContain("me too");
  });
});
