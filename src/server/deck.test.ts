import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@/db/client";
import { files, modules, users } from "@/db/schema";
import { deckCachePath, deckStem, loadDeckPdf, renderCachedSlide, resolveDeck, safeDeckName, slidePngPath } from "./deck";

describe("deckStem", () => {
  it("strips the extension", () => {
    expect(deckStem("U2-background.pptx")).toBe("U2-background");
    expect(deckStem("U2-background.pdf")).toBe("U2-background");
  });
  it("leaves a bare name alone", () => {
    expect(deckStem("U2-background")).toBe("U2-background");
  });
  it("only strips the last extension", () => {
    expect(deckStem("cs4239.week1.pptx")).toBe("cs4239.week1");
  });
});

describe("deckCachePath", () => {
  // The cache has to live beside the database, because on Fly that is the
  // mounted volume (/data) and the app's own cwd (/app) is ephemeral — it is
  // wiped on every deploy and is not where the volume is mounted.
  it("resolves beside the database, not the working directory", () => {
    expect(deckCachePath(12345, "U2-background.pptx", "/data/openpapr.db"))
      .toBe("/data/deck-cache/12345/U2-background.pdf");
  });

  it("keeps the repo-relative layout for local development", () => {
    expect(deckCachePath(12345, "U2-background.pptx", "data/openpapr.db"))
      .toBe("data/deck-cache/12345/U2-background.pdf");
  });

  it("always lands on a .pdf regardless of the source extension", () => {
    expect(deckCachePath(1, "deck.ppt", "/data/x.db")).toBe("/data/deck-cache/1/deck.pdf");
    expect(deckCachePath(1, "deck.pdf", "/data/x.db")).toBe("/data/deck-cache/1/deck.pdf");
  });

  it("defaults to DATABASE_PATH when no path is given", () => {
    const prev = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = "/mnt/vol/app.db";
    try {
      expect(deckCachePath(7, "a.pptx")).toBe("/mnt/vol/deck-cache/7/a.pdf");
    } finally {
      if (prev === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = prev;
    }
  });
});

describe("deck names from a request", () => {
  // A deck name comes in a query string and is joined into a path on the
  // volume, where every course's cache lives side by side.
  it("refuses anything that could be a path", () => {
    for (const bad of ["../222/Lecture 1", "..", "a/b", "a\\b", "x\0y", "/etc/passwd", "", "Lecture..1"]) {
      expect(safeDeckName(bad)).toBe(false);
    }
    expect(safeDeckName("Lecture 1 (Intro).pdf")).toBe(true);
  });

  it("never builds a cache path outside the course's folder", () => {
    expect(() => deckCachePath(111, "../222/Lecture 1.pdf", "/data/x.db")).toThrow();
    expect(() => deckCachePath(111, "sub/deck.pdf", "/data/x.db")).toThrow();
    expect(() => slidePngPath(111, "../222/Lecture 1.pdf", 1, 2, "/data/x.db")).toThrow();
  });
});

describe("resolveDeck / loadDeckPdf / renderCachedSlide", () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "deck-test-"));
    const prev = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(dir, "x.db");
    const db = createDb(":memory:");
    db.insert(users).values([{ name: "a" }, { name: "b" }]).run();
    // Student 1 takes course 111; student 2 takes 111 and 222.
    db.insert(modules).values([
      { userId: 1, canvasCourseId: 111, code: "CS1", name: "x", active: true },
      { userId: 2, canvasCourseId: 111, code: "CS1", name: "x", active: true },
      { userId: 2, canvasCourseId: 222, code: "CS2", name: "y", active: true },
    ]).run();
    db.insert(files).values([
      { moduleId: 1, canvasFileId: 1, displayName: "Lecture 1.pdf", discoveredAt: 0 },
      { moduleId: 2, canvasFileId: 2, displayName: "Lecture 1.pdf", discoveredAt: 0 },
      // Listed only for student 2 (say, their section's deck).
      { moduleId: 2, canvasFileId: 3, displayName: "Section B.pdf", discoveredAt: 0 },
      { moduleId: 3, canvasFileId: 4, displayName: "Lecture 1.pdf", discoveredAt: 0 },
    ]).run();
    const put = (course: number, file: string, body: string) => {
      mkdirSync(join(dir, "deck-cache", String(course)), { recursive: true });
      writeFileSync(join(dir, "deck-cache", String(course), file), body);
    };
    put(111, "Lecture 1.pdf", "mine");
    put(111, "Section B.pdf", "theirs");
    put(222, "Lecture 1.pdf", "other course");
    const restore = () => {
      if (prev === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = prev;
    };
    return { db, dir, restore };
  };

  it("serves the caller's own deck from the cache by its stored name", async () => {
    const { db, dir, restore } = setup();
    try {
      const res = await loadDeckPdf(db, 1, 1, "lecture 1");
      if ("error" in res) throw new Error(res.error);
      expect(Buffer.from(res.bytes).toString()).toBe("mine");
      expect(res.deck.path).toBe(join(dir, "deck-cache", "111", "Lecture 1.pdf"));
    } finally { restore(); }
  });

  it("refuses a name that climbs into another course's cache", async () => {
    const { db, restore } = setup();
    try {
      for (const name of ["../222/Lecture 1", "../222/Lecture 1.pdf", "..\\222\\Lecture 1"]) {
        expect(await loadDeckPdf(db, 1, 1, name)).toEqual({ error: "bad deck name", status: 400 });
      }
    } finally { restore(); }
  });

  it("does not serve a deck a classmate cached that the caller's module does not list", async () => {
    const { db, restore } = setup();
    try {
      expect(await loadDeckPdf(db, 1, 1, "Section B")).toEqual({ error: "deck not found", status: 404 });
      expect(resolveDeck(db, 2, 2, "Section B")).toMatchObject({ file: { canvasFileId: 3 } });
    } finally { restore(); }
  });

  it("checks the module is the caller's", async () => {
    const { db, restore } = setup();
    try {
      expect(await loadDeckPdf(db, 1, 3, "Lecture 1")).toEqual({ error: "not found", status: 404 });
    } finally { restore(); }
  });

  it("writes no slide image for a traversal attempt", async () => {
    const { db, dir, restore } = setup();
    try {
      expect(await renderCachedSlide(db, 1, 1, "../222/Lecture 1", 1, 2)).toEqual({ error: "bad deck name", status: 400 });
      expect(existsSync(join(dir, "deck-cache", "222", "Lecture 1-pages"))).toBe(false);
    } finally { restore(); }
  });

  it("prefers the PDF when a PowerPoint shares its name", () => {
    const { db, restore } = setup();
    try {
      db.insert(files).values({ moduleId: 1, canvasFileId: 9, displayName: "Lecture 1.pptx", discoveredAt: 5 }).run();
      expect(resolveDeck(db, 1, 1, "Lecture 1")).toMatchObject({ file: { canvasFileId: 1 } });
    } finally { restore(); }
  });
});
