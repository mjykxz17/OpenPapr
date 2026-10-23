import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { files, items, modules, syncRuns, users } from "../db/schema";
import { closeOrphanedRounds, countedFetch, createEnrichRounds, enrichUser, type EnrichKit } from "./enrich";
import type { Budget } from "./enrich-queue";

// One user with one module: a file the rules cannot sort, a mail they cannot
// triage, and an announcement to read deadlines from.
function setup() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS1010", name: "x", active: true }).run();
  db.insert(files).values({ moduleId: 1, canvasFileId: 99, displayName: "xyz.bin", discoveredAt: 0 }).run();
  db.insert(items).values([
    { userId: 1, type: "email", source: "graph", sourceId: "mail:1", title: "Hello", body: "lunch?", sender: "prof@u.edu", firstSeenAt: 1 },
    { userId: 1, moduleId: 1, type: "announcement", source: "canvas", sourceId: "announcement:1", title: "Quiz", body: "Quiz on Friday", firstSeenAt: 2 },
  ]).run();
  return db;
}

// A turn's budget on a fake clock, recording what it was told.
function budgetOn(clock: { t: number }, ms: number) {
  const start = clock.t;
  const seen: boolean[] = [];
  const budget: Budget = { left: () => clock.t - start < ms, progress: (ok = true) => { seen.push(ok); } };
  return { budget, seen };
}

// A provider that is down: every call takes longer than a whole turn's budget
// and fails.
function deadKit(clock: { t: number }, calls: string[]): EnrichKit {
  const slow = async <T,>(name: string, result: T): Promise<T> => { calls.push(name); clock.t += 200_000; return result; };
  return {
    fileCategorizer: () => slow("files", null),
    scorer: () => slow("mail", { triage: "unscored" as const, importance: null, reason: "llm unavailable" }),
    actionExtractor: () => slow("actions", null),
    deadlineClassifier: null,
    weightage: null,
  };
}

describe("enrichUser", () => {
  it("tries each failing call once a round, so a dead provider does not keep it from the end", async () => {
    const db = setup();
    const clock = { t: 0 };
    const calls: string[] = [];
    const kit = deadKit(clock, calls);
    const tried = new Set<string>();
    const turn = () => {
      const { budget, seen } = budgetOn(clock, 90_000);
      return enrichUser({ db, now: () => clock.t }, kit, 1, [1], tried, budget).then((done) => ({ done, seen }));
    };

    // Each turn spends its budget on one call that fails, then stops — and
    // the next turn goes on to the next piece rather than the same one.
    expect(await turn()).toEqual({ done: false, seen: [false] });
    expect(await turn()).toEqual({ done: false, seen: [false] });
    expect(await turn()).toEqual({ done: true, seen: [false] });
    expect(calls).toEqual(["files", "mail", "actions"]);
    expect(db.select().from(items).where(eq(items.id, 2)).get()!.actionsAttempts).toBe(1);

    // Nothing more this round.
    expect(await turn()).toEqual({ done: true, seen: [] });
    expect(calls).toHaveLength(3);

    // The next sync tries them all again, once each.
    tried.clear();
    for (let i = 0; i < 3; i++) await turn();
    expect(calls).toEqual(["files", "mail", "actions", "files", "mail", "actions"]);
  });

  it("does it all in one turn when the provider answers", async () => {
    const db = setup();
    const kit: EnrichKit = {
      fileCategorizer: async (batch) => new Map(batch.map((f) => [f.id, "slides" as const])),
      scorer: async () => ({ triage: "important", importance: 0.9, reason: "from the lecturer" }),
      actionExtractor: async () => [],
      deadlineClassifier: null,
      weightage: null,
    };
    const { budget, seen } = budgetOn({ t: 0 }, 90_000);
    expect(await enrichUser({ db, now: () => 0 }, kit, 1, [1], new Set(), budget)).toBe(true);
    expect(seen.every(Boolean)).toBe(true);
    expect(db.select().from(files).get()!.category).toBe("slides");
    expect(db.select().from(items).where(eq(items.id, 1)).get()!.triage).toBe("important");
  });
});

describe("createEnrichRounds", () => {
  const enrichRows = (db: ReturnType<typeof setup>) => db.select().from(syncRuns).where(eq(syncRuns.source, "enrich")).all();

  it("shows the round running from the sync until its work is done", () => {
    const db = setup();
    let t = 100;
    const rounds = createEnrichRounds(db, () => t);
    rounds.start(1);
    expect(enrichRows(db)).toMatchObject([{ startedAt: 100, finishedAt: null }]);
    // Another sync before it finished: still the one row.
    rounds.start(1);
    expect(enrichRows(db)).toHaveLength(1);
    t = 200;
    rounds.finish(1, null);
    expect(enrichRows(db)).toMatchObject([{ finishedAt: 200, ok: true }]);
    rounds.start(1);
    rounds.finish(1, "boom");
    expect(enrichRows(db)).toHaveLength(2);
    expect(enrichRows(db)[1]).toMatchObject({ ok: false, error: "boom" });
  });

  it("starts each round with nothing tried", () => {
    const rounds = createEnrichRounds(setup(), () => 0);
    rounds.start(1);
    rounds.tried(1).add("mail:1");
    rounds.start(1);
    expect(rounds.tried(1).size).toBe(0);
  });

  it("closes rounds a previous worker left open", () => {
    const db = setup();
    createEnrichRounds(db, () => 5).start(1);
    expect(closeOrphanedRounds(db, 9)).toBe(1);
    expect(enrichRows(db)).toMatchObject([{ finishedAt: 9, ok: false }]);
  });
});

describe("countedFetch", () => {
  it("counts every request that ends, and says whether it worked", async () => {
    const progress = vi.fn();
    const budget: Budget = { left: () => true, progress };
    const base = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockRejectedValueOnce(new Error("timed out"));
    const f = countedFetch(budget, base as unknown as typeof fetch);
    await f("http://x/1");
    await f("http://x/2");
    await expect(f("http://x/3")).rejects.toThrow("timed out");
    expect(progress.mock.calls).toEqual([[true], [false], [false]]);
  });
});
