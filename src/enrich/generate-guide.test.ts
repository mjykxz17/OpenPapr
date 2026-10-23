import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTopicChapter, type TopicSource } from "./generate-guide";
import { resetImageRefusals, resetProviderHealth } from "./openai-compat";

let n = 0;
const freshCfg = () => ({ baseUrl: "https://llm.test/v1", apiKey: `k${n++}`, model: "m" });
const cfg = freshCfg();
// Short slides, so every one of them reads as a figure slide.
const deck = (pages: number, chars = 0) => Array.from({ length: pages }, (_, i) => `slide${i + 1} words about thing ${i + 1}${"x".repeat(chars)}\n-- ${i + 1} of ${pages} --`).join("\n");

// One request as the model sees it.
type Seen = { system: string; text: string; images: number[]; parts: { type: string }[] };
function read(init?: RequestInit): Seen {
  const body = JSON.parse(String(init?.body));
  const user = body.messages[1].content as string | { type: string; text?: string; image_url?: { url: string } }[];
  const parts = typeof user === "string" ? [{ type: "text", text: user }] : user;
  return {
    system: String(body.messages[0].content),
    text: parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"),
    // Each fake image is one byte: the slide it shows.
    images: parts.filter((p) => p.type === "image_url").map((p) => Buffer.from(p.image_url!.url.split(",")[1]!, "base64")[0]!),
    parts,
  };
}
const asked = (s: Seen) => s.text.match(/first line\): ### (.+)/)?.[1] ?? "";
const say = (content: string, finish = "stop") => Response.json({ choices: [{ message: { content }, finish_reason: finish }] });

type Section = { heading: string; covers: string; slides: string };
const TWO: Section[] = [{ heading: "Growth", covers: "a", slides: "2-3" }, { heading: "Bounds", covers: "b", slides: "40-41" }];

// A model that outlines the given sections and writes each one asked for,
// citing one good slide with the wrong text and one past the end. answer
// can stand in for any section call; every one is kept in seen.
function model(seen: Seen[], opts: { sections?: Section[]; answer?: (s: Seen) => Response | null } = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const s = read(init);
    if (s.system.includes("planning one chapter")) return say(JSON.stringify({ title: "x", sections: opts.sections ?? TWO }));
    seen.push(s);
    const custom = opts.answer?.(s);
    if (custom) return custom;
    const heading = asked(s) || "?";
    return say(`### ${heading}\n\nA claim [slide 9](slide:L1-asymptotics#3). Made up [slide 70](slide:L1-asymptotics#70).`);
  });
}

// withRetry waits a few seconds between tries; the clock is moved on instead.
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.finally(() => { done = true; }).catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(1000);
  return p;
}

const L1 = (extra: Partial<TopicSource> = {}): TopicSource => ({ name: "L1-asymptotics", text: deck(60), ...extra });
const write = (lectures: TopicSource[], practice: TopicSource[] = [], c = cfg) => generateTopicChapter({ cfg: c, title: "Asymptotics", lectures, practice });

beforeEach(() => { resetProviderHealth(); resetImageRefusals(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("generateTopicChapter", () => {
  it("keeps what was written and counts the sections it could not write", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.stubGlobal("fetch", model([], { answer: (s) => (asked(s).includes("Bounds") ? new Response("overloaded", { status: 500 }) : null) }));
    const out = await settle(write([L1()]));
    expect(out.missing).toEqual({ sections: 1, decks: 0 });
    expect(out.planned).toBe(2);
    expect(out.body).toContain("### 1.1 Growth");
    expect(out.body).not.toContain("### 1.2 Bounds");
    expect(out.problems.join(" ")).toMatch(/section 2/);
  });

  it("counts a section the model answered with nothing as missing, never a silent hole", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    // All the budget went on reasoning: no text, finish_reason "length".
    vi.stubGlobal("fetch", model([], { answer: (s) => (asked(s).includes("Bounds") ? say("", "length") : null) }));
    const out = await settle(write([L1()]));
    expect(out.missing).toEqual({ sections: 1, decks: 0 });
    expect(out.problems.join(" ")).toMatch(/L1-asymptotics section 2: .*token budget/);
  });

  it("says when a section was cut off, without counting it missing", async () => {
    vi.stubGlobal("fetch", model([], {
      answer: (s) => (asked(s).includes("Bounds") ? say(`### ${asked(s)}\n\nWhole [s](slide:L1-asymptotics#40).\n\nHalf a sent`, "length") : null),
    }));
    const out = await write([L1()]);
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    expect(out.problems.join(" ")).toMatch(/section 2: cut off at the model's token budget/);
    expect(out.body).toContain("Whole [L1 p40]");
    expect(out.body).not.toContain("Half a sent");
  });

  it("fixes the citations before they are stored", async () => {
    vi.stubGlobal("fetch", model([]));
    const out = await write([L1()]);
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    expect(out.body).toContain("A claim [L1 p3](slide:L1-asymptotics#3).");
    expect(out.body).not.toContain("#70");
  });

  it("counts a deck whose outline failed twice as a whole deck missing, not one section", async () => {
    const base = model([]);
    let outlines = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const s = read(init);
      if (s.system.includes("planning one chapter") && s.text.includes("L2-bounds")) { outlines++; return say("not json"); }
      return base(url, init);
    }));
    const out = await write([L1(), { name: "L2-bounds", text: deck(30) }]);
    expect(out.missing).toEqual({ sections: 0, decks: 1 });
    expect(outlines).toBe(2);
    expect(out.problems.join(" ")).toMatch(/L2-bounds: outline failed/);
  });

  it("asks for the outline again when the first one does not parse", async () => {
    const base = model([]);
    let outlines = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (read(init).system.includes("planning one chapter") && outlines++ === 0) return say("", "length");
      return base(url, init);
    }));
    const out = await write([L1()]);
    expect(outlines).toBe(2);
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
  });
});

describe("one deck's sections share their start", () => {
  it("sends every section the same system prompt and the same deck and outline first", async () => {
    const seen: Seen[] = [];
    const sections = [...TWO, { heading: "Limits", covers: "c", slides: "50-52" }];
    vi.stubGlobal("fetch", model(seen, { sections }));
    await write([L1()]);
    const bodies = seen.filter((s) => !asked(s).includes("Key points"));
    expect(bodies.map(asked)).toEqual(["1.1 Growth", "1.2 Bounds", "1.3 Limits"]);
    expect(new Set(bodies.map((s) => s.system)).size).toBe(1);
    const prefix = (s: Seen) => s.text.slice(0, s.text.indexOf("=== YOUR SECTION ==="));
    expect(new Set(seen.map(prefix)).size).toBe(1);               // the key points too
    // The whole deck, then the whole outline.
    expect(prefix(seen[0]!)).toContain("[Slide 1]\nslide1 ");
    expect(prefix(seen[0]!)).toContain("[Slide 60]\nslide60 ");
    expect(prefix(seen[0]!)).toMatch(/=== CHAPTER OUTLINE ===\n1\.1 Growth — a \(slides 2-3\)\n1\.2 Bounds — b \(slides 40-41\)\n1\.3 Limits — c \(slides 50-52\)/);
    // The task is last, and says to refer to other sections by number.
    expect(seen[1]!.text).toMatch(/=== YOUR SECTION ===\nWrite section 1\.2 in full depth\.\nHeading \(use it verbatim as your first line\): ### 1\.2 Bounds\nWhat it must teach: b\nIt draws on slides 40-41: cite mainly those\./);
    expect(seen[1]!.text).toMatch(/refer to that section by number instead of teaching it again/);
    expect(seen[1]!.system).toMatch(/"#### " subheadings without numbers/);
  });

  it("names every figure slide of the deck in the system prompt", async () => {
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", model(seen));
    await write([L1()]);
    expect(seen[0]!.system).toContain(`mostly picture — a diagram, screenshot or figure: ${Array.from({ length: 60 }, (_, i) => i + 1).join(", ")}.`);
  });

  it("falls back to each section's own slides when the deck is too big to send whole", async () => {
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", model(seen));
    await write([{ name: "L1-asymptotics", text: deck(300, 500) }]);
    const growth = seen.find((s) => asked(s).includes("Growth"))!;
    expect(growth.text).toContain("[Slide 2]");
    expect(growth.text).toContain("[Slide 5]");                     // two slides of context
    expect(growth.text).not.toContain("[Slide 40]");
    expect(growth.text).toContain("=== CHAPTER OUTLINE ===");
    expect(growth.text).toMatch(/cite only those/);
  });

  it("writes the first section on its own before the others start", async () => {
    const events: string[] = [];
    const sections = [...TWO, { heading: "Limits", covers: "c", slides: "50-52" }];
    const base = model([], { sections });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const h = asked(read(init));
      if (!h) return base(url, init);
      events.push(`start ${h}`);
      await new Promise((r) => setTimeout(r, h.startsWith("1.1") ? 30 : 5));
      events.push(`end ${h}`);
      return base(url, init);
    }));
    await write([L1()]);
    expect(events.slice(0, 2)).toEqual(["start 1.1 Growth", "end 1.1 Growth"]);
    // The rest at once.
    expect(events.slice(2, 4).sort()).toEqual(["start 1.2 Bounds", "start 1.3 Limits"]);
    expect(events.at(-1)).toMatch(/end 1\.4 Key points/);
  });
});

describe("figures, for a model that reads images", () => {
  const rendered: number[] = [];
  const pageImage = async (page: number) => { rendered.push(page); return new Uint8Array([page]); };
  beforeEach(() => { rendered.length = 0; });

  it("sends a section only the figure slides in its own range, at most four, after all the text", async () => {
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", model(seen, { sections: [{ heading: "Growth", covers: "a", slides: "2-3" }, { heading: "Bounds", covers: "b", slides: "10-20" }] }));
    await write([L1({ pageImage })]);
    const growth = seen.find((s) => asked(s).includes("Growth"))!;
    const bounds = seen.find((s) => asked(s).includes("Bounds"))!;
    expect(growth.images).toEqual([2, 3]);
    expect(bounds.images).toEqual([10, 11, 12, 13]);
    expect(bounds.parts.map((p) => p.type)).toEqual(["text", "image_url", "image_url", "image_url", "image_url"]);
    expect(bounds.text).toMatch(/Image 1 is slide 10, Image 2 is slide 11, Image 3 is slide 12, Image 4 is slide 13\. Describe each figure only from what its image shows, and embed it where it belongs as !\[short caption\]\(slide-img:L1-asymptotics#N\)/);
    // The key points are text alone, and slides are rendered once each.
    expect(seen.find((s) => asked(s).includes("Key points"))!.images).toEqual([]);
    expect(rendered.sort((a, b) => a - b)).toEqual([2, 3, 10, 11, 12, 13]);
  });

  it("leaves out a slide that would not render", async () => {
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", model(seen));
    await write([L1({ pageImage: async (p) => (p === 2 ? null : new Uint8Array([p])) })]);
    const growth = seen.find((s) => asked(s).includes("Growth"))!;
    expect(growth.images).toEqual([3]);
    expect(growth.text).toMatch(/Image 1 is slide 3\./);
  });

  it("asks again in text alone when the model refuses images, and remembers", async () => {
    const seen: Seen[] = [];
    const c = freshCfg();
    vi.stubGlobal("fetch", model(seen, {
      answer: (s) => (s.images.length ? Response.json({ error: { message: "image input is not supported for this model" } }, { status: 400 }) : null),
    }));
    const out = await write([L1({ pageImage })], [], c);
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    expect(out.body).toContain("### 1.2 Bounds");
    // One refused request, for the first section; nothing after it sent images.
    expect(seen.filter((s) => s.images.length)).toHaveLength(1);
    expect(seen.filter((s) => asked(s).includes("Growth")).map((s) => s.images.length)).toEqual([2, 0]);
    // Nor on the next chapter for the same model.
    seen.length = 0;
    await write([L1({ pageImage })], [], c);
    expect(seen.some((s) => s.images.length)).toBe(false);
  });
});

describe("key points", () => {
  it("follow each deck's sections in the 1.N numbering, before the practice sheets", async () => {
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", model(seen, { answer: (s) => (asked(s).includes("Key points") ? say(`### ${asked(s)}\n\n- Remember [s](slide:L1-asymptotics#2)`) : null) }));
    const out = await write([L1(), { name: "L2-bounds", text: deck(30) }], [{ name: "lab1", text: deck(4) }]);
    const headings = out.body.split("\n").filter((l) => l.startsWith("### ")).map((l) => l.slice(4));
    expect(headings).toEqual(["1.1 Growth", "1.2 Bounds", "1.3 Key points", "1.4 Growth", "1.5 Bounds", "1.6 Key points", "1.7 Practice: lab1"]);
    expect(out.planned).toBe(5);
    const recap = seen.find((s) => asked(s) === "1.3 Key points")!;
    expect(recap.text).toMatch(/6 to 10 bullets/);
    expect(recap.text).toMatch(/Nothing that is not on the slides/);
  });

  it("that fail are a problem, not a missing part, and leave no gap in the numbering", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.stubGlobal("fetch", model([], { answer: (s) => (asked(s).includes("Key points") ? new Response("overloaded", { status: 500 }) : null) }));
    const out = await settle(write([L1()], [{ name: "lab1", text: deck(4) }]));
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    expect(out.problems.join(" ")).toMatch(/L1-asymptotics key points: llm 500/);
    const headings = out.body.split("\n").filter((l) => l.startsWith("### ")).map((l) => l.slice(4));
    expect(headings).toEqual(["1.1 Growth", "1.2 Bounds", "1.3 Practice: lab1"]);
  });
});
