import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasClient } from "../connectors/canvas/client";
import { createDb } from "../db/client";
import { files, modules, users } from "../db/schema";
import { resetImageRefusals, resetProviderHealth } from "./openai-compat";

// Each "PDF" is its deck's name; its text is short slides naming the deck.
vi.mock("../lib/pdf-text", () => ({
  extractPdfText: async (bytes: Uint8Array) => {
    const name = new TextDecoder().decode(bytes);
    return Array.from({ length: 20 }, (_, i) => `${name} slide ${i + 1}\n-- ${i + 1} of 20 --`).join("\n");
  },
}));
vi.mock("../lib/pdf-render", () => ({ renderPdfPage: async () => null }));

const { generateModuleGuide } = await import("./generate-guide");

const say = (content: string, finish = "stop") => Response.json({ choices: [{ message: { content }, finish_reason: finish }] });
const sections = [{ heading: "One", covers: "a", slides: "2-4" }, { heading: "Two", covers: "b", slides: "5-8" }];

// Writes every deck's outline and sections, except that L2's outline gets
// the given reply every time.
function model(l2Outline: () => Response) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const system = String(body.messages[0].content);
    const user = String(typeof body.messages[1].content === "string" ? body.messages[1].content : body.messages[1].content[0].text);
    if (system.includes("planning one chapter")) {
      return user.includes("L2-heaps") ? l2Outline() : say(JSON.stringify({ title: "Stacks", sections }));
    }
    const heading = user.match(/first line\): ### (.+)/)?.[1] ?? "?";
    return say(`### ${heading}\n\nA claim about it [slide 3](slide:L1-stack#3).`);
  });
}

describe("generateModuleGuide", () => {
  let db: ReturnType<typeof createDb>;
  let n = 0;
  beforeEach(() => {
    resetProviderHealth();
    resetImageRefusals();
    db = createDb(":memory:");
    db.insert(users).values({ name: "a" }).run();
    db.insert(modules).values({ userId: 1, canvasCourseId: 1, code: "CS1", name: "Systems" }).run();
    db.insert(files).values([
      { moduleId: 1, canvasFileId: 1, displayName: "L1-stack.pdf", discoveredAt: 1 },
      { moduleId: 1, canvasFileId: 2, displayName: "L2-heaps.pdf", discoveredAt: 1 },
    ]).run();
  });
  afterEach(() => vi.unstubAllGlobals());

  const run = () => generateModuleGuide({
    db, canvas: {} as CanvasClient, moduleId: 1, fileIds: [1, 2],
    cfg: { baseUrl: "https://llm.test/v1", apiKey: `k${n++}`, model: "m" },
    loadPdf: async (f) => new TextEncoder().encode(f.displayName.replace(/\.pdf$/, "")),
  });

  it("skips a deck whose outline came back empty twice and keeps the chapters already written", async () => {
    vi.stubGlobal("fetch", model(() => say("", "length")));
    const out = await run();
    expect(out.decks).toEqual(["L1-stack"]);
    expect(out.markdown).toContain("## 1. Stacks");
    expect(out.problems.join(" ")).toMatch(/L2-heaps: outline failed/);
  });

  it("skips a deck whose outline failed outright, saying why", async () => {
    vi.stubGlobal("fetch", model(() => new Response("{}", { status: 401 })));
    const out = await run();
    expect(out.decks).toEqual(["L1-stack"]);
    expect(out.problems.join(" ")).toMatch(/L2-heaps: outline failed \(llm 401/);
  });
});
