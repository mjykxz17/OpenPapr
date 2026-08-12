import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { syncRuns, users } from "../db/schema";
import { computeBackoffMs, runUserSync } from "./sync";

const setup = () => {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  return db;
};

describe("runUserSync", () => {
  it("records ok sync_runs for each source", async () => {
    const db = setup();
    await runUserSync({ db, now: () => 5, canvasSync: async () => {}, mailSync: async () => {}, enrich: async () => {} }, 1);
    const runs = db.select().from(syncRuns).all();
    expect(runs.map((r) => [r.source, r.ok])).toEqual([["canvas", true], ["graph", true], ["enrich", true]]);
    expect(runs.every((r) => r.finishedAt === 5)).toBe(true);
  });
  it("isolates failures: canvas throwing still runs graph and enrich", async () => {
    const db = setup();
    const mailSync = vi.fn(async () => {});
    await runUserSync({ db, now: () => 1, canvasSync: async () => { throw new Error("canvas down"); }, mailSync, enrich: async () => {} }, 1);
    expect(mailSync).toHaveBeenCalled();
    const canvasRun = db.select().from(syncRuns).all().find((r) => r.source === "canvas")!;
    expect(canvasRun.ok).toBe(false);
    expect(canvasRun.error).toContain("canvas down");
  });
});

describe("computeBackoffMs", () => {
  it("doubles per failure and caps at 1h", () => {
    expect(computeBackoffMs(0, 300_000)).toBe(300_000);
    expect(computeBackoffMs(2, 300_000)).toBe(1_200_000);
    expect(computeBackoffMs(10, 300_000)).toBe(3_600_000);
  });
});
