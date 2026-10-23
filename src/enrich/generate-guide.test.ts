import { afterEach, describe, expect, it, vi } from "vitest";
import { generateTopicChapter } from "./generate-guide";

const cfg = { baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };
const deck = (n: number) => Array.from({ length: n }, (_, i) => `slide${i + 1} words about thing ${i + 1}\n-- ${i + 1} of ${n} --`).join("\n");

// A model that outlines two sections, writes the first and — while broken —
// fails the second. Every section prompt is kept.
function model(prompts: string[], broken: { on: boolean }) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const system = String(body.messages[0].content);
    const user = String(body.messages[1].content);
    if (system.includes("planning one chapter")) {
      return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "x", sections: [
        { heading: "Growth", covers: "a", slides: "2-3" }, { heading: "Bounds", covers: "b", slides: "40-41" }] }) } }] });
    }
    prompts.push(user);
    if (broken.on && user.includes("Bounds")) return new Response("overloaded", { status: 500 });
    const heading = user.match(/### (.+)/)?.[1] ?? "?";
    // One good citation with the wrong text, one past the end of the deck.
    return Response.json({ choices: [{ message: { content: `### ${heading}\n\nA claim [slide 9](slide:L1-asymptotics#3). Made up [slide 70](slide:L1-asymptotics#70).` } }] });
  });
}

// withRetry waits a few seconds between tries; the clock is moved on instead.
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.finally(() => { done = true; }).catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(1000);
  return p;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("generateTopicChapter", () => {
  it("keeps what was written and counts the sections it could not write", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const prompts: string[] = [];
    vi.stubGlobal("fetch", model(prompts, { on: true }));
    const out = await settle(generateTopicChapter({ cfg, title: "Asymptotics", lectures: [{ name: "L1-asymptotics", text: deck(60) }], practice: [] }));
    expect(out.missing).toEqual({ sections: 1, decks: 0 });
    expect(out.planned).toBe(2);
    expect(out.body).toContain("### 1.1 Growth");
    expect(out.body).not.toContain("Bounds");
    expect(out.problems.join(" ")).toMatch(/section 2/);
  });

  it("sends each section only its own slides, and fixes the citations before they are stored", async () => {
    const prompts: string[] = [];
    vi.stubGlobal("fetch", model(prompts, { on: false }));
    const out = await generateTopicChapter({ cfg, title: "Asymptotics", lectures: [{ name: "L1-asymptotics", text: deck(60) }], practice: [] });
    expect(out.missing).toEqual({ sections: 0, decks: 0 });
    const growth = prompts.find((p) => p.includes("Growth"))!;
    expect(growth).toContain("[Slide 2]");
    expect(growth).toContain("[Slide 5]");          // two slides of context
    expect(growth).not.toContain("[Slide 40]");
    expect(out.body).toContain("A claim [L1 p3](slide:L1-asymptotics#3).");
    expect(out.body).not.toContain("#70");
  });

  it("counts a deck whose outline failed as a whole deck missing, not one section", async () => {
    const base = model([], { on: false });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const user = String(body.messages[1].content);
      if (String(body.messages[0].content).includes("planning one chapter") && user.includes("L2-bounds")) return Response.json({ choices: [{ message: { content: "not json" } }] });
      return base(url, init);
    }));
    const out = await generateTopicChapter({
      cfg, title: "Asymptotics", practice: [],
      lectures: [{ name: "L1-asymptotics", text: deck(60) }, { name: "L2-bounds", text: deck(30) }],
    });
    expect(out.missing).toEqual({ sections: 0, decks: 1 });
    expect(out.problems.join(" ")).toMatch(/L2-bounds: outline failed/);
  });
});
