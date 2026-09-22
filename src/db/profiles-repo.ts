import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { courseHistory, moduleProfiles, modules, nusmodsModules, nusmodsReviews, slideNotes, users, weeklyPlans } from "./schema";
import type { NusmodsModule, Review } from "../connectors/nusmods/client";

// --- course history -------------------------------------------------------
export function upsertCourseHistory(
  db: Db, userId: number,
  rows: { canvasCourseId: number; code: string; name: string; term: string | null; state: "active" | "completed" }[],
  now: number,
): void {
  for (const r of rows) {
    db.insert(courseHistory).values({ userId, ...r })
      .onConflictDoUpdate({ target: [courseHistory.userId, courseHistory.canvasCourseId], set: { code: r.code, name: r.name, term: r.term, state: r.state } })
      .run();
  }
  db.update(users).set({ courseHistoryAt: now }).where(eq(users.id, userId)).run();
}

export function listCourseHistory(db: Db, userId: number) {
  return db.select().from(courseHistory).where(eq(courseHistory.userId, userId)).all();
}

// --- NUSMods caches (shared across users) -----------------------------------
export function getNusmods(db: Db, code: string): { module: NusmodsModule | null; fetchedAt: number; acadYear: string | null } | null {
  const row = db.select().from(nusmodsModules).where(eq(nusmodsModules.code, code)).get();
  if (!row) return null;
  return { module: row.json ? (JSON.parse(row.json) as NusmodsModule) : null, fetchedAt: row.fetchedAt, acadYear: row.acadYear };
}

export function putNusmods(db: Db, code: string, found: { acadYear: string; module: NusmodsModule } | null, now: number): void {
  const values = { code, acadYear: found?.acadYear ?? null, json: found ? JSON.stringify(found.module) : null, fetchedAt: now };
  db.insert(nusmodsModules).values(values).onConflictDoUpdate({ target: nusmodsModules.code, set: values }).run();
}

export function getReviews(db: Db, code: string): { reviews: Review[]; fetchedAt: number } | null {
  const row = db.select().from(nusmodsReviews).where(eq(nusmodsReviews.code, code)).get();
  return row ? { reviews: JSON.parse(row.postsJson) as Review[], fetchedAt: row.fetchedAt } : null;
}

export function putReviews(db: Db, code: string, reviews: Review[], now: number): void {
  const values = { code, postsJson: JSON.stringify(reviews), count: reviews.length, fetchedAt: now };
  db.insert(nusmodsReviews).values(values).onConflictDoUpdate({ target: nusmodsReviews.code, set: values }).run();
}

// --- module profiles ----------------------------------------------------------
export type Lecturer = { name: string; staffUrl?: string | null; pageText?: string | null; pageFetchedAt?: number | null };

export function getModuleProfileRow(db: Db, moduleId: number) {
  return db.select().from(moduleProfiles).where(eq(moduleProfiles.moduleId, moduleId)).get();
}

export function patchModuleProfile(db: Db, moduleId: number, patch: Partial<typeof moduleProfiles.$inferInsert>): void {
  db.insert(moduleProfiles).values({ moduleId, ...patch })
    .onConflictDoUpdate({ target: moduleProfiles.moduleId, set: patch }).run();
}

export function readLecturers(json: string | null | undefined): Lecturer[] {
  if (!json) return [];
  try { return JSON.parse(json) as Lecturer[]; } catch { return []; }
}

// Merges Canvas's current teacher list with what the student has added: a
// staff page they pasted survives the next sync.
export function mergeLecturers(existing: Lecturer[], canvasNames: string[]): Lecturer[] {
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));
  const out = canvasNames.map((name) => byName.get(name.toLowerCase()) ?? { name });
  for (const l of existing) if (l.staffUrl && !out.some((o) => o.name.toLowerCase() === l.name.toLowerCase())) out.push(l);
  return out;
}

export function ownedModule(db: Db, userId: number, moduleId: number) {
  return db.select().from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).get();
}

// --- weekly plan -----------------------------------------------------------
export function getWeeklyPlanRow(db: Db, userId: number) {
  return db.select().from(weeklyPlans).where(eq(weeklyPlans.userId, userId)).get();
}

export function patchWeeklyPlan(db: Db, userId: number, patch: Partial<typeof weeklyPlans.$inferInsert> & { weekStart?: number }): void {
  const existing = getWeeklyPlanRow(db, userId);
  if (existing) db.update(weeklyPlans).set(patch).where(eq(weeklyPlans.userId, userId)).run();
  else db.insert(weeklyPlans).values({ userId, weekStart: patch.weekStart ?? 0, ...patch }).run();
}

// --- notes, for writing style ------------------------------------------------
export function userNotesText(db: Db, userId: number, maxChars = 8000): { text: string; totalChars: number } {
  const rows = db.select().from(slideNotes).where(eq(slideNotes.userId, userId)).orderBy(desc(slideNotes.updatedAt)).all();
  const totalChars = rows.reduce((n, r) => n + r.markdown.length, 0);
  let text = "";
  for (const r of rows) {
    if (text.length + r.markdown.length + 8 > maxChars) break;
    text += `${r.markdown.trim()}\n---\n`;
  }
  return { text, totalChars };
}

// Singapore week: Monday 00:00 SGT.
export function weekStartSgt(now: number): number {
  const SGT = 8 * 3_600_000;
  const local = new Date(now + SGT);
  const day = (local.getUTCDay() + 6) % 7; // Mon = 0
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - SGT;
  return midnight - day * 86_400_000;
}
