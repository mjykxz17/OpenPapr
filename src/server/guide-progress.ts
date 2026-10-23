import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { guideProgress, guideTopics, modules } from "@/db/schema";
import { getStudyGuide } from "@/db/repo";
import { slugifyHeading, splitGuideIntoChapters } from "@/lib/study-chapters";

// Which chapters of a guide the student has marked as read. A chapter is
// known by its guide topic's key, which stays put when chapters are
// renumbered or rewritten; a hand-written guide has no topics, so its
// chapters go by their heading.

const headingTitle = (chapterMarkdown: string) => chapterMarkdown.split("\n")[0]!.replace(/^#+\s*/, "").replace(/^\d+\.\s*/, "").trim();

export function chapterKeys(db: Db, moduleId: number, markdown: string): string[] {
  const topics = db.select({ key: guideTopics.key, title: guideTopics.title }).from(guideTopics).where(eq(guideTopics.moduleId, moduleId)).all();
  const byTitle = new Map(topics.map((t) => [t.title.trim().toLowerCase(), t.key]));
  return splitGuideIntoChapters(markdown).chapters.map((c) => {
    const title = headingTitle(c.markdown);
    return byTitle.get(title.toLowerCase()) ?? `h:${slugifyHeading(title)}`;
  });
}

export type Progress = { read: boolean[] };
type Result = Progress | { error: string; status: number };

function owned(db: Db, userId: number, moduleId: number) {
  return db.select({ id: modules.id }).from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).get() ?? null;
}

// One flag per chapter of the current guide, in order.
export function readProgress(db: Db, userId: number, moduleId: number): Result {
  if (!owned(db, userId, moduleId)) return { error: "Module not found", status: 404 };
  const guide = getStudyGuide(db, moduleId);
  if (!guide) return { read: [] };
  const keys = chapterKeys(db, moduleId, guide.markdown);
  const done = new Set(keys.length ? db.select({ k: guideProgress.topicKey }).from(guideProgress)
    .where(and(eq(guideProgress.userId, userId), eq(guideProgress.moduleId, moduleId), inArray(guideProgress.topicKey, keys))).all().map((r) => r.k) : []);
  return { read: keys.map((k) => done.has(k)) };
}

export function markChapter(db: Db, userId: number, moduleId: number, chapter: number, read: boolean, now: number): Result {
  if (!owned(db, userId, moduleId)) return { error: "Module not found", status: 404 };
  const guide = getStudyGuide(db, moduleId);
  const key = guide ? chapterKeys(db, moduleId, guide.markdown)[chapter] : undefined;
  if (!key) return { error: "That chapter isn't in the guide any more — reload the page.", status: 404 };
  if (read) {
    db.insert(guideProgress).values({ userId, moduleId, topicKey: key, readAt: now })
      .onConflictDoUpdate({ target: [guideProgress.userId, guideProgress.moduleId, guideProgress.topicKey], set: { readAt: now } }).run();
  } else {
    db.delete(guideProgress).where(and(eq(guideProgress.userId, userId), eq(guideProgress.moduleId, moduleId), eq(guideProgress.topicKey, key))).run();
  }
  return readProgress(db, userId, moduleId);
}
