import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../db/client";
import { canvasPageCache } from "../../db/schema";
import { cachedPageBody } from "./page-cache";

const H = 3_600_000;
const fakeCanvas = (body: () => string) => ({ getPageBody: vi.fn(async () => body()) });

describe("cachedPageBody", () => {
  it("fetches a page once and reuses it until its updated_at moves", async () => {
    const db = createDb(":memory:");
    let text = "v1";
    const canvas = fakeCanvas(() => text);
    const page = { url: "week-1", title: "Week 1", updated_at: "2026-08-01T00:00:00Z" };
    expect(await cachedPageBody(db, canvas, 7, page, 0)).toBe("v1");
    text = "v2";
    expect(await cachedPageBody(db, canvas, 7, page, 10 * H)).toBe("v1");
    expect(canvas.getPageBody).toHaveBeenCalledTimes(1);

    const edited = { ...page, updated_at: "2026-08-02T00:00:00Z" };
    expect(await cachedPageBody(db, canvas, 7, edited, 11 * H)).toBe("v2");
    expect(canvas.getPageBody).toHaveBeenCalledTimes(2);
    expect(db.select().from(canvasPageCache).all()).toHaveLength(1);   // updated in place
  });

  it("keeps courses apart", async () => {
    const db = createDb(":memory:");
    const canvas = fakeCanvas(() => "x");
    const page = { url: "home", title: "Home", updated_at: "t" };
    await cachedPageBody(db, canvas, 7, page, 0);
    await cachedPageBody(db, canvas, 8, page, 0);
    expect(canvas.getPageBody).toHaveBeenCalledTimes(2);
  });

  it("re-reads a page with no updated_at once a day", async () => {
    const db = createDb(":memory:");
    const canvas = fakeCanvas(() => "x");
    const page = { url: "home", title: "Home" };
    await cachedPageBody(db, canvas, 7, page, 0);
    await cachedPageBody(db, canvas, 7, page, 23 * H);
    expect(canvas.getPageBody).toHaveBeenCalledTimes(1);
    await cachedPageBody(db, canvas, 7, page, 25 * H);
    expect(canvas.getPageBody).toHaveBeenCalledTimes(2);
  });

  it("keeps no empty body, so a page that unlocks later is read then", async () => {
    const db = createDb(":memory:");
    let text = "";   // locked for the student: Canvas sends no body
    const canvas = fakeCanvas(() => text);
    const page = { url: "week-5", title: "Week 5", updated_at: "t" };
    expect(await cachedPageBody(db, canvas, 7, page, 0)).toBe("");
    expect(db.select().from(canvasPageCache).all()).toHaveLength(0);
    text = "<a href='/files/9'>L5</a>";   // the unlock date passes; updated_at does not move
    expect(await cachedPageBody(db, canvas, 7, page, H)).toBe(text);
    expect(canvas.getPageBody).toHaveBeenCalledTimes(2);
  });

  it("never serves a body to a student the page is still locked for", async () => {
    const db = createDb(":memory:");
    const canvas = fakeCanvas(() => "secret links");
    const page = { url: "week-9", title: "Week 9", updated_at: "t" };
    await cachedPageBody(db, canvas, 7, { ...page, locked_for_user: false }, 0);   // a classmate it is open to
    expect(await cachedPageBody(db, canvas, 7, { ...page, locked_for_user: true }, 0)).toBe("");
    expect(canvas.getPageBody).toHaveBeenCalledTimes(1);   // and nothing asked of Canvas either
  });

  it("caches nothing when the fetch fails", async () => {
    const db = createDb(":memory:");
    const canvas = { getPageBody: vi.fn(async () => { throw new Error("Canvas 404"); }) };
    await expect(cachedPageBody(db, canvas, 7, { url: "gone", title: "Gone", updated_at: "t" }, 0)).rejects.toThrow("404");
    expect(db.select().from(canvasPageCache).all()).toHaveLength(0);
  });
});
