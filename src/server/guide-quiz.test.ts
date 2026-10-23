import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { files, modules, quizAttempts, studyGuides, users } from "../db/schema";
import { chapterQuiz, cleanQuiz, deckPagesFor, quizSource, recordAnswer, savedQuiz } from "./guide-quiz";
import { weakSpots } from "./weak-topics";
import { wipeUserData } from "./account-data";

const chapter = "## 1. Stacks\n\nCanaries [s4](slide:L3-stack#4) guard the return address.";
const q = (over: Record<string, unknown> = {}) => ({ q: "What does a canary protect?", options: ["Return address", "Heap", "TLB", "Registers"], answer: 0, why: "It sits before it.", slide: "slide:L3-stack#4", ...over });

describe("cleanQuiz", () => {
  it("keeps good questions and real slide refs", () => {
    const out = cleanQuiz({ questions: [q(), q({ q: "Where does the canary sit?", slide: null }), q({ q: "Which value is checked on return?", answer: "2" })] }, chapter);
    expect(out).toHaveLength(3);
    expect(out[0]!.slide).toEqual({ deck: "L3-stack", page: 4 });
    expect(out[1]!.slide).toBeNull();
    expect(out[2]!.answer).toBe(2);
  });
  it("drops malformed ones", () => {
    expect(cleanQuiz({ questions: [q({ options: ["a", "b", "c"] }), q()] }, chapter)).toHaveLength(1);
    expect(cleanQuiz({ questions: [q({ options: ["a", "a", "b", "c"] })] }, chapter)).toEqual([]);
    expect(cleanQuiz({ questions: [q({ options: ["Heap.", "heap", "TLB", "Stack"] })] }, chapter)).toEqual([]);
    expect(cleanQuiz({ questions: [q({ options: ["Heap", "TLB", "Stack", "All of the above"] })] }, chapter)).toEqual([]);
    expect(cleanQuiz({ questions: [q({ answer: 4 }), q({ answer: -1 })] }, chapter)).toEqual([]);
    expect(cleanQuiz({ questions: [q(), q()] }, chapter)).toHaveLength(1);
    expect(cleanQuiz(null, chapter)).toEqual([]);
  });
  it("drops questions citing a slide outside the chapter's decks", () => {
    expect(cleanQuiz({ questions: [q({ slide: "slide:L9#1" })] }, chapter)).toEqual([]);
    // Another page of a deck the chapter uses counts when the deck has that page.
    const decks = new Map([["l3-stack", 20]]);
    expect(cleanQuiz({ questions: [q({ slide: "slide:L3-stack#12" })] }, chapter, decks)[0]!.slide).toEqual({ deck: "L3-stack", page: 12 });
    expect(cleanQuiz({ questions: [q({ slide: "slide:L3-stack#40" })] }, chapter, decks)).toEqual([]);
    expect(cleanQuiz({ questions: [q({ slide: "slide:L3-stack#12" })] }, chapter)).toEqual([]);
  });
});

describe("quizSource", () => {
  it("keeps short chapters whole and gives every section of a long one some room", () => {
    expect(quizSource(chapter)).toBe(chapter);
    const long = ["## 1. Big", `### A\n${"a".repeat(30_000)}`, "### B\nshort part about B", `### C\n${"c".repeat(30_000)}`].join("\n");
    const out = quizSource(long, 10_000);
    expect(out.length).toBeLessThanOrEqual(10_000 + 10);
    expect(out).toContain("### B\nshort part about B");
    expect(out).toContain("### C");
  });
});

describe("answers", () => {
  let db: ReturnType<typeof createDb>;
  const guide = `# G\n\n${chapter}\n\n## 2. Heaps\n\nHeap spraying [h2](slide:L4-heap#2) fills memory.`;
  const reply = (questions: unknown[]) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] }), { status: 200 })) as unknown as typeof fetch;
  const cfg = { baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m" };
  const six = [
    q(), q({ q: "Where is the canary placed?", answer: 1, options: ["Heap", "Before the return address", "TLB", "Registers"] }),
    q({ q: "When is the canary checked?", slide: null, options: ["On return", "On call", "Never", "At boot"] }),
  ];

  beforeEach(() => {
    db = createDb(":memory:");
    db.insert(users).values([{ name: "a" }, { name: "b" }]).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 1, code: "CS4238", name: "Sec" }).run();
    db.insert(studyGuides).values({ moduleId: 1, markdown: guide, generatedAt: 1 }).run();
  });

  it("keeps each answer with its slide, gives them back on reload, and starts clean for new questions", async () => {
    const made = await chapterQuiz(db, 1, 1, 0, cfg, 10, { fetchFn: reply(six) });
    if ("error" in made) throw new Error(made.error);
    expect(made.answers).toEqual([]);
    expect(savedQuiz(db, 1, 1, 1)).toBeNull();

    expect(recordAnswer(db, 1, 1, { chapter: 0, set: made.set, question: 0, chosen: 2 }, 100)).toEqual({ correct: false, answer: 0 });
    expect(recordAnswer(db, 1, 1, { chapter: 0, set: made.set, question: 1, chosen: 1 }, 110)).toEqual({ correct: true, answer: 1 });
    const back = savedQuiz(db, 1, 1, 0);
    if (!back || "error" in back) throw new Error("no quiz");
    expect(back.answers.map((a) => [a.question, a.chosen, a.correct])).toEqual([[0, 2, false], [1, 1, true]]);
    expect(db.select().from(quizAttempts).all()[0]).toMatchObject({ deck: "L3-stack", page: 4, topicTitle: "Stacks" });

    // Answering again replaces the earlier answer to that question.
    recordAnswer(db, 1, 1, { chapter: 0, set: made.set, question: 0, chosen: 0 }, 120);
    expect(db.select().from(quizAttempts).all()).toHaveLength(2);

    const fresh = await chapterQuiz(db, 1, 1, 0, cfg, 200, { fresh: true, fetchFn: reply([...six].reverse()) });
    if ("error" in fresh) throw new Error(fresh.error);
    expect(fresh.set).not.toBe(made.set);
    expect(fresh.answers).toEqual([]);
    expect(recordAnswer(db, 1, 1, { chapter: 0, set: made.set, question: 0, chosen: 0 }, 210)).toMatchObject({ status: 409 });
  });

  it("checks who is answering and what", async () => {
    const made = await chapterQuiz(db, 1, 1, 0, cfg, 10, { fetchFn: reply(six) });
    if ("error" in made) throw new Error(made.error);
    expect(recordAnswer(db, 2, 1, { chapter: 0, set: made.set, question: 0, chosen: 0 }, 100)).toMatchObject({ status: 404 });
    expect(savedQuiz(db, 2, 1, 0)).toMatchObject({ status: 404 });
    expect(recordAnswer(db, 1, 1, { chapter: 0, set: made.set, question: 9, chosen: 0 }, 100)).toMatchObject({ status: 400 });
    expect(recordAnswer(db, 1, 1, { chapter: 0, set: made.set, question: 0, chosen: 4 }, 100)).toMatchObject({ status: 400 });
  });

  it("asks once more when too few questions hold up", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      const questions = calls === 1 ? [q(), q({ slide: "slide:L9#1" })] : six;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const made = await chapterQuiz(db, 1, 1, 0, cfg, 10, { fetchFn: flaky });
    if ("error" in made) throw new Error(made.error);
    expect(calls).toBe(2);
    expect(made.questions).toHaveLength(3);
  });

  it("reads deck page counts from their fingerprints", () => {
    db.insert(files).values({ moduleId: 1, canvasFileId: 1, displayName: "L3-stack.pdf", discoveredAt: 1, textSigJson: JSON.stringify({ pages: 20 }) }).run();
    expect(deckPagesFor(db, 1).get("l3-stack")).toBe(20);
  });

  it("is cleared with the rest of the student's data", async () => {
    const made = await chapterQuiz(db, 1, 1, 0, cfg, 10, { fetchFn: reply(six) });
    if ("error" in made) throw new Error(made.error);
    recordAnswer(db, 1, 1, { chapter: 0, set: made.set, question: 0, chosen: 1 }, 100);
    wipeUserData(db, 1);
    expect(db.select().from(quizAttempts).all()).toEqual([]);
  });
});

describe("weakSpots", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb(":memory:");
    db.insert(users).values([{ name: "a" }, { name: "b" }]).run();
    db.insert(modules).values([{ userId: 1, canvasCourseId: 1, code: "CS4238", name: "Sec" }, { userId: 1, canvasCourseId: 2, code: "CS2040", name: "DS" }]).run();
  });
  const add = (o: { user?: number; mod?: number; set?: string; question: number; correct: boolean; at: number; deck?: string | null; page?: number | null; topic?: string }) =>
    db.insert(quizAttempts).values({
      userId: o.user ?? 1, moduleId: o.mod ?? 1, chapterHash: o.set ?? "s1", topicTitle: o.topic ?? "Stacks", question: o.question,
      chosen: 0, correct: o.correct, deck: o.deck === undefined ? "L3" : o.deck, page: o.page === undefined ? 4 : o.page, answeredAt: o.at,
    }).run();

  it("lists slides whose latest answers are wrong, newest first, with how many misses", () => {
    add({ question: 0, correct: false, at: 100, page: 4 });
    add({ question: 1, correct: false, at: 300, page: 4 });
    add({ question: 2, correct: false, at: 200, page: 9, topic: "Frames" });
    add({ question: 3, correct: true, at: 50, page: 9 });
    expect(weakSpots(db, 1, 1, 1000)).toEqual([
      { deck: "L3", page: 4, topicTitle: "Stacks", missed: 2, lastMissedAt: 300 },
      { deck: "L3", page: 9, topicTitle: "Frames", missed: 1, lastMissedAt: 200 },
    ]);
  });

  it("lets a later right answer clear the misses before it", () => {
    add({ question: 0, correct: false, at: 100 });
    add({ question: 1, correct: true, at: 200 });
    add({ set: "s2", question: 0, correct: false, at: 300, page: 7 });
    add({ set: "s2", question: 1, correct: false, at: 250, page: 7 });
    add({ set: "s2", question: 2, correct: true, at: 280, page: 7 });
    expect(weakSpots(db, 1, 1, 1000)).toEqual([{ deck: "L3", page: 7, topicTitle: "Stacks", missed: 1, lastMissedAt: 300 }]);
  });

  it("groups questions without a slide by chapter, and keeps to the student, the module and the time asked", () => {
    add({ question: 0, correct: false, at: 100, deck: null, page: null, topic: "Heaps" });
    add({ question: 1, correct: false, at: 900, page: 5 });
    add({ user: 2, question: 0, correct: false, at: 100 });
    add({ mod: 2, question: 0, correct: false, at: 100 });
    expect(weakSpots(db, 1, 1, 500)).toEqual([{ deck: null, page: null, topicTitle: "Heaps", missed: 1, lastMissedAt: 100 }]);
    expect(weakSpots(db, 1, 1, 1000)).toHaveLength(2);
  });
});
