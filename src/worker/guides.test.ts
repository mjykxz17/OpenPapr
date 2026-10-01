import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { files, guideTopics, items, modules, studyGuides, users } from "../db/schema";
import { guideStatus, requestGuideRefresh, runAutoGuides, type GuideDeps } from "./guides";

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
    await runAutoGuides(deps(db));            // reads the last, plans, writes the quiz topic
    expect(calls[0]).toBe("plan");
    let topics = db.select().from(guideTopics).all().sort((a, b) => a.ord - b.ord);
    expect(topics.map((t) => t.title)).toEqual(["Memory errors", "Control-flow graphs"]);
    expect(JSON.parse(topics[0].lectureIdsJson)).toEqual([2]);              // the full deck, not "-to-S39"
    expect(JSON.parse(topics[0].practiceIdsJson)).toEqual([4]);
    expect(topics[0].body).toContain("Practice: lab1-update");
    expect(topics[1].body).toBeNull();

    let guide = db.select().from(studyGuides).get()!;
    expect(guide.markdown).toMatch(/^# Software Security: memory bugs and control flow/);
    expect(guide.markdown).toContain("**Counts toward:** Quiz 3");
    expect(guide.markdown).toContain("## 1. Memory errors");
    expect(guide.markdown).toContain("### 1.1 Overflows");
    expect(guide.markdown).toContain("## 2. Control-flow graphs");
    expect(guide.markdown).toContain("is being written from U4-CFG");

    await runAutoGuides(deps(db));            // writes the second topic
    guide = db.select().from(studyGuides).get()!;
    expect(guide.markdown).toContain("### 2.1 Overflows");
    expect(guideStatus(db, 1)).toMatchObject({ total: 2, ready: 2, queued: 0, writing: null });

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
