// The model work that follows a sync — sorting files, reading weightage out
// of the syllabus, triaging mail, finding deadlines, profiles, tasks — runs
// in its own lane, beside the syncs rather than inside them. A sync is a few
// seconds of Canvas requests; one user's model work can be minutes (a slow
// provider, a low requests-per-minute cap, a 3-minute timeout and a fallback).
// Inside the sync loop that held up every other user's sync behind it.
//
// The lane takes users in turn. Each turn gets a time budget: the work checks
// it between model calls and stops when it runs out, leaving the rest for the
// user's next turn, at the back of the line. So a user with a lot to do (or a
// slow provider) gets their share and then waits, and nobody waits behind
// them for long. Someone who asked (Sync now, Rebuild) goes ahead of the
// background sweep.
//
// A single call can still outlast the budget. Past `holdMs` the lane stops
// waiting for that turn and moves on; the turn finishes in the background and
// its user is not given another until it has. At most `maxDetached` turns run
// like that; past that the lane waits, and the worker's watchdog decides
// whether it is stuck (stalledMs).

export type Budget = {
  // Still inside this turn's share of time.
  left(): boolean;
  // A piece of work was finished: what the watchdog counts as progress.
  progress(): void;
};

export type Turn = { userId: number; work: Set<string>; urgent: boolean; budget: Budget };

type Entry = { work: Set<string>; urgent: boolean };
type Running = { lastProgressAt: number; detached: boolean };

export function createEnrichQueue(opts: {
  // Does what it can of `work` within the budget, deleting each item it
  // finishes. Whatever is left is queued again.
  run: (turn: Turn) => Promise<void>;
  budgetMs: number;
  holdMs: number;
  maxDetached?: number;
  now?: () => number;
  log?: (m: string) => void;
}) {
  const { run, budgetMs, holdMs, maxDetached = 2, now = Date.now, log = () => {} } = opts;
  const queue = new Map<number, Entry>();   // in line order
  const running = new Map<number, Running>();

  function add(userId: number, work: Iterable<string>, o: { urgent?: boolean } = {}): void {
    const hit = queue.get(userId);
    if (hit) {
      for (const w of work) hit.work.add(w);
      hit.urgent ||= Boolean(o.urgent);
      return;
    }
    const entry = { work: new Set(work), urgent: Boolean(o.urgent) };
    if (entry.work.size) queue.set(userId, entry);
  }

  // Asked-for work first, then the rest, each in line order. A user whose
  // last turn is still running waits for it.
  function pickNext(skip: Set<number>): number | undefined {
    let fallback: number | undefined;
    for (const [id, e] of queue) {
      if (running.has(id) || skip.has(id)) continue;
      if (e.urgent) return id;
      fallback ??= id;
    }
    return fallback;
  }

  const detachedCount = () => [...running.values()].filter((r) => r.detached).length;

  // One turn for the next user in line; returns who went, or undefined when
  // nobody can go now.
  async function runNext(skip: Set<number> = new Set()): Promise<number | undefined> {
    if (detachedCount() >= maxDetached) return undefined;
    const userId = pickNext(skip);
    if (userId === undefined) return undefined;
    const entry = queue.get(userId)!;
    queue.delete(userId);
    const startedAt = now();
    const state: Running = { lastProgressAt: startedAt, detached: false };
    running.set(userId, state);
    const budget: Budget = {
      left: () => now() - startedAt < budgetMs,
      progress: () => { state.lastProgressAt = now(); },
    };
    const done = (async () => {
      try {
        await run({ userId, work: entry.work, urgent: entry.urgent, budget });
      } catch (err) {
        // Dropped rather than retried at once: a turn that throws would throw
        // again. The next sync asks for it afresh.
        log(`enrichment for user ${userId} failed: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`);
        entry.work.clear();
      } finally {
        running.delete(userId);
        if (entry.work.size) add(userId, entry.work, { urgent: entry.urgent });
      }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      done.then(() => true),
      new Promise<boolean>((r) => { timer = setTimeout(() => r(false), holdMs); }),
    ]);
    clearTimeout(timer);
    if (!finished && running.has(userId)) {
      state.detached = true;
      log(`enrichment for user ${userId} is taking a while — carrying on with the others`);
    }
    return userId;
  }

  // One pass down the line: everyone waiting gets at most one turn. Work left
  // over goes to the back, for the next pass.
  async function drain(): Promise<number> {
    const served = new Set<number>();
    for (;;) {
      const id = await runNext(served);
      if (id === undefined) return served.size;
      served.add(id);
    }
  }

  return {
    add,
    drain,
    runNext,
    // Queued and not running: someone the lane could serve now.
    pending: () => [...queue.keys()].filter((id) => !running.has(id)).length,
    queued: (userId: number) => queue.has(userId),
    running: (userId: number) => running.has(userId),
    // The longest any running turn has gone without finishing a piece of
    // work. Waiting in a provider's queue does not count as progress.
    stalledMs: (): number => {
      const t = now();
      let worst = 0;
      for (const r of running.values()) worst = Math.max(worst, t - r.lastProgressAt);
      return worst;
    },
  };
}
export type EnrichQueue = ReturnType<typeof createEnrichQueue>;
