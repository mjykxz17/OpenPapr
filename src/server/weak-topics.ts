import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { quizAttempts } from "@/db/schema";

// Slides a student keeps getting wrong in the chapter quizzes: what the
// planner turns into "revise slides X–Y" steps, and what a quiz brings back.
export type WeakSpot = {
  deck: string | null;        // the deck the missed question is from
  page: number | null;        // its slide
  topicTitle: string | null;  // the chapter it was asked in
  missed: number;             // wrong answers on it that a later right answer has not cleared
  lastMissedAt: number;
};

// Answers are grouped by the slide their question came from (by chapter when
// a question has no slide). A right answer on a slide clears the misses
// before it; the misses after the last right answer are what is weak.
// Answers stamped after `now` are not counted, so a plan made "as of" a time
// sees what the student knew then. Newest miss first.
export function weakSpots(db: Db, userId: number, moduleId: number, now: number): WeakSpot[] {
  const rows = db.select().from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.moduleId, moduleId))).all()
    .filter((r) => r.answeredAt <= now);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.deck !== null && r.page !== null ? `s:${r.deck.toLowerCase()}#${r.page}` : `t:${r.topicTitle ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: WeakSpot[] = [];
  for (const g of groups.values()) {
    const lastRight = Math.max(-Infinity, ...g.filter((r) => r.correct).map((r) => r.answeredAt));
    const misses = g.filter((r) => !r.correct && r.answeredAt > lastRight).sort((a, b) => b.answeredAt - a.answeredAt);
    if (!misses.length) continue;
    const last = misses[0]!;
    out.push({ deck: last.deck, page: last.page, topicTitle: last.topicTitle, missed: misses.length, lastMissedAt: last.answeredAt });
  }
  return out.sort((a, b) => b.lastMissedAt - a.lastMissedAt || b.missed - a.missed);
}
