import type { Db } from "@/db/client";

// Slides a student keeps getting wrong in the chapter quizzes: what the
// planner turns into "revise slides X–Y" steps, and what a quiz brings back.
export type WeakSpot = {
  deck: string | null;        // the deck the missed question is from
  page: number | null;        // its slide
  topicTitle: string | null;  // the chapter it was asked in
  missed: number;             // wrong answers on it that a later right answer has not cleared
  lastMissedAt: number;
};

export function weakSpots(_db: Db, _userId: number, _moduleId: number, _now: number): WeakSpot[] {
  return [];
}
