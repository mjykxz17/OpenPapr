import { and, asc, eq, desc, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import { components, files, guideRuns, items, modules, slideNotes, studyGuides, users, type FileCategory, type FileCategorySource } from "./schema";
import type { NormalizedCanvasSync } from "../connectors/canvas/normalize";
import type { MailItem } from "../connectors/graph/normalize";
import { decrypt, encrypt } from "../lib/crypto";

// Maps a validated Canvas identity to a local account, creating one if needed.
// Canvas is the identity provider here: possession of a working token is the
// proof, and canvas_user_id is the durable key (tokens get rotated).
export function resolveCanvasUser(
  db: Db,
  self: { id: number; name: string },
  token: string,
  secretHex: string,
  now: number,
): number {
  const tokenEnc = encrypt(token, secretHex);

  const existing = db.select().from(users).where(eq(users.canvasUserId, self.id)).get();
  if (existing) {
    db.update(users).set({ name: self.name, canvasTokenEnc: tokenEnc, canvasVerifiedAt: now, canvasTokenFailedAt: null }).where(eq(users.id, existing.id)).run();
    return existing.id;
  }

  // Pre-multi-user rows have no canvas_user_id. Adopt one only when the token
  // presented decrypts to the token already stored there — that proves the
  // person signing in is the account's original owner, not merely the first to
  // arrive. Anything weaker would hand over an existing user's Canvas data.
  const legacy = db.select().from(users).where(isNull(users.canvasUserId)).all();
  for (const row of legacy) {
    if (!row.canvasTokenEnc) continue;
    let stored: string | null = null;
    try { stored = decrypt(row.canvasTokenEnc, secretHex); } catch { continue; }
    if (stored !== token) continue;
    db.update(users).set({ canvasUserId: self.id, name: self.name, canvasTokenEnc: tokenEnc, canvasVerifiedAt: now, canvasTokenFailedAt: null })
      .where(eq(users.id, row.id)).run();
    return row.id;
  }

  return db.insert(users)
    .values({ name: self.name, canvasUserId: self.id, canvasTokenEnc: tokenEnc, createdAt: now, canvasVerifiedAt: now })
    .returning().get().id;
}

export type DiscoveredFile = {
  canvasFileId: number;
  displayName: string;
  contentType: string | null;
  sizeBytes: number | null;
  hidden: boolean;
  linkedFrom?: string | null;
  linkContext?: string | null;
};

// Records what a module's files are, from both the Files listing and links
// harvested out of content HTML. A file already seen in the listing is never
// demoted to hidden: the listing is the more trustworthy signal, and the two
// sources overlap.
export function upsertModuleFiles(db: Db, moduleId: number, discovered: DiscoveredFile[], now: number): void {
  for (const f of discovered) {
    const existing = db.select().from(files)
      .where(and(eq(files.moduleId, moduleId), eq(files.canvasFileId, f.canvasFileId))).get();
    if (existing) {
      db.update(files).set({
        displayName: f.displayName,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        hidden: existing.hidden && f.hidden,
        // A file seen in the listing carries no link context; one harvested
        // from content does. Keep whichever we have — the category and its
        // source are untouched here, a re-sync is not a re-classification.
        linkedFrom: f.linkedFrom ?? existing.linkedFrom,
        linkContext: f.linkContext ?? existing.linkContext,
      }).where(eq(files.id, existing.id)).run();
      continue;
    }
    db.insert(files).values({
      moduleId, canvasFileId: f.canvasFileId, displayName: f.displayName, contentType: f.contentType,
      sizeBytes: f.sizeBytes, hidden: f.hidden, linkedFrom: f.linkedFrom ?? null, linkContext: f.linkContext ?? null,
      discoveredAt: now,
    }).run();
  }
}

export function setFileCategory(db: Db, fileId: number, category: FileCategory, source: FileCategorySource): void {
  const existing = db.select().from(files).where(eq(files.id, fileId)).get();
  if (!existing) return;
  if (existing.categorySource === "manual" && source !== "manual") return;
  db.update(files).set({ category, categorySource: source }).where(eq(files.id, fileId)).run();
}

export function listModuleFiles(db: Db, moduleId: number) {
  return db.select().from(files).where(eq(files.moduleId, moduleId)).all()
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: "base" }));
}

const stemOf = (name: string) => name.replace(/\.[^.]+$/, "").toLowerCase();

// Looks a deck up by filename stem, preferring a listed file over a hidden one
// when both carry the same name.
export function findModuleFileByStem(db: Db, moduleId: number, name: string) {
  const want = stemOf(name);
  const rows = db.select().from(files).where(eq(files.moduleId, moduleId)).all()
    .filter((r) => stemOf(r.displayName) === want);
  return rows.find((r) => !r.hidden) ?? rows[0];
}

// --- sign-in identity ---------------------------------------------------
// Set once so the Canvas token never has to be pasted again. Returns false if
// the name is taken by somebody else.
export function setCredentials(db: Db, userId: number, username: string, passwordHash: string): boolean {
  const taken = db.select().from(users).where(eq(users.username, username)).get();
  if (taken && taken.id !== userId) return false;
  db.update(users).set({ username, passwordHash }).where(eq(users.id, userId)).run();
  return true;
}

// --- account: linked credentials -------------------------------------
// Replaces the stored Canvas token for an account that already exists. The
// caller has already asked Canvas who the token belongs to; a token for a
// different Canvas user is refused rather than silently re-pointing this
// account at someone else's courses.
export function replaceCanvasToken(
  db: Db, userId: number, self: { id: number; name: string }, token: string, secretHex: string, now: number,
): "ok" | "different-account" {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) return "different-account";
  if (row.canvasUserId !== null && row.canvasUserId !== self.id) return "different-account";
  db.update(users).set({
    canvasUserId: self.id, name: self.name, canvasTokenEnc: encrypt(token, secretHex),
    canvasVerifiedAt: now, canvasTokenFailedAt: null,
  }).where(eq(users.id, userId)).run();
  return "ok";
}

// The worker's view of whether the stored token still works.
export function recordCanvasTokenCheck(db: Db, userId: number, ok: boolean, now: number): void {
  db.update(users).set(ok ? { canvasVerifiedAt: now, canvasTokenFailedAt: null } : { canvasTokenFailedAt: now })
    .where(eq(users.id, userId)).run();
}

export function setLlmProvider(
  db: Db, userId: number, cfg: { baseUrl: string; model: string; apiKey: string }, secretHex: string,
): void {
  db.update(users).set({ llmBaseUrl: cfg.baseUrl, llmModel: cfg.model, llmKeyEnc: encrypt(cfg.apiKey, secretHex) })
    .where(eq(users.id, userId)).run();
}

export function clearLlmProvider(db: Db, userId: number): void {
  db.update(users).set({ llmBaseUrl: null, llmModel: null, llmKeyEnc: null }).where(eq(users.id, userId)).run();
}

export function getUser(db: Db, userId: number) {
  return db.select().from(users).where(eq(users.id, userId)).get();
}

export function findByUsername(db: Db, username: string) {
  return db.select().from(users).where(eq(users.username, username)).get();
}

// --- study-guide generation queue -------------------------------------
// A row with startedAt null is work the worker has not begun. One outstanding
// request per module: pressing the button twice should not generate twice.
// A queued run that has not started yet takes the newest selection; one
// already running is left alone.
export function requestGuide(
  db: Db, userId: number, moduleId: number, now: number,
  choice: { fileIds?: number[] | null; mode?: "replace" | "merge" } = {},
): "queued" | "updated" | "busy" {
  const fileIdsJson = choice.fileIds?.length ? JSON.stringify(choice.fileIds) : null;
  const mode = choice.mode ?? "replace";
  const pending = db.select().from(guideRuns)
    .where(and(eq(guideRuns.moduleId, moduleId), isNull(guideRuns.finishedAt))).get();
  if (pending) {
    if (pending.startedAt) return "busy";
    db.update(guideRuns).set({ fileIdsJson, mode, requestedAt: now }).where(eq(guideRuns.id, pending.id)).run();
    return "updated";
  }
  db.insert(guideRuns).values({ userId, moduleId, requestedAt: now, fileIdsJson, mode }).run();
  return "queued";
}

export function claimNextGuideRun(db: Db, now: number) {
  const next = db.select().from(guideRuns)
    .where(and(isNull(guideRuns.startedAt), isNull(guideRuns.finishedAt)))
    .orderBy(asc(guideRuns.requestedAt), asc(guideRuns.id)).limit(1).get();
  if (!next) return undefined;
  db.update(guideRuns).set({ startedAt: now, stage: "Starting" }).where(eq(guideRuns.id, next.id)).run();
  return next;
}

export function updateGuideRun(db: Db, runId: number, patch: Partial<typeof guideRuns.$inferInsert>): void {
  db.update(guideRuns).set(patch).where(eq(guideRuns.id, runId)).run();
}

export function latestGuideRun(db: Db, moduleId: number) {
  return db.select().from(guideRuns).where(eq(guideRuns.moduleId, moduleId))
    .orderBy(desc(guideRuns.id)).limit(1).get();
}

// A run whose worker died would otherwise pin the module forever.
// Queued runs nobody picked up for a day are given up on.
export function failStaleGuideRuns(db: Db, now: number, maxAgeMs = 24 * 3_600_000): void {
  for (const r of db.select().from(guideRuns).where(and(isNull(guideRuns.finishedAt), isNull(guideRuns.startedAt))).all()) {
    if (now - r.requestedAt < maxAgeMs) continue;
    db.update(guideRuns)
      .set({ finishedAt: now, ok: false, error: "timed out", stage: "Timed out" })
      .where(eq(guideRuns.id, r.id)).run();
  }
}

// Runs started by a worker that has since died (a deploy, a crash). Called
// only when this worker has no generation running, so every started,
// unfinished run is one nobody is working on.
export function failOrphanedGuideRuns(db: Db, now: number): void {
  db.update(guideRuns)
    .set({ finishedAt: now, ok: false, error: "interrupted — the server restarted; generate again", stage: "Interrupted" })
    .where(and(isNull(guideRuns.finishedAt), isNotNull(guideRuns.startedAt))).run();
}

// "Sync now" from the web process. The worker has no inbox, so the request is
// left in the database for it to find on its next tick.
export function requestSync(db: Db, userId: number, now: number): void {
  db.update(users).set({ syncRequestedAt: now }).where(eq(users.id, userId)).run();
}

// Reads the flag and clears it in one step. Clearing matters: the worker ticks
// every couple of seconds, so a request left standing would restart the cycle
// on every tick rather than once.
export function takeSyncRequest(db: Db, userId: number): boolean {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row?.syncRequestedAt) return false;
  db.update(users).set({ syncRequestedAt: null }).where(eq(users.id, userId)).run();
  return true;
}

export function selectRequestedUsers(db: Db) {
  return db.select().from(users).where(isNotNull(users.syncRequestedAt)).all();
}

// Users whose next sync is due, longest-waiting first, at most `cap` of them.
// The worker ticks more often than the poll interval and takes a slice each
// time, so a cohort that signs up together does not stay synchronised: their
// sync times fan out over the first interval and stay spread thereafter.
export function selectDueUsers(db: Db, now: number, intervalMs: number, cap: number) {
  return db.select().from(users)
    .where(lte(users.lastSyncStartedAt, now - intervalMs))
    .orderBy(asc(users.lastSyncStartedAt), asc(users.id))
    .limit(cap).all();
}

// Stamped before the sync runs, not after, so a long or crashing sync cannot
// cause the same user to be picked again on the next tick.
export function markSyncStarted(db: Db, userId: number, now: number): void {
  db.update(users).set({ lastSyncStartedAt: now }).where(eq(users.id, userId)).run();
}

// How many times deadline extraction may fail on one item before we stop
// retrying it. The extractor returns null on both transient failures (provider
// down) and permanent ones (a body it can never parse); without this bound the
// permanent case is retried every poll cycle forever, and because the candidate
// pool is capped, those stuck items also starve newer ones out of the queue.
export const MAX_ACTION_ATTEMPTS = 5;

// Items still awaiting deadline extraction, oldest first, bounded by `cap`.
// Announcements must belong to an active module; emails must have been triaged
// important. Items that have exhausted their retries are excluded.
export function selectActionCandidates(db: Db, userId: number, activeModuleIds: Set<number>, cap = 25) {
  return db.select().from(items).where(and(
    eq(items.userId, userId),
    isNull(items.actionsExtractedAt),
    lt(items.actionsAttempts, MAX_ACTION_ATTEMPTS),
    inArray(items.type, ["announcement", "email"]),
  )).orderBy(asc(items.firstSeenAt), asc(items.id)).all().filter((i) =>
    i.type === "announcement"
      ? i.moduleId !== null && activeModuleIds.has(i.moduleId)
      : i.triage === "important",
  ).slice(0, cap);
}

// Records one failed extraction attempt. Deliberately leaves actionsExtractedAt
// null: giving up is not the same as having extracted, and conflating them
// would make a failed item indistinguishable from a processed one.
export function recordActionFailure(db: Db, itemId: number): void {
  db.update(items)
    .set({ actionsAttempts: sql`${items.actionsAttempts} + 1` })
    .where(eq(items.id, itemId)).run();
}

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

// --- Slide notes -----------------------------------------------------------

export function getSlideNote(db: Db, userId: number, moduleId: number, deck: string, page: number) {
  return db
    .select()
    .from(slideNotes)
    .where(and(eq(slideNotes.userId, userId), eq(slideNotes.moduleId, moduleId), eq(slideNotes.deck, deck), eq(slideNotes.page, page)))
    .get();
}

/** Every note this user has in a module, as a map key "deck#page" → markdown. Cheap: notes are short and few. */
export function listSlideNotes(db: Db, userId: number, moduleId: number) {
  return db
    .select({ deck: slideNotes.deck, page: slideNotes.page, markdown: slideNotes.markdown, updatedAt: slideNotes.updatedAt })
    .from(slideNotes)
    .where(and(eq(slideNotes.userId, userId), eq(slideNotes.moduleId, moduleId)))
    .orderBy(asc(slideNotes.deck), asc(slideNotes.page))
    .all();
}

// Saving whitespace deletes the row: a note that says nothing should not
// mark the slide as annotated.
export function upsertSlideNote(db: Db, userId: number, moduleId: number, deck: string, page: number, markdown: string, now: number): void {
  if (markdown.trim() === "") {
    db.delete(slideNotes)
      .where(and(eq(slideNotes.userId, userId), eq(slideNotes.moduleId, moduleId), eq(slideNotes.deck, deck), eq(slideNotes.page, page)))
      .run();
    return;
  }
  db.insert(slideNotes)
    .values({ userId, moduleId, deck, page, markdown, updatedAt: now })
    .onConflictDoUpdate({
      target: [slideNotes.userId, slideNotes.moduleId, slideNotes.deck, slideNotes.page],
      set: { markdown, updatedAt: now },
    })
    .run();
}
