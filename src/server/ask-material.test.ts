import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { files, items, modules, passages, studyGuides, users } from "../db/schema";
import { announcementPassages, guidePassages, slidePassages, syncCheapSources, syncPassages } from "./passages";
import { bm25, fuse, queryTokens, retrieve, semanticFloor, tokens } from "./retrieve";
import { NOT_FOUND, answerFromMaterial, citedSources, isContentQuestion, isFollowUp, previousQuestion, sourceHref } from "./ask";
import { embedTexts, embeddingsUsable, normalize, resetEmbeddingHealth, toBlob } from "../enrich/embeddings";
import { embedPending, indexModule } from "../worker/index-material";

const deckText = ["Title slide only", "-- 1 of 3 --", "A stack canary is a random value placed before the return address to detect overflows.", "-- 2 of 3 --", "Heap spraying fills memory with copies of shellcode so a jump lands in it.", "-- 3 of 3 --"].join("\n");

describe("passage builders", () => {
  it("cuts slides by page, skipping near-empty ones", () => {
    const p = slidePassages(7, "L3-stack", "v1", deckText);
    expect(p.map((x) => x.page)).toEqual([2, 3]);
    expect(p[0]).toMatchObject({ sourceKey: "slide:7:2", deck: "L3-stack", title: "L3-stack · slide 2" });
    expect(p[0]!.body).toContain("canary");
  });
  it("titles guide sections with their chapter", () => {
    const md = "# G\n\n## 1. Memory safety\n\nWhy memory bugs matter so much in C programs, briefly.\n\n### Stack canaries\n\nA canary sits before the return address and is checked on return.";
    expect(guidePassages(md).map((p) => p.title)).toEqual(["Guide: Memory safety", "Guide: Memory safety › Stack canaries"]);
  });
  it("reads announcements and staff replies as text", () => {
    const p = announcementPassages([{ id: 3, type: "staff_reply", title: "Quiz scope", body: "<p>The quiz covers <b>L1–L5</b> only.</p>", sender: "Dr Lim" }]);
    expect(p[0]).toMatchObject({ title: "Dr Lim replied: Quiz scope", body: "The quiz covers L1–L5 only." });
  });
});

describe("retrieval maths", () => {
  it("ranks by BM25 and fuses lists", () => {
    const docs = [["stack", "canary", "return"], ["heap", "spray"], ["stack", "frame"]].map((t, i) => ({ id: i + 1, tf: new Map(t.map((x) => [x, 1])), len: t.length }));
    expect(bm25(tokens("what is a stack canary?"), docs).map((d) => d.id)).toEqual([1, 3]);
    expect(fuse([[1, 2, 3], [3, 1]])[0]).toBe(1);
  });
});

describe("citations", () => {
  const hits = [
    { id: 1, kind: "slide" as const, moduleId: 2, code: "CS4238", title: "L3 · slide 2", body: "", fileId: 7, deck: "L3", page: 2, itemId: null, anchor: null },
    { id: 2, kind: "guide" as const, moduleId: 2, code: "CS4238", title: "Guide: X", body: "", fileId: null, deck: null, page: null, itemId: null, anchor: "stack-canaries" },
  ];
  it("keeps real citations, drops invented ones, expands ranges", () => {
    const r = citedSources("A canary guards it [1]. Also [9]. Both say so [1, 2].", hits);
    expect(r.text).toBe("A canary guards it [1]. Also. Both say so [1][2].");
    expect(r.sources.map((s) => s.n)).toEqual([1, 2]);
    expect(r.sources[0]!.slide).toEqual({ deck: "L3", page: 2 });
    expect(citedSources("See [1-2].", hits).sources).toHaveLength(2);
  });
  it("links each kind to the right place", () => {
    expect(sourceHref(hits[0]!)).toBe("/modules/2/guide?slide=L3&page=2");
    expect(sourceHref(hits[1]!)).toBe("/modules/2/guide#stack-canaries");
    expect(sourceHref({ kind: "announcement", moduleId: 2, itemId: 5, deck: null, page: null, anchor: null })).toBe("/modules/2#a-5");
  });
});

// A fake embeddings endpoint: a vector of word counts over a tiny vocabulary.
const VOCAB = ["canary", "stack", "return", "heap", "spray", "shellcode", "overflow", "quiz"];
const fakeEmbed = (async (_url: string, init: RequestInit) => {
  const { input } = JSON.parse(String(init.body)) as { input: string[] };
  const data = input.map((t, index) => ({ index, embedding: VOCAB.map((w) => (t.toLowerCase().split(w).length - 1) + 0.01) }));
  return new Response(JSON.stringify({ data }), { status: 200 });
}) as unknown as typeof fetch;
const cfg = { baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m" };

describe("indexing and asking", () => {
  let db: ReturnType<typeof createDb>;
  let modId: number;
  beforeEach(() => {
    resetEmbeddingHealth();
    db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    modId = db.insert(modules).values({ userId: 1, canvasCourseId: 1, code: "CS4238", name: "Sec" }).returning().get().id;
  });

  it("keeps passages in step with their sources", () => {
    const want = slidePassages(7, "L3", "v1", deckText);
    expect(syncPassages(db, 1, modId, "slide:7:", want, 1)).toBe(2);
    expect(syncPassages(db, 1, modId, "slide:7:", want, 2)).toBe(0);
    expect(syncPassages(db, 1, modId, "slide:7:", want.slice(0, 1), 3)).toBe(1);
    expect(db.select().from(passages).all()).toHaveLength(1);
  });

  it("indexes the newest copy of each deck and the guide, then embeds", async () => {
    const sig = { pages: 3, words: 80, head: "x", minhash: [], hash: "h1" };
    db.insert(files).values({ moduleId: modId, canvasFileId: 1, displayName: "L3-stack.pdf", discoveredAt: 1, category: "slides", textSigJson: JSON.stringify(sig) }).run();
    db.insert(studyGuides).values({ moduleId: modId, markdown: "## 1. Heap\n\nHeap spraying places shellcode copies all over memory.", generatedAt: 1 }).run();
    db.insert(items).values({ userId: 1, moduleId: modId, type: "announcement", source: "canvas", sourceId: "a:1", title: "Quiz 2", body: "Quiz 2 covers stack overflows and canaries.", firstSeenAt: 1 }).run();
    let reads = 0;
    const deps = { db, now: () => 10, cfgFor: () => cfg, fileText: async () => { reads++; return deckText; }, fetchFn: fakeEmbed };
    const mod = db.select().from(modules).where(eq(modules.id, modId)).get()!;
    await indexModule(deps, 1, mod, { decks: 2 });
    await indexModule(deps, 1, mod, { decks: 2 });
    expect(reads).toBe(1);   // unchanged deck is not read again
    expect(db.select().from(passages).all().map((p) => p.kind).sort()).toEqual(["announcement", "guide", "slide", "slide"]);
    expect(await embedPending(deps, 1)).toBe(4);
    expect(await embedPending(deps, 1)).toBe(0);

    const r = await retrieve(db, 1, "what does a canary protect", { cfg, fetchFn: fakeEmbed });
    expect(r.semantic).toBe(true);
    expect(r.hits[0]!.title).toContain("slide 2");
  });

  it("falls back to word search without embeddings", async () => {
    syncCheapSources(db, 1, modId, 1);
    syncPassages(db, 1, modId, "slide:7:", slidePassages(7, "L3", "v1", deckText), 1);
    const r = await retrieve(db, 1, "heap spraying", { cfg: null });
    expect(r.semantic).toBe(false);
    expect(r.hits[0]!.page).toBe(3);
  });

  it("remembers a provider with no embeddings", async () => {
    const refuse = (async () => new Response("no such endpoint", { status: 404 })) as unknown as typeof fetch;
    await expect(embedTexts(cfg, "text-embedding-3-small", ["x"], refuse)).rejects.toThrow();
    expect(embeddingsUsable(cfg)).toBeNull();
    expect(embeddingsUsable({ baseUrl: "https://example.com/v1", apiKey: "k", model: "m" })).toBeNull();
    expect(embeddingsUsable({ baseUrl: "https://example.com/v1", apiKey: "k", model: "m", embedModel: "e5" })).toBe("e5");
  });

  it("stores vectors compactly", () => {
    const v = normalize([3, 4]);
    expect(Array.from(v)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(toBlob(v).byteLength).toBe(8);
  });
});

describe("the relevance floor", () => {
  let db: ReturnType<typeof createDb>;
  let modId: number;
  beforeEach(() => {
    resetEmbeddingHealth();
    db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    modId = db.insert(modules).values({ userId: 1, canvasCourseId: 1, code: "CS4238", name: "Sec" }).returning().get().id;
    syncPassages(db, 1, modId, "slide:7:", slidePassages(7, "L3", "v1", deckText), 1);
    db.insert(studyGuides).values({ moduleId: modId, markdown: "## 1. Stack canaries\n\nA stack canary is a guard value the compiler places before the return address; the program checks it on return.", generatedAt: 1 }).run();
    syncCheapSources(db, 1, modId, 1);
  });

  it("folds plurals and ignores how a question is asked", () => {
    expect(tokens("canaries classes boxes processes")).toEqual(["canary", "class", "box", "process"]);
    expect(queryTokens("please explain stack canaries")).toEqual(["stack", "canary"]);
  });

  it("finds nothing for a question the material does not cover, even when one word overlaps", async () => {
    expect((await retrieve(db, 1, "what is the capital of france", { cfg: null })).hits).toEqual([]);
    expect((await retrieve(db, 1, "how do I return a library book", { cfg: null })).hits).toEqual([]);
  });

  it("puts the slides above the study guide when both match", async () => {
    const r = await retrieve(db, 1, "explain stack canaries", { cfg: null });
    expect(r.hits.map((h) => h.kind)).toEqual(["slide", "guide"]);
  });

  it("searches a follow-up with the question before it, but needs its own words to match", async () => {
    expect((await retrieve(db, 1, "why?", { cfg: null })).hits).toEqual([]);
    expect((await retrieve(db, 1, "why?", { cfg: null, context: "what is a stack canary" })).hits[0]!.page).toBe(2);
    expect((await retrieve(db, 1, "and heap spraying?", { cfg: null, context: "what is a stack canary" })).hits.map((h) => h.page)).toEqual([3]);
  });

  it("drops meaning matches under the model's floor", async () => {
    // Word counts again, with one extra dimension for "none of these words":
    // a question about something else points away from every passage.
    const strict = (async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(String(init.body)) as { input: string[] };
      const data = input.map((t, index) => {
        const v = VOCAB.map((w) => t.toLowerCase().split(w).length - 1);
        return { index, embedding: [...v, v.some(Boolean) ? 0 : 1] };
      });
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch;
    const deps = { db, now: () => 10, cfgFor: () => cfg, fileText: async () => deckText, fetchFn: strict };
    await embedPending(deps, 1);
    expect((await retrieve(db, 1, "what is the capital of france", { cfg, fetchFn: strict })).hits).toEqual([]);
    expect((await retrieve(db, 1, "what does a canary protect", { cfg, fetchFn: strict })).hits[0]!.page).toBe(2);
    expect(semanticFloor("text-embedding-3-small")).toBe(0.3);
    expect(semanticFloor("mistral-embed")).toBeGreaterThan(0.3);
  });
});

describe("answering from material", () => {
  const slide = { id: 1, kind: "slide" as const, moduleId: 2, code: "CS4238", title: "L3 · slide 2", body: "A canary sits before the return address.", fileId: 7, deck: "L3", page: 2, itemId: null, anchor: null };
  const guide = { id: 2, kind: "guide" as const, moduleId: 2, code: "CS4238", title: "Guide: Stacks", body: "Canaries.", fileId: null, deck: null, page: null, itemId: null, anchor: "stacks" };

  it("says it couldn't find it, without asking the model, when nothing clears the floor", async () => {
    let calls = 0;
    const llm = async () => { calls++; return "Paris [1]."; };
    const out = await answerFromMaterial({ question: "What is the capital of France?", earlier: [], hits: [], system: "S", facts: "F", llm });
    expect(out).toEqual({ reply: NOT_FOUND, sources: [], grounded: false, askedModel: false });
    expect(calls).toBe(0);
  });

  it("still asks the model about dates and chat, from the facts", async () => {
    let calls = 0;
    const llm = async () => { calls++; return "Quiz 2 is on Wed."; };
    expect((await answerFromMaterial({ question: "When is the next quiz?", earlier: [], hits: [], system: "S", facts: "F", llm })).grounded).toBe(false);
    await answerFromMaterial({ question: "thanks!", earlier: [], hits: [], system: "S", facts: "F", llm });
    expect(calls).toBe(2);
  });

  it("flags an answer that cites none of its sources, and keeps out-of-range numbers out", async () => {
    const llm = async () => "It guards the return address [7].";
    const out = await answerFromMaterial({ question: "what does a canary guard", earlier: [], hits: [slide], system: "S", facts: "F", llm });
    expect(out.reply).toBe("It guards the return address.");
    expect(out.grounded).toBe(false);
    expect((await answerFromMaterial({ question: "what does a canary guard", earlier: [], hits: [slide], system: "S", facts: "F", llm: async () => "The return address [1]." })).grounded).toBe(true);
  });

  it("sends history without its old [n] markers and labels the study guide", async () => {
    let sent: { role: string; content: string }[] = [];
    const llm = async (m: { role: string; content: string }[]) => { sent = m; return "See [2]."; };
    const out = await answerFromMaterial({
      question: "why?", context: "what is a canary", hits: [slide, guide], system: "S", facts: "F", llm,
      earlier: [{ role: "user", content: "what is a canary" }, { role: "assistant", content: "A guard value [1][2]. It is checked on return [3]." }],
    });
    expect(sent[2]!.content).toBe("A guard value. It is checked on return.");
    expect(sent[0]!.content).toContain("[2] (study guide) CS4238 · Guide: Stacks");
    expect(out.sources[0]).toMatchObject({ n: 2, label: "study guide", title: "Study guide: Stacks" });
  });

  it("knows a follow-up and a content question when it sees one", () => {
    expect(isFollowUp("why?")).toBe(true);
    expect(isFollowUp("and heap spraying?")).toBe(true);
    expect(isFollowUp("give an example of that")).toBe(true);
    expect(isFollowUp("what is the difference between a stack canary and ASLR")).toBe(false);
    expect(previousQuestion([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }])).toBe("c");
    expect(isContentQuestion("explain stack canaries")).toBe(true);
    expect(isContentQuestion("what's due this week?")).toBe(false);
    expect(isContentQuestion("hi papi")).toBe(false);
  });
});
