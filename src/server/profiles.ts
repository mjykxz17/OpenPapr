import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { getModuleProfileRow, getNusmods, getReviews, getWeeklyPlanRow, listCourseHistory, readLecturers, weekStartSgt } from "@/db/profiles-repo";
import { moduleCodes } from "@/connectors/nusmods/client";
import { ModuleProfile, UserProfile, WeeklyPlan, WritingStyle } from "@/enrich/profiles";

function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }, json: string | null | undefined): T | null {
  if (!json) return null;
  try { const r = schema.safeParse(JSON.parse(json)); return r.success ? (r.data as T) : null; } catch { return null; }
}

export type Status = { builtAt: number | null; pending: boolean; error: string | null };

export function userProfileView(db: Db, userId: number) {
  const u = db.select().from(users).where(eq(users.id, userId)).get()!;
  return {
    major: u.major, studyYear: u.studyYear, styleLearning: u.styleLearning,
    profile: parse<UserProfile>(UserProfile, u.profileJson),
    style: parse<WritingStyle>(WritingStyle, u.writingStyleJson),
    historyCount: listCourseHistory(db, userId).length,
    status: { builtAt: u.profileJson ? u.profileAt : null, pending: Boolean(u.profileRequestedAt), error: u.profileError } as Status,
  };
}

export function moduleProfileView(db: Db, mod: { id: number; code: string }) {
  const row = getModuleProfileRow(db, mod.id);
  const code = moduleCodes(mod.code)[0] ?? null;
  const reviews = code ? getReviews(db, code) : null;
  const nusmods = code ? getNusmods(db, code) : null;
  return {
    code,
    profile: parse<ModuleProfile>(ModuleProfile, row?.profileJson),
    lecturers: readLecturers(row?.lecturersJson).map((l) => ({ name: l.name, staffUrl: l.staffUrl ?? null, hasPage: Boolean(l.pageText) })),
    reviewCount: reviews?.reviews.length ?? 0,
    onNusmods: Boolean(nusmods?.module),
    status: { builtAt: row?.profileJson ? row.generatedAt : null, pending: Boolean(row?.requestedAt), error: row?.error ?? null } as Status,
  };
}

export function weeklyPlanView(db: Db, userId: number, now: number) {
  const row = getWeeklyPlanRow(db, userId);
  const plan = row && row.weekStart === weekStartSgt(now) ? parse<WeeklyPlan>(WeeklyPlan, row.planJson) : null;
  return {
    plan,
    status: { builtAt: plan ? row!.generatedAt : null, pending: Boolean(row?.requestedAt), error: row?.error ?? null } as Status,
  };
}
