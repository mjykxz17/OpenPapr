import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { files, guideTopics, items, modules, studyGuides, users } from "../db/schema";
import { guideStatus, nextTopics, requestGuideRefresh, runAutoGuides, type GuideDeps } from "./guides";
import { MAX_TRIES, partialHash, writeFailure } from "../server/guide-status";

const NOW = Date.UTC(2026, 9, 1, 2);
const D = 86_400_000;
const cfg = { baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };

// Slide text with page markers, distinct per deck so copies can be told apart.
function deck(seed: string, pages: number, extra = ""): string {
  let x = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const w = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return `w${x % 5000}`; };
  return Array.from({ length: pages }, (_, i) => `-- ${i + 1} of ${pages} --\n${Array.from({ length: 20 }, w).join(" ")}${i === pages - 1 ? ` ${extra}` : ""}`).join("\n");
}

// A fake model: answers the planner, the outliner and the section writer.
function fakeModel(calls: string[]) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const system = String(body.messages[0].content);
    const user = String(body.messages[1].content);
    let content: string;
    if (system.includes("organise a university module")) {
      calls.push("plan");
      const has = (name: string) => user.match(new RegExp(`(L\\d+): ${name}`))?.[1];
      content = JSON.stringify({
        title: "Software Security: memory bugs and control flow",
        topics: [
          { key: "memory-errors", title: "Memory errors", lectures: [has("U3-memerr1.pdf")], practice: ["P1"], assessments: ["A1"] },
          { key: "cfg", title: "Control-flow graphs", lectures: [has("U4-CFG.pdf")] },
        ],
      });
    } else if (system.includes("planning one chapter")) {
      calls.push("outline");
      content = JSON.stringify({ title: "x", sections: [{ heading: "Overflows", covers: "a", slides: "1-3" }, { heading: "Fixes", covers: "b", slides: "4-6" }] });
    } else {
      calls.push("section");
      const heading = user.match(/### (.+)/)?.[1] ?? "?";
      const deckName = system.match(/slide:([^#\s]+)#N/)?.[1] ?? "deck";
      content = `### ${heading}\n\nText for ${heading} [slide 1](slide:${deckName}#1).`;
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  });
}

function setup() {
  const db = createDb(":memory:");
  db.insert(users).values({ name: "A", canvasTokenEnc: "x" }).run();
  db.insert(modules).values({ userId: 1, canvasCourseId: 9, code: "CS4239", name: "CS4239/CS5439 Software Security [2610]", active: true }).run();
  const f = (id: number, name: string, category: "slides" | "tutorial", at: number) => ({ id, moduleId: 1, canvasFileId: 100 + id, displayName: name, category, discoveredAt: at });
  db.insert(files).values([
    f(1, "U3-memerr1-to-S39.pdf", "slides", NOW - 20 * D),
    f(2, "U3-memerr1.pdf", "slides", NOW - 15 * D),
    f(3, "U4-CFG.pdf", "slides", NOW - 3 * D),
    f(4, "lab1-update.pdf", "tutorial", NOW - 10 * D),
  ]).run();
  db.insert(items).values({ userId: 1, moduleId: 1, source: "canvas", type: "assignment", sourceId: "q3", title: "Quiz 3", dueAt: NOW + 4 * D, firstSeenAt: NOW }).run();
  return db;
}

const texts: Record<string, string> = {
  "U3-memerr1-to-S39.pdf": deck("memerr", 39),
  "U3-memerr1.pdf": deck("memerr", 60),
  "U4-CFG.pdf": deck("cfg", 30),
  "lab1-update.pdf": deck("lab1", 3),
};

function deps(db: ReturnType<typeof createDb>, now = NOW): GuideDeps {
  return { db, now: () => now, cfgFor: () => cfg, readerFor: () => null, fileText: async (_u, f) => texts[f.displayName] ?? null };
}

afterEach(() => vi.unstubAllGlobals());

describe("automatic study guide", () => {
  it("picks the full copy, plans topics, writes them soonest-assessed first, and keeps up with new slides", async () => {
    const db = setup();
    const calls: string[] = [];
    vi.stubGlobal("fetch", fakeModel(calls));

    await runAutoGuides(deps(db));            // reads three files; a fourth is still unread, so no plan yet
    expect(calls).toEqual([]);
    await runAutoGuides(deps(db));            // reads the last, plans, writes both topics side by side
    expect(calls[0]).toBe("plan");
    let topics = db.select().from(guideTopics).all().sort((a, b) => a.ord - b.ord);
    expect(topics.map((t) => t.title)).toEqual(["Memory errors", "Control-flow graphs"]);
    expect(JSON.parse(topics[0].lectureIdsJson)).toEqual([2]);              // the full deck, not "-to-S39"
    expect(JSON.parse(topics[0].practiceIdsJson)).toEqual([4]);
    expect(topics[0].body).toContain("Practice: lab1-update");

    const guide = db.select().from(studyGuides).get()!;
    expect(guide.markdown).toMatch(/^# Software Security: memory bugs and control flow/);
    expect(guide.markdown).toContain("**Counts toward:** Quiz 3");
    expect(guide.markdown).toContain("## 1. Memory errors");
    expect(guide.markdown).toContain("### 1.1 Overflows");
    expect(guide.markdown).toContain("## 2. Control-flow graphs");
    expect(guide.markdown).toContain("### 2.1 Overflows");
    // Link text is written from where the link points.
    expect(guide.markdown).toContain("[U4 p1](slide:U4-CFG#1)");
    expect(guideStatus(db, 1)).toMatchObject({ total: 2, ready: 2, queued: 0, writing: null, incomplete: 0 });

    // Nothing changed: no model calls at all.
    calls.length = 0;
    await runAutoGuides(deps(db, NOW + 60_000));
    expect(calls).toEqual([]);

    // The lecturer re-uploads U4-CFG with a corrected slide.
    texts["U4-CFG.pdf#2"] = deck("cfg", 30, "corrected dominator example");
    db.insert(files).values({ id: 5, moduleId: 1, canvasFileId: 105, displayName: "U4-CFG.pdf", category: "slides", discoveredAt: NOW + D }).run();
    const d = deps(db, NOW + D);
    d.fileText = async (_u, f) => (f.id === 5 || f.displayName === "U4-CFG.pdf" ? texts["U4-CFG.pdf#2"] : texts[f.displayName]) ?? null;
    await runAutoGuides(d);
    topics = db.select().from(guideTopics).all().sort((a, b) => a.ord - b.ord);
    expect(JSON.parse(topics[1].lectureIdsJson)).toEqual([5]);
    expect(topics[1].builtHash).toBe(topics[1].inputHash);                // rewritten from the new copy
    expect(topics[0].builtAt).toBe(NOW);                                    // the other chapter untouched
  });

  it("starts from a hand-made guide's chapters instead of rewriting them", async () => {
    const db = setup();
    db.insert(studyGuides).values({ moduleId: 1, generatedAt: NOW - 30 * D, sourceNote: "8 decks",
      markdown: "# Old\n\nintro\n\n## 1. Old memory chapter\n\n### 1.1 Old\n\nOld text [slide 3](slide:U3-memerr1#3).\n\n## 2. Old CFG\n\n### 2.1 CFG\n\nText [slide 2](slide:U4-CFG#2)." }).run();
    const calls: string[] = [];
    vi.stubGlobal("fetch", fakeModel(calls));
    await runAutoGuides(deps(db));
    await runAutoGuides(deps(db));
    expect(calls).toEqual(["plan"]);                                        // both chapters adopted, nothing written
    const guide = db.select().from(studyGuides).get()!;
    expect(guide.markdown).toContain("Old text [slide 3](slide:U3-memerr1#3)");
    expect(guide.markdown).toContain("## 2. Control-flow graphs");

    // "Rewrite everything" from the guide page.
    requestGuideRefresh(db, 1, true);
    await runAutoGuides(deps(db, NOW + 60_000));
    expect(calls.filter((c) => c === "plan")).toHaveLength(2);
    expect(db.select().from(guideTopics).where(eq(guideTopics.key, "memory-errors")).get()!.body).toContain("### 1.1 Overflows");
  });
});

// The same model, with switches: sections called "Fixes" fail while broken;
// swapped, the planner trades the two keys and moves the lab sheet.
function switchModel(calls: string[], opts: { broken?: boolean; swapped?: boolean }) {
  const base = fakeModel(calls);
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const system = String(body.messages[0].content);
    const user = String(body.messages[1].content);
    if (opts.broken && !system.includes("organise") && !system.includes("planning") && user.includes("Fixes")) {
      calls.push("section-failed");
      return new Response("overloaded", { status: 500 });
    }
    if (opts.swapped && system.includes("organise a university module")) {
      calls.push("plan");
      const has = (name: string) => user.match(new RegExp(`(L\\d+): ${name}`))?.[1];
      const note = user.match(/(N\d+):/)?.[1];
      return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "Software Security", topics: [
        { key: "cfg", title: "Memory errors", lectures: [has("U3-memerr1.pdf")], assessments: ["A1"], notes: note ? [note] : [] },
        { key: "memory-errors", title: "Control-flow graphs", lectures: [has("U4-CFG.pdf")], practice: ["P1"] },
      ] }) } }] });
    }
    return base(url, init);
  });
}

// withRetry waits a few seconds between tries; the clock is moved on instead.
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.finally(() => { done = true; }).catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(1000);
  return p;
}

const M = 60_000;
const byOrd = (db: ReturnType<typeof createDb>) => db.select().from(guideTopics).all().sort((a, b) => a.ord - b.ord);

describe("automatic study guide, when things go wrong", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a chapter with a missing section, retries it later, and finishes it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const db = setup();
    const calls: string[] = [];
    const opts = { broken: true };
    vi.stubGlobal("fetch", switchModel(calls, opts));
    await settle(runAutoGuides(deps(db)));
    await settle(runAutoGuides(deps(db)));

    let [mem] = byOrd(db);
    expect(mem.body).toContain("### 1.1 Overflows");                      // what was written shows
    expect(mem.builtHash).toBe(partialHash(mem.inputHash, 1));             // but it is not finished
    expect(db.select().from(studyGuides).get()!.markdown).toContain("One section of this chapter couldn't be written yet. It is being retried");
    expect(guideStatus(db, 1)).toMatchObject({ ready: 2, queued: 0, incomplete: 2 });

    // Too soon to try again.
    calls.length = 0;
    await settle(runAutoGuides(deps(db, NOW + 10 * M)));
    expect(calls).toEqual([]);

    // Half an hour on, the model is back and both chapters are finished.
    opts.broken = false;
    await settle(runAutoGuides(deps(db, NOW + 31 * M)));
    [mem] = byOrd(db);
    expect(mem.builtHash).toBe(mem.inputHash);
    expect(mem.body).toContain("### 1.2 Fixes");
    expect(guideStatus(db, 1)).toMatchObject({ ready: 2, incomplete: 0, failed: [], stuck: [] });
  });

  it("gives up on a chapter after a few tries, until asked again", async () => {
    const db = setup();
    vi.stubGlobal("fetch", switchModel([], {}));
    await runAutoGuides(deps(db));
    await runAutoGuides(deps(db));
    const [mem] = byOrd(db);
    db.update(guideTopics).set({ builtHash: null, error: writeFailure(MAX_TRIES, "llm 500"), errorAt: NOW }).where(eq(guideTopics.id, mem.id)).run();
    expect(nextTopics(db, NOW + 1000 * 3_600_000, () => true, 5)).toEqual([]);
    expect(guideStatus(db, 1).stuck).toEqual([{ title: "Memory errors", error: "llm 500" }]);
    requestGuideRefresh(db, 1, false);
    expect(nextTopics(db, NOW, () => true, 5).map((n) => n.topic.title)).toEqual(["Memory errors"]);
  });

  it("only moves the links when just an announcement changed, however the planner regroups", async () => {
    const db = setup();
    const calls: string[] = [];
    const opts = { swapped: false };
    vi.stubGlobal("fetch", switchModel(calls, opts));
    await runAutoGuides(deps(db));
    await runAutoGuides(deps(db));
    const before = byOrd(db);

    db.insert(items).values({ userId: 1, moduleId: 1, source: "canvas", type: "announcement", sourceId: "n1", title: "Quiz 3 covers memory errors only", body: "x", firstSeenAt: NOW + 7 * 3_600_000, sourceCreatedAt: NOW + 7 * 3_600_000 }).run();
    opts.swapped = true;
    calls.length = 0;
    await runAutoGuides(deps(db, NOW + 7 * 3_600_000));
    expect(calls).toEqual(["plan"]);                                        // planned again, nothing rewritten
    const after = byOrd(db);
    expect(after.map((t) => [t.key, t.title, t.lectureIdsJson, t.practiceIdsJson, t.builtHash])).toEqual(before.map((t) => [t.key, t.title, t.lectureIdsJson, t.practiceIdsJson, t.builtHash]));
    expect(JSON.parse(after[0].noteIdsJson)).toHaveLength(1);              // the note is linked
  });

  it("rewrites only the chapter whose slides changed, even when the planner trades keys", async () => {
    const db = setup();
    const calls: string[] = [];
    const opts = { swapped: false };
    vi.stubGlobal("fetch", switchModel(calls, opts));
    await runAutoGuides(deps(db));
    await runAutoGuides(deps(db));

    db.insert(files).values({ id: 5, moduleId: 1, canvasFileId: 105, displayName: "U4-CFG.pdf", category: "slides", discoveredAt: NOW + D }).run();
    const d = deps(db, NOW + D);
    const fixed = deck("cfg", 30, "corrected dominator example");
    d.fileText = async (_u, f) => (f.id === 5 ? fixed : texts[f.displayName]) ?? null;
    opts.swapped = true;
    await runAutoGuides(d);
    const [mem, cfgTopic] = byOrd(db);
    expect(JSON.parse(mem.lectureIdsJson)).toEqual([2]);
    expect(mem.builtAt).toBe(NOW);                                          // the memory chapter is untouched
    expect(JSON.parse(mem.practiceIdsJson)).toEqual([4]);                  // and keeps its lab sheet
    expect(JSON.parse(cfgTopic.lectureIdsJson)).toEqual([5]);
    expect(cfgTopic.builtAt).toBe(NOW + D);                                 // the one with new slides is rewritten
  });

  it("says a scanned deck has no text, and does not read it again every day", async () => {
    const db = setup();
    db.insert(files).values({ id: 6, moduleId: 1, canvasFileId: 106, displayName: "U5-scan.pdf", category: "slides", discoveredAt: NOW - 30 * D, sizeBytes: 1000 }).run();
    vi.stubGlobal("fetch", switchModel([], {}));
    const reads: string[] = [];
    const run = async (now: number, extra: Partial<GuideDeps> = {}) => {
      const d = { ...deps(db, now), ...extra };
      d.fileText = async (_u, f) => { reads.push(f.displayName); return f.id === 6 ? "\n\n-- 1 of 40 --\n" : texts[f.displayName] ?? null; };
      await runAutoGuides(d);
    };
    await run(NOW);
    await run(NOW);
    expect(reads.filter((n) => n === "U5-scan.pdf")).toHaveLength(1);
    expect(guideStatus(db, 1).scanned).toEqual(["U5-scan"]);
    expect(db.select().from(studyGuides).get()!.markdown).toContain("Not in this guide: U5-scan — this deck is scanned images, with no text to read.");

    await run(NOW + 3 * D);
    expect(reads.filter((n) => n === "U5-scan.pdf")).toHaveLength(1);       // not on a timer

    await run(NOW + 3 * D, { ocrReady: () => true });
    expect(reads.filter((n) => n === "U5-scan.pdf")).toHaveLength(2);       // once more, now OCR is here
    await run(NOW + 4 * D, { ocrReady: () => true });
    expect(reads.filter((n) => n === "U5-scan.pdf")).toHaveLength(2);

    db.update(files).set({ sizeBytes: 2000 }).where(eq(files.id, 6)).run();  // a new copy on Canvas
    await run(NOW + 5 * D, { ocrReady: () => true });
    expect(reads.filter((n) => n === "U5-scan.pdf")).toHaveLength(3);
  });
});

describe("nextTopics", () => {
  // Two students: A has three chapters waiting and was written for a minute
  // ago; B has one and has waited longest.
  function twoStudents() {
    const db = createDb(":memory:");
    db.insert(users).values([{ name: "A" }, { name: "B" }]).run();
    db.insert(modules).values([
      { userId: 1, canvasCourseId: 1, code: "A1", name: "A1", active: true },
      { userId: 2, canvasCourseId: 2, code: "B1", name: "B1", active: true },
    ]).run();
    const t = (moduleId: number, key: string, ord: number, extra: Partial<typeof guideTopics.$inferInsert> = {}) =>
      ({ moduleId, key, title: key, ord, inputHash: "h", ...extra });
    db.insert(guideTopics).values([
      t(1, "a-done", 0, { body: "b", builtHash: "h", builtAt: NOW - M }),
      t(1, "a1", 1), t(1, "a2", 2), t(1, "a3", 3),
      t(2, "b1", 0),
    ]).run();
    return db;
  }

  it("takes turns between students, longest waiting first", () => {
    const db = twoStudents();
    expect(nextTopics(db, NOW, () => true, 2).map((n) => n.topic.key)).toEqual(["b1", "a1"]);
    expect(nextTopics(db, NOW, () => true, 3).map((n) => n.topic.key)).toEqual(["b1", "a1", "a2"]);
  });

  it("fills spare places from the same student when nobody else is waiting", () => {
    const db = twoStudents();
    expect(nextTopics(db, NOW, (u) => u === 1, 2).map((n) => n.topic.key)).toEqual(["a1", "a2"]);
  });
});
