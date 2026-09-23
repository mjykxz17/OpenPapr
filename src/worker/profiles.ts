import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { components, files, items, moduleProfiles, modules, users, weeklyPlans } from "../db/schema";
import {
  getModuleProfileRow, getNusmods, getReviews, getWeeklyPlanRow, listCourseHistory, mergeLecturers,
  patchModuleProfile, patchWeeklyPlan, putNusmods, putReviews, readLecturers, upsertCourseHistory, userNotesText, weekStartSgt,
} from "../db/profiles-repo";
import { fetchNusmodsModule, fetchReviews, moduleCodes, pickReviews } from "../connectors/nusmods/client";
import { fetchStaffPageText } from "../connectors/nusmods/staff-page";
import type { CanvasClient } from "../connectors/canvas/client";
import type { CompatConfig } from "../enrich/openai-compat";
import {
  buildModuleProfile, buildUserProfile, buildWeeklyPlan, buildWritingStyle,
  ModuleProfile, UserProfile, WritingStyle, type ModuleProfileInput,
} from "../enrich/profiles";
import { htmlToText } from "../lib/html-text";

const H = 3_600_000;
const D = 24 * H;
export const TTL = {
  history: D, nusmods: 7 * D, reviews: 7 * D, lecturers: 7 * D, staffPage: 30 * D,
  moduleProfile: 20 * H, userProfile: 12 * H, plan: 6 * H, style: 7 * D,
};
const MODULE_PROFILES_PER_RUN = 2;
const MIN_NOTES_FOR_STYLE = 400;

export type ProfileDeps = {
  db: Db;
  now: () => number;
  disqusKey: string | null;
  cfgFor: (userId: number) => CompatConfig | null;
  canvasFor: (userId: number) => CanvasClient | null;
  fetchFn?: typeof fetch;
};

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const parse = <T,>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, json: string | null | undefined): T | null => {
  if (!json) return null;
  try { const r = schema.safeParse(JSON.parse(json)); return r.success ? (r.data as T) : null; } catch { return null; }
};
const errText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 300);

// The weightage the rest of the app shows: a manual entry beats Canvas, which
// beats one read out of the syllabus by the model.
export function effectiveComponents(rows: { name: string; weightPct: number | null; source: string }[]) {
  for (const source of ["manual", "canvas_api", "llm_syllabus"]) {
    const picked = rows.filter((r) => r.source === source && r.weightPct !== null);
    if (picked.length) return picked.map((r) => ({ name: r.name, weightPct: r.weightPct! }));
  }
  return [];
}

// --- public data, cached for everyone ---------------------------------------
async function ensureNusmods(deps: ProfileDeps, code: string) {
  const cached = getNusmods(deps.db, code);
  if (cached && deps.now() - cached.fetchedAt < TTL.nusmods) return cached.module;
  try {
    const found = await fetchNusmodsModule(code, deps.now(), deps.fetchFn);
    putNusmods(deps.db, code, found, deps.now());
    return found?.module ?? null;
  } catch {
    return cached?.module ?? null; // NUSMods down: keep last week's copy
  }
}

async function ensureReviews(deps: ProfileDeps, code: string) {
  const cached = getReviews(deps.db, code);
  if (!deps.disqusKey) return cached?.reviews ?? [];
  if (cached && deps.now() - cached.fetchedAt < TTL.reviews) return cached.reviews;
  try {
    const reviews = await fetchReviews(code, deps.disqusKey, 150, deps.fetchFn);
    putReviews(deps.db, code, reviews, deps.now());
    return reviews;
  } catch {
    return cached?.reviews ?? [];
  }
}

// --- one module --------------------------------------------------------------
async function refreshLecturers(deps: ProfileDeps, userId: number, mod: typeof modules.$inferSelect) {
  const row = getModuleProfileRow(deps.db, mod.id);
  let lecturers = readLecturers(row?.lecturersJson);
  const now = deps.now();
  if (!row?.lecturersAt || now - row.lecturersAt > TTL.lecturers) {
    const canvas = deps.canvasFor(userId);
    if (canvas) {
      try {
        const teachers = await canvas.listCourseTeachers(mod.canvasCourseId);
        lecturers = mergeLecturers(lecturers, teachers.map((t) => t.name));
      } catch { /* the roster can be hidden from students; keep what we have */ }
    }
  }
  for (const l of lecturers) {
    if (!l.staffUrl) continue;
    if (l.pageText && l.pageFetchedAt && now - l.pageFetchedAt < TTL.staffPage) continue;
    try {
      l.pageText = await fetchStaffPageText(l.staffUrl, deps.fetchFn);
      l.pageFetchedAt = now;
    } catch { /* unreachable page: try again next time */ }
  }
  patchModuleProfile(deps.db, mod.id, { lecturersJson: JSON.stringify(lecturers), lecturersAt: row?.lecturersAt && now - row.lecturersAt <= TTL.lecturers ? row.lecturersAt : now });
  return lecturers;
}

export async function moduleProfileInput(deps: ProfileDeps, userId: number, mod: typeof modules.$inferSelect): Promise<ModuleProfileInput> {
  const { db } = deps;
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;
  const code = moduleCodes(mod.code)[0] ?? null;
  const nusmods = code ? await ensureNusmods(deps, code) : null;
  const allReviews = code ? await ensureReviews(deps, code) : [];
  const lecturers = await refreshLecturers(deps, userId, mod);
  const anns = db.select().from(items)
    .where(and(eq(items.userId, userId), eq(items.moduleId, mod.id), eq(items.type, "announcement")))
    .orderBy(desc(items.sourceCreatedAt)).limit(8).all();
  const history = listCourseHistory(db, userId).filter((h) => h.canvasCourseId !== mod.canvasCourseId);
  return {
    module: { code: mod.code, name: mod.name, term: mod.term },
    nusmods,
    reviews: pickReviews(allReviews, 12_000, deps.now()),
    reviewTotal: allReviews.length,
    lecturers: lecturers.map((l) => ({ name: l.name, pageText: l.pageText ?? null })),
    components: effectiveComponents(db.select().from(components).where(eq(components.moduleId, mod.id)).all()),
    announcements: anns.map((a) => ({
      title: a.title, text: htmlToText(a.body).slice(0, 800),
      postedAt: a.sourceCreatedAt ? new Date(a.sourceCreatedAt).toISOString() : null,
    })),
    fileNames: db.select().from(files).where(eq(files.moduleId, mod.id)).all().map((f) => f.displayName),
    student: {
      major: user.major, year: user.studyYear,
      history: history.map((h) => `${h.code} ${h.name}${h.state === "active" ? " (current)" : ""}`),
    },
  };
}

// Announcement bodies change wording without changing substance, so the hash
// covers titles and dates; everything else is hashed as given.
const inputHash = (i: ModuleProfileInput) => hash({
  ...i, announcements: i.announcements.map((a) => [a.title, a.postedAt]), reviews: i.reviews.length, reviewTotal: i.reviewTotal,
});

// --- the whole refresh ---------------------------------------------------------
export type RefreshResult = { history: boolean; modules: number; style: boolean; user: boolean; plan: boolean; errors: string[] };

export async function refreshProfiles(deps: ProfileDeps, userId: number): Promise<RefreshResult> {
  const { db } = deps;
  const out: RefreshResult = { history: false, modules: 0, style: false, user: false, plan: false, errors: [] };
  const now = deps.now();
  let user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return out;

  // 1. What they have studied.
  if (!user.courseHistoryAt || now - user.courseHistoryAt > TTL.history) {
    const canvas = deps.canvasFor(userId);
    if (canvas) {
      try {
        // Courses closed to the student come back as a bare {id,
        // access_restricted_by_date: true} with no code or name; they cannot
        // say anything about what was studied, so they are skipped.
        const courses = (await canvas.listCourseHistory()).filter((c) => c.course_code && c.name);
        upsertCourseHistory(db, userId, courses.map((c) => ({
          canvasCourseId: c.id, code: c.course_code, name: c.name, term: c.term?.name ?? null, state: c.historyState,
        })), now);
        out.history = true;
      } catch (err) { out.errors.push(`history: ${errText(err)}`); }
    }
  }

  const cfg = deps.cfgFor(userId);
  if (!cfg) clearProfileRequests(db, userId, "no AI provider — add your own API key in Account");
  const active = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true), eq(modules.hidden, false))).all();

  // 2. Each module. Requested rebuilds first, then whatever is oldest.
  const rows = new Map(active.map((m) => [m.id, getModuleProfileRow(db, m.id)]));
  const order = [...active].sort((a, b) => {
    const ra = rows.get(a.id), rb = rows.get(b.id);
    return Number(Boolean(rb?.requestedAt)) - Number(Boolean(ra?.requestedAt)) || (ra?.generatedAt ?? 0) - (rb?.generatedAt ?? 0);
  });
  let built = 0;
  for (const mod of order) {
    const row = rows.get(mod.id);
    const requested = Boolean(row?.requestedAt);
    if (!requested && built >= MODULE_PROFILES_PER_RUN) continue;
    let input: ModuleProfileInput;
    try { input = await moduleProfileInput(deps, userId, mod); } catch (err) { out.errors.push(`${mod.code}: ${errText(err)}`); continue; }
    if (!cfg) continue;
    const h = inputHash(input);
    const fresh = row?.profileJson && row.inputsHash === h;
    const recent = row?.generatedAt && now - row.generatedAt < TTL.moduleProfile;
    if (!requested && (fresh || (recent && row?.profileJson))) continue;
    try {
      const profile = await buildModuleProfile(cfg, input, deps.fetchFn);
      patchModuleProfile(db, mod.id, { profileJson: JSON.stringify(profile), inputsHash: h, generatedAt: deps.now(), requestedAt: null, error: null });
      out.modules++;
      built++;
    } catch (err) {
      patchModuleProfile(db, mod.id, { error: errText(err), requestedAt: null, generatedAt: deps.now() });
      out.errors.push(`${mod.code}: ${errText(err)}`);
      built++;
    }
  }
  if (!cfg) return out;

  // 3. How they write, from their own notes — only if they allow it.
  user = db.select().from(users).where(eq(users.id, userId)).get()!;
  if (user.styleLearning) {
    const { text, totalChars } = userNotesText(db, userId);
    const grown = !user.writingStyleNotesChars || totalChars >= user.writingStyleNotesChars * 1.25;
    const stale = !user.writingStyleAt || now - user.writingStyleAt > TTL.style;
    if (totalChars >= MIN_NOTES_FOR_STYLE && (!user.writingStyleJson || (grown && stale) || (grown && totalChars - (user.writingStyleNotesChars ?? 0) > 2000))) {
      try {
        const style = await buildWritingStyle(cfg, text, deps.fetchFn);
        db.update(users).set({ writingStyleJson: JSON.stringify(style), writingStyleAt: deps.now(), writingStyleNotesChars: totalChars }).where(eq(users.id, userId)).run();
        out.style = true;
      } catch (err) { out.errors.push(`style: ${errText(err)}`); }
    }
  }

  // 4. The student as a whole.
  user = db.select().from(users).where(eq(users.id, userId)).get()!;
  const moduleProfilesNow = active.map((m) => ({ mod: m, profile: parse<ModuleProfile>(ModuleProfile, getModuleProfileRow(db, m.id)?.profileJson) }));
  const style = user.styleLearning ? parse<WritingStyle>(WritingStyle, user.writingStyleJson) : null;
  const userInput = {
    major: user.major, year: user.studyYear,
    history: listCourseHistory(db, userId).map((h) => ({ code: h.code, name: h.name, state: h.state })),
    modules: moduleProfilesNow.map(({ mod, profile }) => ({
      code: mod.code, oneLine: profile?.oneLine ?? null, gaps: profile?.fit.gaps ?? [], workload: profile?.studentsSay?.workload ?? null,
    })),
    style,
  };
  const uh = hash(userInput);
  const userDue = user.profileRequestedAt || (user.profileInputsHash !== uh && (!user.profileAt || now - user.profileAt > TTL.userProfile)) || !user.profileJson;
  if (userDue) {
    try {
      const profile = await buildUserProfile(cfg, userInput, deps.fetchFn);
      db.update(users).set({ profileJson: JSON.stringify(profile), profileInputsHash: uh, profileAt: deps.now(), profileRequestedAt: null, profileError: null }).where(eq(users.id, userId)).run();
      out.user = true;
    } catch (err) {
      db.update(users).set({ profileRequestedAt: null, profileError: errText(err), profileAt: deps.now() }).where(eq(users.id, userId)).run();
      out.errors.push(`profile: ${errText(err)}`);
    }
  }

  // 5. This week.
  const planned = await refreshWeeklyPlan(deps, userId, cfg);
  out.plan = planned === "built";
  if (planned && planned !== "built" && planned !== "skipped") out.errors.push(`plan: ${planned}`);
  return out;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SGT = 8 * H;

async function refreshWeeklyPlan(deps: ProfileDeps, userId: number, cfg: CompatConfig): Promise<"built" | "skipped" | string> {
  const { db } = deps;
  const now = deps.now();
  const week = weekStartSgt(now);
  const row = getWeeklyPlanRow(db, userId);
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;
  const active = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true), eq(modules.hidden, false))).all();
  const codeById = new Map(active.map((m) => [m.id, m.code]));
  const due = db.select().from(items).where(and(
    eq(items.userId, userId),
    inArray(items.type, ["assignment", "deadline", "event"]),
    eq(items.dismissed, false), eq(items.submitted, false),
    isNotNull(items.dueAt), gte(items.dueAt, now - 6 * H), lte(items.dueAt, now + 14 * D),
  )).orderBy(items.dueAt).limit(40).all();
  const fmt = (ms: number) => new Date(ms + SGT).toUTCString().replace(/:\d\d GMT$/, "").replace(/^(\w+), 0?(\d+) (\w+) \d+ /, "$1 $2 $3 ");
  const todayIdx = Math.floor((now - week) / D);
  const input = {
    today: fmt(now).replace(/ \d\d:\d\d$/, ""),
    daysLeft: DAY_NAMES.slice(Math.min(6, Math.max(0, todayIdx))),
    student: parse<UserProfile>(UserProfile, user.profileJson),
    modules: active.map((m) => ({
      code: m.code,
      profile: parse<ModuleProfile>(ModuleProfile, getModuleProfileRow(db, m.id)?.profileJson),
      components: effectiveComponents(db.select().from(components).where(eq(components.moduleId, m.id)).all()),
    })),
    due: due.map((d) => ({ module: d.moduleId ? codeById.get(d.moduleId) ?? null : null, title: d.title, due: fmt(d.dueAt!), kind: d.category ?? d.type })),
  };
  // The day is part of the hash: a plan made on Monday is replanned on
  // Thursday with only the days that are left.
  const h = hash({ ...input, today: input.today.slice(0, 3) });
  const requested = Boolean(row?.requestedAt);
  const current = row && row.weekStart === week && row.planJson;
  if (!requested && current && (row.inputsHash === h || (row.generatedAt && now - row.generatedAt < TTL.plan))) return "skipped";
  try {
    const plan = await buildWeeklyPlan(cfg, input, deps.fetchFn);
    patchWeeklyPlan(db, userId, { weekStart: week, planJson: JSON.stringify(plan), inputsHash: h, generatedAt: deps.now(), requestedAt: null, error: null });
    return "built";
  } catch (err) {
    patchWeeklyPlan(db, userId, { weekStart: row?.weekStart ?? week, requestedAt: null, error: errText(err), generatedAt: deps.now() });
    return errText(err);
  }
}

// Users with a rebuild the UI asked for, so the worker can serve them within
// seconds instead of waiting for their next scheduled sweep.
export function usersWithProfileRequests(db: Db): number[] {
  const ids = new Set<number>();
  for (const u of db.select({ id: users.id }).from(users).where(isNotNull(users.profileRequestedAt)).all()) ids.add(u.id);
  for (const p of db.select({ userId: weeklyPlans.userId }).from(weeklyPlans).where(isNotNull(weeklyPlans.requestedAt)).all()) ids.add(p.userId);
  for (const m of db.select({ userId: modules.userId }).from(moduleProfiles)
    .innerJoin(modules, eq(moduleProfiles.moduleId, modules.id)).where(isNotNull(moduleProfiles.requestedAt)).all()) ids.add(m.userId);
  return [...ids];
}

// Every requested rebuild gets exactly one attempt: whatever happened, the
// flag is cleared afterwards so a failing model cannot put a user into a
// two-second retry loop.
export function clearProfileRequests(db: Db, userId: number, reason: string | null): void {
  const mine = db.select({ id: modules.id }).from(modules).where(eq(modules.userId, userId)).all().map((m) => m.id);
  if (mine.length) {
    const pending = db.select().from(moduleProfiles).where(and(inArray(moduleProfiles.moduleId, mine), isNotNull(moduleProfiles.requestedAt))).all();
    for (const p of pending) db.update(moduleProfiles).set({ requestedAt: null, ...(reason ? { error: reason } : {}) }).where(eq(moduleProfiles.id, p.id)).run();
  }
  const plan = getWeeklyPlanRow(db, userId);
  if (plan?.requestedAt) db.update(weeklyPlans).set({ requestedAt: null, ...(reason ? { error: reason } : {}) }).where(eq(weeklyPlans.userId, userId)).run();
  const u = db.select().from(users).where(eq(users.id, userId)).get();
  if (u?.profileRequestedAt) db.update(users).set({ profileRequestedAt: null, ...(reason ? { profileError: reason } : {}) }).where(eq(users.id, userId)).run();
}
