import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTopicChapter, type TopicSource } from "./generate-guide";
import { planGuide } from "./guide-plan";
import { refusesImages, resetImageRefusals, resetProviderHealth } from "./openai-compat";
import { createGuideGenerator } from "./study-guide";

let n = 0;
const freshCfg = () => ({ baseUrl: "https://llm.test/v1", apiKey: `k${n++}`, model: "m" });
const cfg = freshCfg();
// Short slides, so every one of them reads as a figure slide.
const deck = (pages: number, chars = 0) => Array.from({ length: pages }, (_, i) => `slide${i + 1} words about thing ${i + 1}${"x".repeat(chars)}\n-- ${i + 1} of ${pages} --`).join("\n");

// One request as the model sees it.
type Seen = { system: string; text: string; images: number[]; parts: { type: string }[]; maxTokens: number; host: string };
function read(init?: RequestInit, url = "https://llm.test/v1"): Seen {
  const body = JSON.parse(String(init?.body));
  const user = body.messages[1].content as string | { type: string; text?: string; image_url?: { url: string } }[];
  const parts = typeof user === "string" ? [{ type: "text", text: user }] : user;
  return {
    system: String(body.messages[0].content),
    text: parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"),
    // Each fake image is one byte: the slide it shows.
    images: parts.filter((p) => p.type === "image_url").map((p) => Buffer.from(p.image_url!.url.split(",")[1]!, "base64")[0]!),
    parts,
    maxTokens: body.max_tokens ?? body.max_completion_tokens,
    host: new URL(url).hostname,
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
  return vi.fn(async (url: string, init?: RequestInit) => {
    const s = read(init, url);
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

  it("counts a cut section that kept nothing but its heading as missing, so it is written again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.stubGlobal("fetch", model([], {
      answer: (s) => (asked(s).includes("Bounds") ? say(`### ${asked(s)}\n\nThe first sent`, "length") : null),
    }));
    const out = await settle(write([L1()]));
    expect(out.missing).toEqual({ sections: 1, decks: 0 });
    expect(out.problems.join(" ")).toMatch(/section 2: the section was cut off before any of it was written/);
    expect(out.body).not.toContain("### 1.2 Bounds");
  });
});

describe("an outline", () => {
  const gen = () => createGuideGenerator(freshCfg());
  const outlineCall = (text = deck(30)) => gen().outline("L1-asymptotics", text, 30);

  it("that ran out of budget twice is null, never a throw, and the second try has twice the budget", async () => {
    const budgets: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { budgets.push(read(init).maxTokens); return say("", "length"); }));
    expect(await outlineCall()).toBeNull();
    expect(budgets).toEqual([12_000, 24_000]);
  });

  it("that was cut off or empty twice is null too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => say('{"title": "x", "sections": [{"head', "length")));
    expect(await outlineCall()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => say("", "stop")));
    expect(await outlineCall()).toBeNull();
  });

  it("is asked again after a timeout", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (calls++ === 0) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return say(JSON.stringify({ title: "x", sections: TWO }));
    }));
    expect((await outlineCall())?.sections).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it("gets time in step with its budget", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      vi.stubGlobal("fetch", vi.fn(async () => say(JSON.stringify({ title: "x", sections: TWO }))));
      await outlineCall();
      expect(timeout.mock.calls.map((c) => c[0])).toEqual([600_000]);
    } finally {
      timeout.mockRestore();
    }
  });

  it("still throws on a refused key, for the caller to report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(outlineCall()).rejects.toThrow(/llm 401/);
  });
});

describe("a guide plan", () => {
  const input = { module: "CS1 Intro", lectures: [{ ref: "L1", line: "L1-intro, 30 slides" }], practice: [], assessments: [], notes: [], existing: [] };
  it("that ran out of budget is asked again with twice as much", async () => {
    const budgets: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      budgets.push(read(init).maxTokens);
      return budgets.length === 1 ? say("", "length") : say(JSON.stringify({ title: "Intro", topics: [{ key: "intro", title: "Intro", lectures: ["L1"] }] }));
    }));
    const plan = await planGuide(freshCfg(), input, () => "Intro");
    expect(plan.topics).toHaveLength(1);
    expect(budgets).toEqual([12_000, 24_000]);
  });
  it("that timed out is asked again", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (calls++ === 0) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return say(JSON.stringify({ title: "Intro", topics: [{ key: "intro", title: "Intro", lectures: ["L1"] }] }));
    }));
    expect((await planGuide(freshCfg(), input, () => "Intro")).topics).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe("a request too big for the endpoint", () => {
  const pageImage = async (page: number) => new Uint8Array([page]);

  it("with images, refused for any reason but the key or the rate, is asked again in text alone", async () => {
    const seen: Seen[] = [];
    const c = freshCfg();
    vi.stubGlobal("fetch", model(seen, { answer: (s) => (s.images.length ? new Response("<html><body>413 Request Entity Too Large</body></html>", { status: 413 }) : null) }));
    const out = await write([L1({ pageImage })], [], c);
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    expect(seen.filter((s) => asked(s).includes("Growth")).map((s) => s.images.length)).toEqual([2, 0]);
  });

  it("past the model's context, falls back to the section's own slides and the smaller budget", async () => {
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", model(seen, {
      answer: (s) => (s.maxTokens === 16_000 && !asked(s).includes("Key points")
        ? Response.json({ error: { message: "This model's maximum context length is 32768 tokens. However, you requested 50000 tokens." } }, { status: 400 })
        : null),
    }));
    const out = await write([L1()]);
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    const growth = seen.filter((s) => asked(s).includes("Growth"));
    expect(growth.map((s) => s.maxTokens)).toEqual([16_000, 8_000]);   // no repeats of the one too big
    expect(growth[1]!.text).toContain("[Slide 2]");
    expect(growth[1]!.text).not.toContain("[Slide 40]");
    expect(growth[1]!.text).toMatch(/cite only those/);
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
    // Without section numbers, which the guide changes when it renumbers.
    expect(prefix(seen[0]!)).toMatch(/=== CHAPTER OUTLINE ===\n- Growth — a \(slides 2-3\)\n- Bounds — b \(slides 40-41\)\n- Limits — c \(slides 50-52\)/);
    // The task is last.
    expect(seen[1]!.text).toMatch(/=== YOUR SECTION ===\nWrite section 1\.2 in full depth\.\nHeading \(use it verbatim as your first line\): ### 1\.2 Bounds\nWhat it must teach: b\nIt draws on slides 40-41: cite mainly those\./);
    expect(seen[1]!.system).toMatch(/"#### " subheadings without numbers/);
  });

  it("has other sections referred to by heading, never by a number the guide would renumber", async () => {
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", model(seen));
    await write([L1()]);
    const s = seen[1]!;
    for (const text of [s.text, s.system]) {
      expect(text).toMatch(/by its heading in italics/);
      expect(text).toMatch(/never by a number|Never refer to a section by a number/);
      expect(text).not.toMatch(/see 1\.\d/);
    }
    // No section number appears in the shared prefix at all.
    expect(s.text.slice(0, s.text.indexOf("=== YOUR SECTION ==="))).not.toMatch(/\b1\.\d\b/);
  });

  it("makes each section own what its line names, so two never defer to each other", async () => {
    const seen: Seen[] = [];
    const outlines: Seen[] = [];
    const base = model(seen);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const s = read(init);
      if (s.system.includes("planning one chapter")) outlines.push(s);
      return base(url, init);
    }));
    await write([L1()]);
    expect(seen[0]!.text).toMatch(/Teach fully everything "What it must teach" names, even where another section of the outline touches it\. Only for an idea that is not in that line and is another section's/);
    expect(seen[0]!.system).toMatch(/Teach fully everything your own section must teach/);
    expect(outlines[0]!.system).toMatch(/Give every idea to ONE section/);
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
    expect(bounds.text).toMatch(/Image 1 is slide 10, Image 2 is slide 11, Image 3 is slide 12, Image 4 is slide 13\. Read each image as part of its slide, saying only what it shows: copy any code or command on it into a fenced block.*Embed it where it belongs as !\[short caption\]\(slide-img:L1-asymptotics#N\)/);
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

  it("never blames the primary for its fallback's refusal", async () => {
    const seen: Seen[] = [];
    const backup = { ...freshCfg(), baseUrl: "https://backup.test/v1" };
    const c = { ...freshCfg(), fallback: backup };
    vi.stubGlobal("fetch", model(seen, {
      answer: (s) => {
        if (!s.images.length) return null;
        // The primary times out; the text-only fallback refuses the images.
        return s.host === "llm.test" ? new Response("gateway timeout", { status: 504 })
          : Response.json({ error: { message: "image input is not supported" } }, { status: 400 });
      },
    }));
    const out = await write([L1({ pageImage })], [], c);
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    expect(refusesImages(c)).toBe(false);
    expect(refusesImages(backup)).toBe(true);
    // Every section with figures still offered them to the primary.
    expect(seen.filter((s) => s.host === "llm.test" && s.images.length).map(asked).sort()).toEqual(["1.1 Growth", "1.2 Bounds"]);
  });

  it("leaves out a slide image too big to send", async () => {
    const seen: Seen[] = [];
    vi.stubGlobal("fetch", model(seen));
    const big = (p: number) => { const a = new Uint8Array(1_000_001); a[0] = p; return a; };
    await write([L1({ pageImage: async (p) => (p === 2 ? big(p) : new Uint8Array([p])) })]);
    expect(seen.find((s) => asked(s).includes("Growth"))!.images).toEqual([3]);
  });

  it("has at most two requests carrying images in flight at once", async () => {
    const sections = Array.from({ length: 6 }, (_, k) => ({ heading: `S${k}`, covers: `c${k}`, slides: `${k * 5 + 1}-${k * 5 + 3}` }));
    const base = model([], { sections });
    let active = 0, most = 0, sent = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (!read(init).images.length) return base(url, init);
      sent++;
      most = Math.max(most, ++active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return base(url, init);
    }));
    const out = await write([L1({ pageImage })]);
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    expect(sent).toBe(6);
    expect(most).toBe(2);
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
