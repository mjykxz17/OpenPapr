import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { syncRuns } from "../db/schema";

export interface SyncDeps {
  db: Db;
  now: () => number;
  canvasSync: (userId: number) => Promise<void>; // fetch + normalize + applyCanvasSync
  mailSync: (userId: number) => Promise<void>; // delta fetch + normalize + upsertMailItems + persist deltaLink/refresh token
  // rules pass + LLM pass over triage IS NULL / 'unscored' emails. The worker
  // leaves it out and runs it in the enrichment lane instead (enrich-queue).
  enrich?: (userId: number) => Promise<void>;
}

type Source = "canvas" | "graph" | "enrich";

// Runs one job, with a sync_runs row that shows it running and how it ended.
// A failure is recorded, not thrown: one source failing never stops the next.
export async function recordRun(deps: Pick<SyncDeps, "db" | "now">, userId: number, source: Source, job: (userId: number) => Promise<void>): Promise<boolean> {
  const run = deps.db.insert(syncRuns).values({ userId, source, startedAt: deps.now() }).returning().get();
  try {
    await job(userId);
    deps.db.update(syncRuns).set({ finishedAt: deps.now(), ok: true }).where(eq(syncRuns.id, run.id)).run();
    return true;
  } catch (err) {
    deps.db.update(syncRuns).set({ finishedAt: deps.now(), ok: false, error: String(err) }).where(eq(syncRuns.id, run.id)).run();
    return false;
  }
}

export async function runUserSync(deps: SyncDeps, userId: number): Promise<void> {
  const jobs: [Source, (userId: number) => Promise<void>][] = [["canvas", deps.canvasSync], ["graph", deps.mailSync]];
  if (deps.enrich) jobs.push(["enrich", deps.enrich]);
  for (const [source, job] of jobs) await recordRun(deps, userId, source, job);
}

export function computeBackoffMs(consecutiveFailures: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** consecutiveFailures, 3_600_000);
}

export class BackoffSkipError extends Error {}

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

  // A manual sync is an explicit retry: drop this user's failure history so
  // the cycle actually runs instead of hitting BackoffSkipError part-way
  // through a penalty the user is trying to override.
  const resetUser = (userId: number): void => {
    for (const m of [failures, lastFailAt, lastError])
      for (const key of [...m.keys()]) if (key.endsWith(`:${userId}`)) m.delete(key);
  };

  return Object.assign(guard, { resetUser });
}
