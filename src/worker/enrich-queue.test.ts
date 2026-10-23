import { describe, expect, it } from "vitest";
import { createEnrichQueue, type Turn } from "./enrich-queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A fake user's model work: `steps` calls of `stepMs` each on a fake clock,
// done while the turn's budget lasts.
function fakeWork(clock: { t: number }, steps: Record<number, number>, stepMs: number, log: string[]) {
  return async ({ userId, work, budget }: Turn) => {
    while (steps[userId]! > 0) {
      if (!budget.left()) return;
      await Promise.resolve();
      clock.t += stepMs;
      steps[userId]!--;
      log.push(`u${userId}`);
      budget.progress();
    }
    work.clear();
  };
}

describe("createEnrichQueue", () => {
  it("takes users in turn, each for its budget, rather than one user to the end", async () => {
    const clock = { t: 0 };
    const steps = { 1: 6, 2: 2, 3: 4 };
    const log: string[] = [];
    const q = createEnrichQueue({ run: fakeWork(clock, steps, 10, log), budgetMs: 20, holdMs: 1_000, now: () => clock.t });
    for (const id of [1, 2, 3]) q.add(id, ["enrich"]);

    await q.drain();
    expect(log).toEqual(["u1", "u1", "u2", "u2", "u3", "u3"]);
    // User 2 is done; 1 and 3 went to the back with what they had left.
    expect([q.queued(1), q.queued(2), q.queued(3)]).toEqual([true, false, true]);
    await q.drain();
    await q.drain();
    expect(log.join(" ")).toBe("u1 u1 u2 u2 u3 u3 u1 u1 u3 u3 u1 u1");
    expect(q.pending()).toBe(0);
  });

  it("serves someone who asked before the background sweep", async () => {
    const clock = { t: 0 };
    const log: string[] = [];
    const q = createEnrichQueue({ run: fakeWork(clock, { 1: 1, 2: 1, 3: 1 }, 1, log), budgetMs: 100, holdMs: 1_000, now: () => clock.t });
    q.add(1, ["enrich"]);
    q.add(2, ["enrich"]);
    q.add(3, ["profiles"], { urgent: true });
    await q.drain();
    expect(log).toEqual(["u3", "u1", "u2"]);
  });

  it("does not let a slow user hold up the others", async () => {
    // User 1's provider never answers. The lane waits `holdMs` for it, then
    // serves users 2 and 3, and does not start user 1 again meanwhile.
    let release: () => void = () => {};
    const served: number[] = [];
    const q = createEnrichQueue({
      budgetMs: 1_000, holdMs: 30,
      run: async ({ userId, work }) => {
        served.push(userId);
        if (userId === 1) await new Promise<void>((r) => { release = r; });
        work.clear();
      },
    });
    q.add(1, ["enrich"]);
    q.add(2, ["enrich"]);
    q.add(3, ["enrich"]);
    const started = Date.now();
    await q.drain();
    expect(served).toEqual([1, 2, 3]);
    expect(Date.now() - started).toBeLessThan(500);
    expect(q.running(1)).toBe(true);

    q.add(1, ["tasks"]);   // asked again while the slow turn runs
    await q.drain();
    expect(served).toEqual([1, 2, 3]);
    release();
    await sleep(0);
    expect(q.running(1)).toBe(false);
    await q.drain();
    expect(served).toEqual([1, 2, 3, 1]);
  });

  it("stops starting turns once too many are stuck, and reports how long", async () => {
    let clock = 0;
    const q = createEnrichQueue({
      budgetMs: 1_000, holdMs: 10, maxDetached: 2, now: () => clock,
      run: ({ userId }) => (userId <= 2 ? new Promise<void>(() => {}) : Promise.resolve()),
    });
    for (const id of [1, 2, 3]) q.add(id, ["enrich"]);
    await q.drain();
    expect(q.running(1) && q.running(2)).toBe(true);
    expect(q.queued(3)).toBe(true);   // waiting: both slots are taken
    clock = 25 * 60_000;
    expect(q.stalledMs()).toBe(25 * 60_000);
  });

  it("counts finished work as progress, not time spent waiting", async () => {
    const clock = { t: 0 };
    let progressAt = 0;
    const q = createEnrichQueue({
      budgetMs: 10 * 60_000, holdMs: 5,
      now: () => clock.t,
      run: async ({ budget }) => {
        clock.t += 60_000; budget.progress(); progressAt = clock.t;
        await new Promise(() => {});   // then waits forever, e.g. in a rate queue
      },
    });
    q.add(1, ["enrich"]);
    await q.drain();
    clock.t = progressAt + 5 * 60_000;
    expect(q.stalledMs()).toBe(5 * 60_000);
  });

  it("drops the work of a turn that throws, and carries on with the others", async () => {
    const served: number[] = [];
    const logs: string[] = [];
    const q = createEnrichQueue({
      budgetMs: 1_000, holdMs: 1_000, log: (m) => logs.push(m),
      run: async ({ userId, work }) => { served.push(userId); if (userId === 1) throw new Error("bad key"); work.clear(); },
    });
    q.add(1, ["enrich"]);
    q.add(2, ["enrich"]);
    await q.drain();
    await q.drain();
    expect(served).toEqual([1, 2]);
    expect(q.queued(1)).toBe(false);
    expect(logs[0]).toContain("bad key");
  });

  it("merges asks for a user already in line, keeping their place", async () => {
    const seen: string[][] = [];
    const q = createEnrichQueue({ budgetMs: 1_000, holdMs: 1_000, run: async ({ userId, work }) => { seen.push([String(userId), ...work]); work.clear(); } });
    q.add(1, ["enrich"]);
    q.add(2, ["enrich"]);
    q.add(1, ["profiles"]);
    await q.drain();
    expect(seen).toEqual([["1", "enrich", "profiles"], ["2", "enrich"]]);
  });
});
