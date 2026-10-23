import { describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { files, modules, studyGuides, users } from "../db/schema";
import { canonical, editDistance, guideSections, plainMarkdown, search, snippet, termForms, terms } from "./search";

describe("search helpers", () => {
  it("splits a guide into sections", () => {
    const md = "# T\n\nintro\n\n## 1. Buffer overflows\n\nStack **smashing** [L3 p4](slide:L3#4)\n\n### Canaries\n\nA canary sits before the return address.\n\n```mermaid\n### not a heading\n```\n\n## 2. Heap\n\nmalloc";
    const s = guideSections(md);
    expect(s.map((x) => x.heading)).toEqual(["1. Buffer overflows", "Canaries", "2. Heap"]);
    expect(s[0]!.slug).toBe("1-buffer-overflows");
    expect(s[0]!.text).toBe("Stack smashing");
    expect(s[1]!.text).toBe("A canary sits before the return address.");
  });
  it("cleans markdown and terms", () => {
    expect(plainMarkdown("See ![fig](slide-img:L1#2) and [docs](https://x.y) **now**")).toBe("See and docs now");
    expect(terms("What's the CS4238 quiz?")).toEqual(["what", "the", "cs4238", "quiz"]);
  });
  it("cuts a snippet around the match", () => {
    const text = `${"lorem ipsum ".repeat(30)}the stack canary detects overwrites ${"dolor sit ".repeat(30)}`;
    const s = snippet(text, ["canary"]);
    expect(s).toContain("canary");
    expect(s.startsWith("…")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(163);
  });
});

describe("spelling", () => {
  it("puts British and American spellings in one form", () => {
    const pairs = [["amortised", "amortized"], ["organisation", "organization"], ["analyse", "analyze"], ["colours", "colors"], ["behaviour", "behavior"],
      ["centre", "center"], ["centred", "centered"], ["metres", "meters"], ["modelling", "modeling"], ["defence", "defense"], ["optimising", "optimizing"]];
    for (const [uk, us] of pairs) expect(canonical(uk!)).toBe(canonical(us!));
  });
  it("leaves short and unrelated words alone", () => {
    for (const w of ["four", "hour", "your", "rise", "more", "there", "price", "rice", "calling", "spelling"]) expect(canonical(w)).toBe(w);
  });
  it("measures typos, giving up past the limit", () => {
    expect(editDistance("amortized", "amortzied", 2)).toBe(2);
    expect(editDistance("theorem", "theorm", 1)).toBe(1);
    expect(editDistance("master", "theorem", 1)).toBe(2);
  });
  it("finds the other spelling always, and a typo only when the word is nowhere", () => {
    const vocab = ["amortised", "analysis", "master", "masters", "theorem", "matter", "colors"];
    expect(termForms("amortized", vocab)).toEqual({ term: "amortized", forms: ["amortised"], fuzzy: false });
    expect(termForms("colour", vocab).forms).toEqual(["colors"]);
    // Spelled right and present: no guessing at "matter".
    expect(termForms("master", vocab)).toEqual({ term: "master", forms: [], fuzzy: false });
    expect(termForms("theorm", vocab)).toEqual({ term: "theorm", forms: ["theorem"], fuzzy: true });
    expect(termForms("amortzied", vocab).forms).toEqual(["amortised"]);
    // Short words are too easy to mistake for others.
    expect(termForms("mstr", vocab).forms).toEqual([]);
  });
  it("only stands for the same word, not a longer one that starts the same", () => {
    const vocab = ["laboratory", "labors", "labored", "score", "scored", "floral", "florida", "coloured", "colorful"];
    expect(termForms("labour", vocab).forms).toEqual(["labors", "labored"]);
    expect(termForms("scour", vocab).forms).toEqual([]);
    expect(termForms("flour", vocab).forms).toEqual([]);
    expect(termForms("color", vocab).forms).toEqual(["coloured"]);
    for (const w of ["flour", "scour", "detour", "contours", "devoured"]) expect(canonical(w)).toBe(w);
  });
  it("leaves very long tokens alone, and quickly", () => {
    const long = "abcdefghij".repeat(4000) + "ise";
    const t = performance.now();
    expect(canonical(long)).toBe(long);
    expect(termForms("amortzied", [long, "amortised"]).forms).toEqual(["amortised"]);
    expect(performance.now() - t).toBeLessThan(50);
  });
});

describe("search", () => {
  const now = Date.parse("2026-10-01T10:00:00+08:00");
  function setup() {
    const db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    const mod = db.insert(modules).values({ userId: 1, canvasCourseId: 7, code: "CS3230", name: "Design and Analysis of Algorithms" }).returning().get();
    db.insert(studyGuides).values({ moduleId: mod.id, markdown: "# G\n\n## 1. Amortised analysis\n\nThe amortised cost of a push is O(1).\n\n## 2. Recurrences\n\nThe master theorem solves T(n) = aT(n/b) + f(n).", generatedAt: now }).run();
    db.insert(files).values([
      { moduleId: mod.id, canvasFileId: 1, displayName: "L4-master.pdf", discoveredAt: now },
      { moduleId: mod.id, canvasFileId: 2, displayName: "Week 4 notes.pdf", discoveredAt: now },
    ]).run();
    return db;
  }
  it("matches the other spelling and a typo", () => {
    const db = setup();
    expect(search(db, 1, "amortized", now).map((h) => h.title)).toContain("Amortised analysis");
    expect(search(db, 1, "amortised", now).map((h) => h.title)).toContain("Amortised analysis");
    expect(search(db, 1, "recurrance", now).map((h) => h.title)).toContain("Recurrences");
  });
  it("finds a file by its name when the rest of the query is about its content", () => {
    const db = setup();
    const hits = search(db, 1, "master theorem", now);
    expect(hits.map((h) => h.title)).toEqual(["Recurrences", "L4-master.pdf"]);
    // A shared digit or a word every file has is not enough.
    expect(search(db, 1, "4 heaps", now)).toEqual([]);
    expect(search(db, 1, "notes heaps", now)).toEqual([]);
  });
});
