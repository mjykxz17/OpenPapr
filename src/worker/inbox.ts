import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { canvasConversations, canvasMessages, modules } from "../db/schema";
import type { CanvasClient } from "../connectors/canvas/client";
import type { CanvasConversationDetail } from "../connectors/canvas/types";

// The Canvas Inbox: what lecturers and TAs wrote to the student, and what the
// student wrote back. A message counts as staff when its author teaches or
// tutors the conversation's course (Canvas says so per participant, in
// common_courses — which also works for past courses whose class list the
// student can no longer see). Everyone else's messages are dropped, and so is
// a subject a classmate wrote.
//
// Only conversations whose last message moved are opened, a few per sync, and
// they are opened without marking them read (see the client).

const PER_SYNC = 25;
const STAFF = /^(TeacherEnrollment|TaEnrollment)$/;

type Canvas = Pick<CanvasClient, "listConversations" | "getConversation">;

export function staffMessages(d: CanvasConversationDetail, selfId: number | null) {
  const course = d.context_code?.match(/^course_(\d+)$/)?.[1] ?? null;
  const isStaff = new Map((d.participants ?? []).map((p) => [p.id, Boolean(course && (p.common_courses?.[course] ?? []).some((r) => STAFF.test(r)))]));
  const name = new Map((d.participants ?? []).map((p) => [p.id, p.name]));
  const kept = (d.messages ?? []).filter((m) => !m.generated && m.body?.trim() && (m.author_id === selfId || isStaff.get(m.author_id)))
    .map((m) => ({ messageId: m.id, author: m.author_id === selfId ? "You" : (name.get(m.author_id) ?? "Staff"), body: m.body.trim(), sentAt: Date.parse(m.created_at) }));
  // Canvas lists newest first; the subject is the first message's.
  const first = [...(d.messages ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
  const subjectOk = first && (first.author_id === selfId || isStaff.get(first.author_id));
  return { courseId: course ? Number(course) : null, subject: subjectOk ? d.subject : null, messages: kept };
}

export async function syncInbox(db: Db, canvas: Canvas, userId: number, selfId: number | null): Promise<number> {
  const convs = await canvas.listConversations();
  const seen = new Map(db.select().from(canvasConversations).where(eq(canvasConversations.userId, userId)).all().map((c) => [c.conversationId, c.lastMessageAt]));
  const stale = convs.filter((c) => !seen.has(c.id) || seen.get(c.id) !== c.last_message_at)
    .sort((a, b) => Date.parse(b.last_message_at ?? "0") - Date.parse(a.last_message_at ?? "0")).slice(0, PER_SYNC);
  const byCourse = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().map((m) => [m.canvasCourseId, m.id]));
  let stored = 0;
  for (const c of stale) {
    let d: CanvasConversationDetail;
    try { d = await canvas.getConversation(c.id); } catch { continue; }
    const { courseId, subject, messages } = staffMessages(d, selfId);
    db.transaction((tx) => {
      for (const m of messages) {
        tx.insert(canvasMessages).values({
          userId, moduleId: courseId !== null ? (byCourse.get(courseId) ?? null) : null, conversationId: c.id, courseName: d.context_name ?? null, subject, ...m,
        }).onConflictDoUpdate({ target: [canvasMessages.userId, canvasMessages.messageId], set: { body: m.body, subject } }).run();
        stored++;
      }
      tx.insert(canvasConversations).values({ userId, conversationId: c.id, lastMessageAt: c.last_message_at })
        .onConflictDoUpdate({ target: [canvasConversations.userId, canvasConversations.conversationId], set: { lastMessageAt: c.last_message_at } }).run();
    });
  }
  // A conversation that leaves the listing was archived as often as deleted,
  // so its messages are kept.
  return stored;
}
