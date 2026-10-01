import type { Db } from "@/db/client";
import { cfgForUser } from "./llm-config";

// Whether the AI features can run for this user right now: their own
// provider, or the shared one while this month's allowance lasts. Mirrors the
// worker's choice so a button is never offered for a run certain to fail.
export function canGenerateGuides(db: Db, userId: number): boolean {
  return cfgForUser(db, userId) !== null;
}
