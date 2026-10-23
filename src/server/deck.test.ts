import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@/db/client";
import { files, modules, users } from "@/db/schema";
import { deckCachePath, deckStem, loadDeckPdf, renderCachedSlide, resolveDeck, safeDeckName, slidePngPath } from "./deck";

// Canvas, as seen by a student with a token: every upload's bytes say which
// upload they are.
vi.mock("@/lib/env", () => ({ loadEnv: () => ({ CANVAS_BASE_URL: "https://canvas.test", SECRET_KEY: "k" }) }));
vi.mock("@/lib/crypto", () => ({ decrypt: () => "token" }));
vi.mock("@/connectors/canvas/client", () => ({
  isPdfFile: () => true,
  createCanvasClient: () => ({
    getFile: async (id: number) => ({ url: `upload-${id}` }),
    downloadFile: async (url: string) => new Uint8Array(Buffer.from(`canvas ${url}`)),
    listCourseFiles: async () => [],
  }),
}));
vi.mock("./pdf-optimize", () => ({ markerPath: (p: string) => `${p}.opt`, optimizePdf: async () => ({ replaced: false }) }));

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
    for (const bad of ["../222/Lecture 1", "a/b", "a\\b", "x\0y", "/etc/passwd", ""]) {
      expect(safeDeckName(bad)).toBe(false);
    }
    expect(safeDeckName("Lecture 1 (Intro).pdf")).toBe(true);
  });

  // The name is only matched against the module's own files, so dots in a
  // real deck's title are not a reason to refuse it.
  it("takes a title with dots in it", () => {
    for (const ok of ["Week 5 - Recap...pdf", "Lecture 1..2", "cs4239.week1.pptx"]) expect(safeDeckName(ok)).toBe(true);
  });

  it("never builds a cache path outside the course's folder", () => {
    // A Canvas file whose own name has a slash in it stays one file in the
    // folder, so the file viewer and the worker can still cache it.
    expect(deckCachePath(111, "../222/Lecture 1.pdf", "/data/x.db")).toBe("/data/deck-cache/111/.._222_Lecture 1.pdf");
    expect(deckCachePath(111, "sub\\deck.pdf", "/data/x.db")).toBe("/data/deck-cache/111/sub_deck.pdf");
    expect(deckCachePath(111, "...pdf", "/data/x.db")).toBe("/data/deck-cache/111/...pdf");
  });

  it("names a slide image by the upload it was drawn from", () => {
    const deck = { path: "/data/deck-cache/111/L1.pdf", file: { canvasFileId: 42 } } as Parameters<typeof slidePngPath>[0];
    expect(slidePngPath(deck, 3, 2)).toBe("/data/deck-cache/111/L1-pages/3@2-42.png");
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
    const put = (course: number, file: string, body: string, src: number) => {
      mkdirSync(join(dir, "deck-cache", String(course)), { recursive: true });
      writeFileSync(join(dir, "deck-cache", String(course), file), body);
      writeFileSync(join(dir, "deck-cache", String(course), `${file}.src`), String(src));
    };
    put(111, "Lecture 1.pdf", "mine", 1);
    put(111, "Section B.pdf", "theirs", 3);
    put(222, "Lecture 1.pdf", "other course", 4);
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

  // Student 2's "Lecture 1.pdf" in course 111 is another upload (id 2) than
  // the copy student 1 cached (id 1): a section's own deck, say.
  it("does not serve a classmate's same-named copy of a different upload", async () => {
    const { db, dir, restore } = setup();
    try {
      db.update(users).set({ canvasTokenEnc: "enc" }).run();
      const res = await loadDeckPdf(db, 2, 2, "Lecture 1");
      if ("error" in res) throw new Error(res.error);
      expect(Buffer.from(res.bytes).toString()).toBe("canvas upload-2");
      expect(res.onDisk).toBe(true);
      expect(readFileSync(join(dir, "deck-cache", "111", "Lecture 1.pdf.src"), "utf8")).toBe("2");
      // And back again for student 1: their own upload, not student 2's.
      const mine = await loadDeckPdf(db, 1, 1, "Lecture 1");
      if ("error" in mine) throw new Error(mine.error);
      expect(Buffer.from(mine.bytes).toString()).toBe("canvas upload-1");
    } finally { restore(); }
  });

  it("without a token, a different upload's copy is refused rather than served", async () => {
    const { db, restore } = setup();
    try {
      expect(await loadDeckPdf(db, 2, 2, "Lecture 1")).toEqual({ error: "no canvas token", status: 502 });
    } finally { restore(); }
  });

  it("fetches again a copy cached before uploads were tracked", async () => {
    const { db, dir, restore } = setup();
    try {
      rmSync(join(dir, "deck-cache", "111", "Lecture 1.pdf.src"));
      db.update(users).set({ canvasTokenEnc: "enc" }).run();
      const res = await loadDeckPdf(db, 1, 1, "Lecture 1");
      if ("error" in res) throw new Error(res.error);
      expect(Buffer.from(res.bytes).toString()).toBe("canvas upload-1");
    } finally { restore(); }
  });

  it("serves a slide image only to the upload it was drawn from", async () => {
    const { db, restore } = setup();
    try {
      const mine = resolveDeck(db, 1, 1, "Lecture 1");
      if ("error" in mine) throw new Error(mine.error);
      const png = slidePngPath(mine, 1, 2);
      mkdirSync(join(png, ".."), { recursive: true });
      writeFileSync(png, "slide of upload 1");
      expect(await renderCachedSlide(db, 1, 1, "Lecture 1", 1, 2)).toEqual({ png: new Uint8Array(Buffer.from("slide of upload 1")) });
      // Student 2's deck of the same name is drawn from their own upload (here
      // they have no token, so there is nothing to draw), never shown student 1's.
      expect(await renderCachedSlide(db, 2, 2, "Lecture 1", 1, 2)).toEqual({ error: "no canvas token", status: 502 });
    } finally { restore(); }
  });

  it("finds a deck whose title has dots in it", () => {
    const { db, restore } = setup();
    try {
      db.insert(files).values({ moduleId: 1, canvasFileId: 8, displayName: "Week 5 - Recap...pdf", discoveredAt: 0 }).run();
      expect(resolveDeck(db, 1, 1, "Week 5 - Recap..")).toMatchObject({ file: { canvasFileId: 8 } });
    } finally { restore(); }
  });
});
