import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { syncRuns } from "../db/schema";

export interface SyncDeps {
  db: Db;
  now: () => number;
  canvasSync: (userId: number) => Promise<void>; // fetch + normalize + applyCanvasSync + weightage refresh
  mailSync: (userId: number) => Promise<void>; // delta fetch + normalize + upsertMailItems + persist deltaLink/refresh token
  enrich: (userId: number) => Promise<void>; // rules pass + LLM pass over triage IS NULL / 'unscored' emails
}

export async function runUserSync(deps: SyncDeps, userId: number): Promise<void> {
  const jobs = [
    ["canvas", deps.canvasSync],
    ["graph", deps.mailSync],
    ["enrich", deps.enrich],
  ] as const;
  for (const [source, job] of jobs) {
    const run = deps.db.insert(syncRuns).values({ userId, source, startedAt: deps.now() }).returning().get();
    try {
      await job(userId);
      deps.db.update(syncRuns).set({ finishedAt: deps.now(), ok: true }).where(eq(syncRuns.id, run.id)).run();
    } catch (err) {
      deps.db.update(syncRuns).set({ finishedAt: deps.now(), ok: false, error: String(err) }).where(eq(syncRuns.id, run.id)).run();
    }
  }
}

export function computeBackoffMs(consecutiveFailures: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** consecutiveFailures, 3_600_000);
}
