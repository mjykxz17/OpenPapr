import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { canvasPages, files, modules, users } from "../db/schema";
import type { CourseOutline } from "../lib/course-outline";
import { createHarvester } from "./harvest";

const H = 3_600_000;

function setup() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "a" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "IFS4103", name: "x", active: true }).run();
  let clock = 0;
  const harvest = createHarvester({ db, now: () => clock });
  const canvas = {
    listCourseFiles: vi.fn(async () => [{ id: 1, display_name: "poster.png", url: "u", "content-type": "image/png" }]),
    listPages: vi.fn(async () => [{ url: "lectures", title: "Lectures", updated_at: "t1" }]),
    getPageBody: vi.fn<(courseId: number, slug: string) => Promise<string>>(async () => `<p>Slides: <a href="/courses/7/files/55">L1</a> and <a href="/courses/7/files/66">L2</a></p>`),
    getFile: vi.fn(async (id: number) => {
      if (id === 66) throw new Error("Canvas 403");
      return { id, display_name: `L${id}.pdf`, url: "signed", "content-type": "application/pdf", size: 100 };
    }),
  };
  return { db, harvest, canvas, tick: (ms: number) => { clock += ms; } };
}

describe("harvestFiles", () => {
  it("records listed files and files linked from pages", async () => {
    const { db, harvest, canvas } = setup();
    await harvest(canvas, 7, 1, []);
    const rows = db.select().from(files).all();
    expect(rows.map((r) => [r.canvasFileId, r.hidden, r.linkedFrom])).toEqual([[1, false, null], [55, true, "Lectures"]]);
  });

  it("asks Canvas only for what changed on the next sync", async () => {
    const { harvest, canvas, tick } = setup();
    await harvest(canvas, 7, 1, []);
    expect(canvas.getPageBody).toHaveBeenCalledTimes(1);
    expect(canvas.getFile.mock.calls.map((c) => c[0])).toEqual([55, 66]);

    tick(60_000);
    await harvest(canvas, 7, 1, []);
    // The page did not change; L55 is on record; L66 failed a minute ago.
    expect(canvas.getPageBody).toHaveBeenCalledTimes(1);
    expect(canvas.getFile).toHaveBeenCalledTimes(2);
    expect(canvas.listPages).toHaveBeenCalledTimes(2);   // the listing is what says nothing changed
  });

  it("tries an unreadable link again after a few hours, and reads an edited page again", async () => {
    const { harvest, canvas, tick } = setup();
    await harvest(canvas, 7, 1, []);
    tick(7 * H);
    canvas.listPages.mockResolvedValue([{ url: "lectures", title: "Lectures", updated_at: "t2" }]);
    await harvest(canvas, 7, 1, []);
    expect(canvas.getPageBody).toHaveBeenCalledTimes(2);
    expect(canvas.getFile.mock.calls.map((c) => c[0])).toEqual([55, 66, 66]);
  });

  it("keeps a known file's link context up to date without looking it up", async () => {
    const { db, harvest, canvas } = setup();
    await harvest(canvas, 7, 1, []);
    await harvest(canvas, 7, 1, [{ label: "Week 2 announcement", html: `<a href="/courses/7/files/55">again</a>` }]);
    expect(canvas.getFile).toHaveBeenCalledTimes(2);
    const l1 = db.select().from(files).all().find((r) => r.canvasFileId === 55)!;
    expect(l1.linkedFrom).toBe("Week 2 announcement");
    expect(l1.displayName).toBe("L55.pdf");
  });

  it("carries on when pages are switched off for the course", async () => {
    const { db, harvest, canvas } = setup();
    canvas.listPages.mockRejectedValue(new Error("Canvas 404"));
    await harvest(canvas, 7, 1, []);
    expect(db.select().from(files).all()).toHaveLength(1);
  });

  it("keeps the pages it reads, including those only the Modules tab leads to, and drops removed ones", async () => {
    const { db, harvest, canvas } = setup();
    canvas.listPages.mockRejectedValue(new Error("Canvas 404"));   // Pages tab off
    canvas.getPageBody.mockImplementation(async (_c, slug) => (slug === "week-1" ? "<p>Read chapter 1.</p>" : "<p>See <a href=\"/files/55\">L1</a></p>"));
    const outline: CourseOutline = [{ name: "Week 1", unlockAt: null, items: [
      { kind: "page", title: "Week 1", indent: 0, pageUrl: "week-1" },
      { kind: "page", title: "Locked", indent: 0, pageUrl: "later", locked: true },
      { kind: "file", title: "Handout", indent: 1, canvasFileId: 77 },
    ] }];
    await harvest(canvas, 7, 1, [], outline);
    expect(db.select().from(canvasPages).all().map((p) => [p.pageUrl, p.title, p.userId])).toEqual([["week-1", "Week 1", 1]]);
    // A file listed in the Modules tab counts as linked, with its week.
    expect(db.select().from(files).all().find((f) => f.canvasFileId === 77)?.linkedFrom).toBe("Modules: Week 1");
    expect(canvas.getPageBody.mock.calls.map((c) => c[1])).toEqual(["week-1"]);

    await harvest(canvas, 7, 1, [], [{ name: "Week 1", unlockAt: null, items: [] }]);
    expect(db.select().from(canvasPages).all()).toEqual([]);
  });

  it("keeps the pages it has when Canvas can't list them", async () => {
    const { db, harvest, canvas } = setup();
    await harvest(canvas, 7, 1, []);
    expect(db.select().from(canvasPages).all()).toHaveLength(1);
    canvas.listPages.mockRejectedValue(new Error("Canvas 500"));
    await harvest(canvas, 7, 1, [], null);
    expect(db.select().from(canvasPages).all()).toHaveLength(1);
  });
});
