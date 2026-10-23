import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { components, files, items, modules, syncRuns } from "../db/schema";
import { applyExtractedActions, recordActionFailure, selectActionCandidates, shouldAttemptWeightage } from "../db/repo";
import { categorizeModuleFiles, type FileCategorizer } from "../enrich/file-category";
import { triageEmail } from "../enrich/rules";
import type { LlmScore } from "../enrich/llm";
import type { createCompatActionExtractor } from "../enrich/actions";
import type { createCompatDeadlineClassifier } from "../enrich/classify";
import type { Budget } from "./enrich-queue";

// Everything a sync leaves for a model, for one user: files the rules could
// not sort, weightage, mail triage, deadlines found in announcements and
// mail, and deadline categories. It runs in the enrichment lane, in turns
// with a time budget (enrich-queue), so one sync's worth of it can take
// several turns.
//
// Each sync starts a round, and in a round every piece of work is tried once.
// A model call that fails leaves its rows as they were (a file uncategorised,
// a mail "unscored"), and without the round's record of what was tried each
// turn would start over on the same failing calls — against a provider that
// is down, every turn would spend its budget on the first one and never get
// further. So a failure is tried again on the next sync, as before the lane.

export type EnrichKit = {
  scorer: ((mail: { sender: string | null; title: string; body: string | null }) => Promise<LlmScore>) | null;
  fileCategorizer: FileCategorizer | null;
  actionExtractor: ReturnType<typeof createCompatActionExtractor> | null;
  deadlineClassifier: ReturnType<typeof createCompatDeadlineClassifier> | null;
  // Reads one module's syllabus sources and asks the model for its weightage;
  // true when the model answered.
  weightage: ((moduleId: number) => Promise<boolean>) | null;
};

// One user's round: what it has tried, and the sync_runs row that shows it
// running. The row opens when the sync hands its model work over and closes
// when the round is done — so the Sync button keeps spinning until the work
// it started is finished, however many turns that takes.
export function createEnrichRounds(db: Db, now: () => number) {
  const rounds = new Map<number, { tried: Set<string>; runId: number | null }>();
  const openRow = (userId: number) => db.insert(syncRuns).values({ userId, source: "enrich", startedAt: now() }).returning().get().id;

  return {
    // A sync is done: a fresh round, in the row already open if the last
    // round has not finished.
    start(userId: number): void {
      const runId = rounds.get(userId)?.runId ?? openRow(userId);
      rounds.set(userId, { tried: new Set(), runId });
    },
    tried(userId: number): Set<string> {
      let r = rounds.get(userId);
      if (!r) { r = { tried: new Set(), runId: null }; rounds.set(userId, r); }
      return r.tried;
    },
    // The round got to the end (error null) or failed.
    finish(userId: number, error: string | null): void {
      const r = rounds.get(userId);
      const runId = r?.runId ?? openRow(userId);
      db.update(syncRuns).set({ finishedAt: now(), ok: error === null, error }).where(eq(syncRuns.id, runId)).run();
      if (r) r.runId = null;
    },
  };
}
export type EnrichRounds = ReturnType<typeof createEnrichRounds>;

// Rounds live in the worker's memory. One a previous worker left open will
// never be closed by anyone else; at start they are marked as cut short.
export function closeOrphanedRounds(db: Db, now: number): number {
  return db.update(syncRuns).set({ finishedAt: now, ok: false, error: "the worker restarted before this finished" })
    .where(and(eq(syncRuns.source, "enrich"), isNull(syncRuns.finishedAt))).run().changes;
}

// A profile or task rebuild is one piece of a turn but many requests: a model
// call per module, pages, reviews. Each that ends through this fetch —
// answered, failed or timed out — counts as progress, so the watchdog sees a
// long rebuild moving rather than half an hour of silence. Time spent in a
// provider's rate queue comes before the request and does not count.
export function countedFetch(budget: Budget, base: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    try {
      const res = await base(input, init);
      budget.progress(res.ok);
      return res;
    } catch (err) {
      budget.progress(false);
      throw err;
    }
  }) as typeof fetch;
}

// Does what it can of one user's round inside the budget, checked before each
// model call. True when it got to the end, false when time ran out; the next
// turn carries on from what is still undone and not yet tried.
export async function enrichUser(
  deps: { db: Db; now: () => number }, kit: EnrichKit, userId: number,
  moduleIds: number[], tried: Set<string>, budget: Budget,
): Promise<boolean> {
  const { db } = deps;
  const { scorer, actionExtractor, deadlineClassifier, fileCategorizer, weightage } = kit;

  // Files the rules could not sort, one batch per module.
  if (fileCategorizer) for (const moduleId of moduleIds) {
    if (tried.has(`files:${moduleId}`)) continue;
    const undecided = () => db.select({ n: sql<number>`count(*)` }).from(files)
      .where(and(eq(files.moduleId, moduleId), isNull(files.category))).get()?.n ?? 0;
    const before = undecided();
    if (before === 0) continue;
    if (!budget.left()) return false;
    tried.add(`files:${moduleId}`);
    await categorizeModuleFiles(db, moduleId, fileCategorizer);
    budget.progress(undecided() < before);
  }

  // Weightage: component-less modules only, at most weekly.
  if (weightage) for (const moduleId of moduleIds) {
    const mod = db.select().from(modules).where(eq(modules.id, moduleId)).get();
    const have = db.select({ id: components.id }).from(components).where(eq(components.moduleId, moduleId)).all();
    if (!mod || !shouldAttemptWeightage(have.length, mod.weightageCheckedAt, deps.now())) continue;
    if (tried.has(`weightage:${moduleId}`)) continue;
    if (!budget.left()) return false;
    tried.add(`weightage:${moduleId}`);
    budget.progress(await weightage(moduleId));
  }

  const activeCodes = db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => m.code);
  const pending = db.select().from(items).where(and(
    eq(items.userId, userId), eq(items.type, "email"),
    or(isNull(items.triage), inArray(items.triage, ["unscored"])),
  )).all();
  for (const mail of pending) {
    const ruled = triageEmail({ sender: mail.sender, title: mail.title, body: mail.body, moduleId: mail.moduleId }, { activeCodes });
    if (ruled.verdict !== "ambiguous" || !scorer) {
      db.update(items).set({ triage: ruled.verdict === "ambiguous" ? "unscored" : ruled.verdict, importanceReason: ruled.reason })
        .where(eq(items.id, mail.id)).run();
      continue;
    }
    if (tried.has(`mail:${mail.id}`)) continue;
    if (!budget.left()) return false;
    tried.add(`mail:${mail.id}`);
    const scored = await scorer({ sender: mail.sender, title: mail.title, body: mail.body });
    db.update(items).set({ triage: scored.triage, importance: scored.importance, importanceReason: scored.reason })
      .where(eq(items.id, mail.id)).run();
    budget.progress(scored.triage !== "unscored");
  }

  // Deadline extraction: announcements + important emails from ACTIVE modules
  // (emails with no module link included), once per item, capped per cycle so
  // a cold start can't burst the LLM budget. A null result counts as a failed
  // attempt and is retried on later syncs, but only up to MAX_ACTION_ATTEMPTS
  // — an item the extractor can never parse must not be retried forever.
  if (!actionExtractor) return true;
  const activeIds = new Set(
    db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.active, true))).all().map((m) => m.id));
  for (const item of selectActionCandidates(db, userId, activeIds)) {
    if (tried.has(`actions:${item.id}`)) continue;
    if (!budget.left()) return false;
    tried.add(`actions:${item.id}`);
    const actions = await actionExtractor({ title: item.title, body: item.body, postedAt: item.sourceCreatedAt ?? item.firstSeenAt });
    budget.progress(actions !== null);
    if (actions === null) {
      recordActionFailure(db, item.id);
      continue;
    }
    applyExtractedActions(db, userId, item.id, actions, deps.now());
  }

  // Classify unclassified deadlines in one batched call per sync.
  if (!deadlineClassifier || tried.has("classify")) return true;
  const codeById = new Map(db.select().from(modules).where(eq(modules.userId, userId)).all().map((m) => [m.id, m.code]));
  const unclassified = db.select().from(items).where(and(
    eq(items.userId, userId), eq(items.type, "deadline"), isNull(items.category),
  )).all().slice(0, 50);
  if (unclassified.length === 0) return true;
  if (!budget.left()) return false;
  tried.add("classify");
  const result = await deadlineClassifier(unclassified.map((d) => ({
    id: d.id, title: d.title, module: d.moduleId !== null ? codeById.get(d.moduleId) ?? null : null,
  })));
  budget.progress(result !== null);
  if (result) for (const [id, category] of result)
    db.update(items).set({ category }).where(eq(items.id, id)).run();
  return true;
}
