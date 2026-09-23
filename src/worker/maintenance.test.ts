import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db/client";
import { guideRuns, modules, syncRuns, users } from "../db/schema";
import { evictCaches, pruneSyncRuns } from "./maintenance";
import { failOrphanedGuideRuns, failStaleGuideRuns } from "../db/repo";

const file = (path: string, bytes: number, ageSec: number) => {
  writeFileSync(path, Buffer.alloc(bytes));
  const t = new Date(Date.now() - ageSec * 1000);
  utimesSync(path, t, t);
};

describe("evictCaches", () => {
  it("removes least recently used files until under the limit, and stale .part debris", () => {
    const root = mkdtempSync(join(tmpdir(), "cache-"));
    mkdirSync(join(root, "c1"));
    file(join(root, "c1", "old.pdf"), 400, 300);
    file(join(root, "c1", "mid.pdf"), 400, 200);
    file(join(root, "new.pdf"), 400, 10);
    file(join(root, "x.pdf.1.2.part"), 50, 7200);
    const r = evictCaches([root, join(root, "missing")], 800);
    expect(existsSync(join(root, "c1", "old.pdf"))).toBe(false);
    expect(existsSync(join(root, "x.pdf.1.2.part"))).toBe(false);
    expect(existsSync(join(root, "c1", "mid.pdf"))).toBe(true);
    expect(existsSync(join(root, "new.pdf"))).toBe(true);
    expect(r).toMatchObject({ removed: 2, total: 800 });
  });
});

describe("pruneSyncRuns", () => {
  it("drops runs older than a week", () => {
    const db = createDb(":memory:");
    const now = Date.now();
    db.insert(syncRuns).values([
      { userId: 1, source: "canvas", startedAt: now - 8 * 86_400_000 },
      { userId: 1, source: "canvas", startedAt: now - 3600_000 },
    ]).run();
    expect(pruneSyncRuns(db, now)).toBe(1);
    expect(db.select().from(syncRuns).all()).toHaveLength(1);
  });
});

describe("guide runs after a restart", () => {
  it("fails runs a dead worker had started, keeps queued ones, and gives up on day-old queued ones", () => {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    db.insert(modules).values([{ userId: 1, canvasCourseId: 1, code: "A", name: "a" }, { userId: 1, canvasCourseId: 2, code: "B", name: "b" }, { userId: 1, canvasCourseId: 3, code: "C", name: "c" }]).run();
    const now = Date.now();
    db.insert(guideRuns).values([
      { userId: 1, moduleId: 1, requestedAt: now - 60_000, startedAt: now - 50_000 },
      { userId: 1, moduleId: 2, requestedAt: now - 10_000 },
      { userId: 1, moduleId: 3, requestedAt: now - 2 * 86_400_000 },
    ]).run();
    failStaleGuideRuns(db, now);
    failOrphanedGuideRuns(db, now);
    const rows = db.select().from(guideRuns).all();
    expect(rows[0]).toMatchObject({ ok: false, stage: "Interrupted" });
    expect(rows[1]!.finishedAt).toBeNull();
    expect(rows[2]).toMatchObject({ ok: false });
  });
});
