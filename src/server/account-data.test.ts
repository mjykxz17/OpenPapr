import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { canvasConversations, canvasMessages, canvasPageCache, canvasPages, guideProgress, items, mailAttachments, modules, quizAttempts, users } from "@/db/schema";
import { deleteAccount, exportAccount, wipeUserData } from "./account-data";

const now = Date.parse("2026-10-01T10:00:00+08:00");

function setup() {
  const db = createDb(":memory:");
  db.insert(users).values([{ name: "a" }, { name: "b" }]).run();
  db.insert(modules).values([
    { userId: 1, canvasCourseId: 7, code: "CS1", name: "x" },
    { userId: 2, canvasCourseId: 7, code: "CS1", name: "x" },
  ]).run();
  for (const [userId, moduleId] of [[1, 1], [2, 2]] as const) {
    db.insert(quizAttempts).values({ userId, moduleId, chapterHash: "h", question: 0, chosen: 1, correct: true, answeredAt: now }).run();
    db.insert(guideProgress).values({ userId, moduleId, topicKey: "1-intro", readAt: now }).run();
  }
  return db;
}

describe("account data and the quiz and reading tables", () => {
  it("exports the student's own quiz answers and chapters read, and nobody else's", () => {
    const ex = exportAccount(setup(), 1)!;
    expect(ex.quizAttempts).toEqual([expect.objectContaining({ userId: 1, chapterHash: "h", correct: true })]);
    expect(ex.chaptersRead).toEqual([expect.objectContaining({ userId: 1, topicKey: "1-intro" })]);
  });

  it("deletes them with the account, leaving other students' alone", () => {
    const db = setup();
    deleteAccount(db, 1);
    expect(db.select().from(quizAttempts).all().map((r) => r.userId)).toEqual([2]);
    expect(db.select().from(guideProgress).all().map((r) => r.userId)).toEqual([2]);
    expect(db.select().from(users).all().map((u) => u.id)).toEqual([2]);
  });

  it("deletes the Canvas pages, Inbox messages and email attachments too, and exports them", () => {
    const db = setup();
    for (const userId of [1, 2]) {
      db.insert(canvasPages).values({ userId, moduleId: userId, pageUrl: "p", title: "P", body: "b", seenAt: now }).run();
      db.insert(canvasMessages).values({ userId, moduleId: userId, conversationId: 1, messageId: userId, author: "Dr Tan", body: "hi", sentAt: now }).run();
      db.insert(canvasConversations).values({ userId, conversationId: 1, lastMessageAt: "t" }).run();
      const mail = db.insert(items).values({ userId, type: "email", source: "graph", sourceId: `mail:${userId}`, title: "m", firstSeenAt: now }).returning().get();
      db.insert(mailAttachments).values({ userId, itemId: mail.id, graphId: "g", name: "a.pdf", fetchedAt: now }).run();
    }
    const ex = exportAccount(db, 1)!;
    expect([ex.canvasPages.length, ex.canvasMessages.length, ex.mailAttachments.length]).toEqual([1, 1, 1]);
    deleteAccount(db, 1);
    for (const t of [canvasPages, canvasMessages, canvasConversations, mailAttachments] as const) {
      expect(db.select().from(t).all().map((r) => r.userId)).toEqual([2]);
    }
  });

  // The cache has no owner column: a course's pages go when its last student does.
  it("removes cached Canvas pages of a course once nobody left takes it", () => {
    const db = setup();
    db.insert(modules).values({ userId: 1, canvasCourseId: 8, code: "CS2", name: "y" }).run();
    db.insert(canvasPageCache).values([7, 8].map((courseId) => ({ courseId, pageUrl: "week-1", body: "<p>notes</p>", fetchedAt: now }))).run();
    deleteAccount(db, 1);
    expect(db.select().from(canvasPageCache).all().map((r) => r.courseId)).toEqual([7]);   // student 2 still takes 7
    deleteAccount(db, 2);
    expect(db.select().from(canvasPageCache).all()).toEqual([]);
  });

  // The demo reset wipes the account but keeps its user row.
  it("wipes them on a reset that keeps the user", () => {
    const db = setup();
    wipeUserData(db, 1);
    expect(db.select().from(quizAttempts).all().map((r) => r.userId)).toEqual([2]);
    expect(db.select().from(guideProgress).all().map((r) => r.userId)).toEqual([2]);
    expect(db.select().from(users).all()).toHaveLength(2);
  });
});
