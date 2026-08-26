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

export class BackoffSkipError extends Error {}

// The worker ticks every few seconds instead of sleeping a whole poll
// interval, so a manual sync request is picked up promptly; a cycle still
// starts on its own only once per pollIntervalMs.
export function shouldStartCycle(opts: { lastCycleAt: number | null; requested: boolean; now: number; pollIntervalMs: number }): boolean {
  if (opts.requested) return true;
  return opts.lastCycleAt === null || opts.now - opts.lastCycleAt >= opts.pollIntervalMs;
}

export function createGuard(baseMs: number, now: () => number = Date.now) {
  const failures = new Map<string, number>();
  const lastFailAt = new Map<string, number>();
  const lastError = new Map<string, string>();
  const guard = function (source: string, fn: (userId: number) => Promise<void>) {
    return async (userId: number) => {
      const key = `${source}:${userId}`;
      const n = failures.get(key) ?? 0;
      if (n > 0 && now() - (lastFailAt.get(key) ?? 0) < computeBackoffMs(n, baseMs)) {
        throw new BackoffSkipError(`backing off ${source} after ${n} consecutive failure(s); last error: ${lastError.get(key) ?? "unknown"}`);
      }
      try {
        await fn(userId);
        failures.set(key, 0);
      } catch (err) {
        failures.set(key, n + 1);
        lastFailAt.set(key, now());
        lastError.set(key, String(err));
        throw err;
      }
    };
  };
  // A manual sync is an explicit retry: forget this user's failure history so
  // the cycle runs instead of hitting BackoffSkipError mid-backoff.
  const resetUser = (userId: number): void => {
    for (const m of [failures, lastFailAt, lastError])
      for (const key of [...m.keys()]) if (key.endsWith(`:${userId}`)) m.delete(key);
  };
  return Object.assign(guard, { resetUser });
}
