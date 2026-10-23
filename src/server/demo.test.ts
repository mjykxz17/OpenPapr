import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { files, items, modules, quizAttempts, studyGuides, syncRuns, tasks, users } from "../db/schema";
import { DEMO_COURSE_BASE, demoDue, findDemoUser, lastMidnightSgt, resetDemo } from "./demo";
import { deckCachePath, slidePngPath } from "./deck";
import { splitGuideIntoChapters } from "../lib/study-chapters";
import { chapterQuiz } from "./guide-quiz";
import { changesFor, openChangeCount } from "./changes";
import { moduleProfileView, userProfileView } from "./profiles";
import { tasksView } from "./tasks";
import { DEMO_DECK_SOURCES, deckPages } from "../demo/decks";

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
    expect(JSON.parse(deck.textSigJson!).pages).toBe(12);
    const md = db.select().from(studyGuides).where(eq(studyGuides.moduleId, algo.id)).get()!.markdown;
    expect(md).toContain("[L3 p8](slide:L3-divide-conquer#8)");
    expect(splitGuideIntoChapters(md).chapters.map((c) => c.label)).toEqual(["1. Asymptotic analysis", "2. Divide and conquer", "3. Amortised analysis"]);

    // A visitor makes a mess; the nightly reset puts the semester back.
    db.update(tasks).set({ status: "done" }).where(eq(tasks.userId, id)).run();
    db.insert(quizAttempts).values({ userId: id, moduleId: algo.id, chapterHash: "h", question: 0, chosen: 1, correct: false, answeredAt: now }).run();
    const again = await resetDemo(db, now + 86_400_000, dbPath);
    expect(again).toBe(id);
    expect(db.select().from(tasks).where(eq(tasks.userId, id)).all().filter((t) => t.status === "open").length).toBeGreaterThan(3);
    expect(db.select().from(modules).where(eq(modules.userId, id)).all()).toHaveLength(4);
    expect(db.select().from(quizAttempts).where(eq(quizAttempts.userId, id)).all()).toHaveLength(0);
    expect(db.select().from(users).all()).toHaveLength(2);
  });

  it("looks complete in every module without a model call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-"));
    const dbPath = join(dir, "x.db");
    const db = createDb(":memory:");
    const now = Date.parse("2026-10-23T08:00:00+08:00");
    const id = await resetDemo(db, now, dbPath);
    const mods = db.select().from(modules).where(eq(modules.userId, id)).all();
    for (const m of mods) {
      // Its decks are on disk, filed as lecture slides or tutorials.
      const mine = DEMO_DECK_SOURCES.filter((d) => d.module === m.code);
      const rows = db.select().from(files).where(eq(files.moduleId, m.id)).all();
      expect(rows.map((f) => f.displayName).sort(), m.code).toEqual(mine.map((d) => `${d.stem}.pdf`).sort());
      for (const f of rows) expect(existsSync(deckCachePath(m.canvasCourseId, f.displayName, dbPath))).toBe(true);
      // The guide's count is the lecture decks it is written from.
      const lectures = mine.filter((d) => d.category === "slides");
      const guide = db.select().from(studyGuides).where(eq(studyGuides.moduleId, m.id)).get()!;
      expect(guide.sourceNote).toBe(`${lectures.length} deck${lectures.length === 1 ? "" : "s"}, ${lectures.reduce((n, d) => n + deckPages(d), 0)} slides`);
      // "Quiz me" answers from what was seeded: no model is given.
      const chapters = splitGuideIntoChapters(guide.markdown).chapters;
      for (let i = 0; i < chapters.length; i++) {
        const out = await chapterQuiz(db, id, m.id, i, null, now);
        expect("questions" in out && out.cached && out.questions.length >= 4, `${m.code} chapter ${i + 1}`).toBe(true);
      }
      // The About tab has a profile.
      expect(moduleProfileView(db, m).profile?.oneLine, m.code).toBeTruthy();
    }
    expect(DEMO_DECK_SOURCES.find((d) => d.module === "CS3230" && d.category === "tutorial")).toBeTruthy();
    expect(userProfileView(db, id).profile?.headline).toBeTruthy();
    expect(userProfileView(db, id).historyCount).toBeGreaterThan(4);

    // Today's first step points at a guide that exists.
    const today = tasksView(db, id, now).today;
    expect(today.map((s) => s.text)).toContain("Skim the SOLID notes in the study guide");

    // The bell has a date to confirm and some new work.
    expect(openChangeCount(db, id, now)).toBe(2);
    expect(changesFor(db, id, now).map((c) => [c.kind, c.code])).toEqual([["date_proposed", "CS2105"], ["task_added", "CS2103T"]]);

    // Nothing links to a Canvas that doesn't have these courses.
    expect(db.select().from(items).where(eq(items.userId, id)).all().filter((i) => i.url !== null)).toEqual([]);

    // The account agrees with the "synced" the module pages show, and with
    // having no token: no "last worked" for the Account page to show.
    const user = findDemoUser(db)!;
    const sync = db.select().from(syncRuns).where(eq(syncRuns.userId, id)).all().find((r) => r.source === "canvas")!;
    expect(user.lastSyncStartedAt).toBe(sync.startedAt);
    expect(user.canvasTokenEnc).toBeNull();
    expect(user.canvasVerifiedAt).toBeNull();
    expect(user.canvasTokenFailedAt).toBeNull();
  });

  it("drops slide images drawn from an older copy of a deck", async () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-"));
    const dbPath = join(dir, "x.db");
    const db = createDb(":memory:");
    const now = Date.parse("2026-10-23T08:00:00+08:00");
    const id = await resetDemo(db, now, dbPath);
    const algo = db.select().from(modules).where(eq(modules.userId, id)).all().find((m) => m.code === "CS3230")!;
    const file = db.select().from(files).where(eq(files.moduleId, algo.id)).all().find((f) => f.displayName === "L1-asymptotics.pdf")!;
    const png = slidePngPath({ path: deckCachePath(algo.canvasCourseId, file.displayName, dbPath), file }, 12, 2);
    mkdirSync(dirname(png), { recursive: true });
    writeFileSync(png, "old");
    await resetDemo(db, now + 86_400_000, dbPath);
    expect(existsSync(png)).toBe(false);
  });
});
