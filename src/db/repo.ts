import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { components, items, modules, studyGuides, syncRuns, users } from "./schema";
import type { NormalizedCanvasSync } from "../connectors/canvas/normalize";
import type { MailItem } from "../connectors/graph/normalize";

export function applyCanvasSync(db: Db, userId: number, sync: NormalizedCanvasSync, now: number): { moduleId: number } {
  const mod = db.insert(modules).values({ userId, ...sync.module })
    .onConflictDoUpdate({
      target: [modules.userId, modules.canvasCourseId],
      set: { code: sync.module.code, name: sync.module.name, term: sync.module.term, syllabusBody: sync.module.syllabusBody, active: true },
    }).returning().get();

  for (const c of sync.components) {
    db.insert(components).values({ moduleId: mod.id, ...c })
      .onConflictDoUpdate({
        target: [components.moduleId, components.name, components.source],
        set: { weightPct: c.weightPct, scorePct: c.scorePct },
      }).run();
  }

  for (const it of sync.items) {
    const existing = db.select().from(items)
      .where(and(eq(items.userId, userId), eq(items.source, "canvas"), eq(items.sourceId, it.sourceId))).get();
    if (!existing) {
      db.insert(items).values({ userId, moduleId: mod.id, source: "canvas", firstSeenAt: now, ...it }).run();
      continue;
    }
    if (it.type === "assignment" && existing.dueAt !== null && it.dueAt !== null && existing.dueAt !== it.dueAt) {
      db.insert(items).values({
        userId, moduleId: mod.id, type: "deadline_change", source: "canvas",
        sourceId: `${it.sourceId}:due:${it.dueAt}`, title: `Deadline moved: ${it.title}`,
        body: `was ${new Date(existing.dueAt).toISOString()}, now ${new Date(it.dueAt).toISOString()}`,
        url: it.url, firstSeenAt: now,
      }).onConflictDoNothing().run();
    }
    db.update(items).set({ title: it.title, body: it.body, url: it.url, dueAt: it.dueAt, submitted: it.submitted })
      .where(eq(items.id, existing.id)).run();
  }
  return { moduleId: mod.id };
}

export function upsertMailItems(db: Db, userId: number, mails: MailItem[], now: number): void {
  for (const m of mails) {
    db.insert(items).values({ userId, source: "graph", type: "email", firstSeenAt: now, triage: "unscored", ...m })
      .onConflictDoNothing().run();
  }
}

const TERM_CODE_RE = /^\[(\d+)\]/;

function parseTermCode(term: string | null): number | null {
  const m = term?.match(TERM_CODE_RE);
  return m ? Number(m[1]) : null;
}

// A module is active only when its term is the newest numeric term the user
// has. Non-Academic shells and past terms deactivate; if no module carries a
// numeric term at all, everything stays active (nothing to compare against).
export function setModuleActivity(db: Db, userId: number): void {
  const rows = db.select().from(modules).where(eq(modules.userId, userId)).all();
  const codes = rows.map((r) => parseTermCode(r.term)).filter((c): c is number => c !== null);
  if (codes.length === 0) return;
  const current = Math.max(...codes);
  for (const r of rows) {
    const active = parseTermCode(r.term) === current;
    if (r.active !== active) db.update(modules).set({ active }).where(eq(modules.id, r.id)).run();
  }
}

const ACTION_STOPWORDS = new Set(["the", "and", "for", "due", "this", "that", "week", "your", "with", "will", "from"]);

function distinctiveTokens(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !ACTION_STOPWORDS.has(t)));
}

export function isDuplicateOfExisting(action: { title: string; dueAt: number }, existing: { title: string; dueAt: number | null }[]): boolean {
  const tokens = distinctiveTokens(action.title);
  return existing.some((e) => {
    if (e.dueAt === null || Math.abs(e.dueAt - action.dueAt) > 48 * 3_600_000) return false;
    const theirs = distinctiveTokens(e.title);
    return [...tokens].some((t) => theirs.has(t));
  });
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// Inserts extracted deadline items under a parent announcement/email and marks
// the parent processed. Dedupe: an action restating an existing same-module
// item (due within 48h, sharing a distinctive title word) is skipped.
export function applyExtractedActions(
  db: Db, userId: number, parentItemId: number,
  actions: { title: string; dueAt: number; evidence: string }[], now: number,
): void {
  const parent = db.select().from(items).where(eq(items.id, parentItemId)).get();
  if (!parent) return;
  const existing = parent.moduleId === null ? [] :
    db.select().from(items).where(and(eq(items.userId, userId), eq(items.moduleId, parent.moduleId))).all()
      // Exclude only this parent's own children so re-apply stays idempotent;
      // deadlines extracted from OTHER announcements do participate in dedupe.
      .filter((i) => !i.sourceId.startsWith(`${parent.sourceId}:action:`))
      .map((i) => ({ title: i.title, dueAt: i.dueAt }));
  for (const a of actions) {
    if (isDuplicateOfExisting(a, existing)) continue;
    db.insert(items).values({
      userId, moduleId: parent.moduleId, source: parent.source, type: "deadline",
      sourceId: `${parent.sourceId}:action:${slug(a.title)}`,
      title: a.title, body: a.evidence, url: parent.url, dueAt: a.dueAt, firstSeenAt: now,
    }).onConflictDoNothing().run();
  }
  db.update(items).set({ actionsExtractedAt: now }).where(eq(items.id, parentItemId)).run();
}

const WEIGHTAGE_RETRY_MS = 7 * 24 * 3_600_000;

// Weightage extraction is attempted only for component-less modules, at most
// once a week — a syllabus with no stated breakdown must not cost an LLM call
// every poll cycle.
export function shouldAttemptWeightage(componentCount: number, checkedAt: number | null, now: number): boolean {
  if (componentCount > 0) return false;
  if (checkedAt === null) return true;
  return now - checkedAt > WEIGHTAGE_RETRY_MS;
}

// Hide/unhide a module from the home grid — a user preference; the module and
// its data are untouched. Ownership-checked.
export function setModuleHidden(db: Db, userId: number, moduleId: number, hidden: boolean): void {
  db.update(modules).set({ hidden }).where(and(eq(modules.id, moduleId), eq(modules.userId, userId))).run();
}

// Persist the home-grid order: each id gets its index as `position`, but only
// for modules the user owns — a foreign id in the list is ignored.
export function setModuleOrder(db: Db, userId: number, orderedIds: number[]): void {
  orderedIds.forEach((id, index) => {
    db.update(modules)
      .set({ position: index })
      .where(and(eq(modules.id, id), eq(modules.userId, userId)))
      .run();
  });
}

// One study guide per module; re-import replaces in place.
export function upsertStudyGuide(db: Db, moduleId: number, markdown: string, sourceNote: string | null, now: number): void {
  db.insert(studyGuides)
    .values({ moduleId, markdown, sourceNote, generatedAt: now })
    .onConflictDoUpdate({
      target: studyGuides.moduleId,
      set: { markdown, sourceNote, generatedAt: now },
    })
    .run();
}

export function getStudyGuide(db: Db, moduleId: number) {
  return db.select().from(studyGuides).where(eq(studyGuides.moduleId, moduleId)).get();
}

// A run whose finishedAt never arrives (worker killed mid-cycle) must not pin
// the UI on "running" forever.
const RUN_STALE_MS = 10 * 60_000;

export type SyncState = { pending: boolean; running: boolean; lastFinishedAt: number | null };

// Manual-sync contract: POST /api/sync sets users.syncRequestedAt (`pending`);
// the worker's next tick takes the request and starts a cycle, whose sync_runs
// rows make the state `running` until the cycle's last source finishes.
export function requestSync(db: Db, userId: number, now: number): void {
  db.update(users).set({ syncRequestedAt: now }).where(eq(users.id, userId)).run();
}

export function takeSyncRequest(db: Db, userId: number): boolean {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user?.syncRequestedAt) return false;
  db.update(users).set({ syncRequestedAt: null }).where(eq(users.id, userId)).run();
  return true;
}

export function getSyncState(db: Db, userId: number, now: number): SyncState {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const runs = db.select().from(syncRuns).where(eq(syncRuns.userId, userId)).all();
  const finished = runs.map((r) => r.finishedAt).filter((t): t is number => t !== null);
  return {
    pending: (user?.syncRequestedAt ?? null) !== null,
    running: runs.some((r) => r.finishedAt === null && now - r.startedAt < RUN_STALE_MS),
    lastFinishedAt: finished.length ? Math.max(...finished) : null,
  };
}

export type StudyGuideSummary = { moduleId: number; code: string; name: string; sourceNote: string | null; generatedAt: number };

// Index rows for the Study page: guides owned by this user, newest first.
export function listStudyGuides(db: Db, userId: number): StudyGuideSummary[] {
  return db
    .select({
      moduleId: studyGuides.moduleId,
      code: modules.code,
      name: modules.name,
      sourceNote: studyGuides.sourceNote,
      generatedAt: studyGuides.generatedAt,
    })
    .from(studyGuides)
    .innerJoin(modules, eq(modules.id, studyGuides.moduleId))
    .where(eq(modules.userId, userId))
    .orderBy(desc(studyGuides.generatedAt))
    .all();
}
