import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { files, modules, studyGuides, tasks, users } from "../db/schema";
import { DEMO_COURSE_BASE, demoDue, findDemoUser, lastMidnightSgt, resetDemo } from "./demo";
import { deckCachePath } from "./deck";

describe("demo account", () => {
  it("knows when midnight in Singapore was", () => {
    const t = Date.parse("2026-10-02T01:30:00+08:00");
    expect(lastMidnightSgt(t)).toBe(Date.parse("2026-10-02T00:00:00+08:00"));
    expect(demoDue({ demoResetAt: Date.parse("2026-10-01T23:59:00+08:00") }, t)).toBe(true);
    expect(demoDue({ demoResetAt: Date.parse("2026-10-02T00:01:00+08:00") }, t)).toBe(false);
    expect(demoDue(null, t)).toBe(true);
  });

  it("seeds a semester with decks, and a reset puts it back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-"));
    const dbPath = join(dir, "x.db");
    const db = createDb(":memory:");
    db.insert(users).values({ name: "owner" }).run();
    const now = Date.parse("2026-10-02T09:00:00+08:00");
    const id = await resetDemo(db, now, dbPath);
    const demo = findDemoUser(db)!;
    expect(demo.id).toBe(id);
    expect(demo.isDemo).toBe(true);
    const mods = db.select().from(modules).where(eq(modules.userId, id)).all();
    expect(mods.map((m) => m.code)).toEqual(["CS2103T", "CS3230", "CS2105", "ST2334"]);
    expect(mods.every((m) => m.canvasCourseId > DEMO_COURSE_BASE)).toBe(true);
    const algo = mods.find((m) => m.code === "CS3230")!;
    expect(existsSync(deckCachePath(algo.canvasCourseId, "L3-divide-conquer.pdf", dbPath))).toBe(true);
    const deck = db.select().from(files).where(eq(files.moduleId, algo.id)).all().find((f) => f.displayName === "L3-divide-conquer.pdf")!;
    expect(JSON.parse(deck.textSigJson!).pages).toBe(15);
    expect(db.select().from(studyGuides).where(eq(studyGuides.moduleId, algo.id)).get()?.markdown).toContain("slide:L3-divide-conquer#11");

    // A visitor makes a mess; the nightly reset puts the semester back.
    db.update(tasks).set({ status: "done" }).where(eq(tasks.userId, id)).run();
    db.delete(modules).where(eq(modules.id, -1)).run();
    const again = await resetDemo(db, now + 86_400_000, dbPath);
    expect(again).toBe(id);
    expect(db.select().from(tasks).where(eq(tasks.userId, id)).all().filter((t) => t.status === "open").length).toBeGreaterThan(3);
    expect(db.select().from(modules).where(eq(modules.userId, id)).all()).toHaveLength(4);
    expect(db.select().from(users).all()).toHaveLength(2);
  });
});
