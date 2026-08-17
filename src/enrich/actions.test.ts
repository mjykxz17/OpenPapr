import { describe, expect, it, vi } from "vitest";
import { createCompatActionExtractor, isDuplicateAction, parseActions } from "./actions";

const cfg = { baseUrl: "https://agrouter.example/v1", apiKey: "sk-test", model: "agnes-2.5-flash" };
const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const posted = Date.parse("2026-08-17T08:00:00+08:00");
const ann = { title: "Lab tonight", body: "Lab will remain open till 23:59 tonight", postedAt: posted };

describe("parseActions", () => {
  it("parses valid actions into ms timestamps", () => {
    const raw = { found: true, actions: [{ title: "In-person quiz", due_at: "2026-08-20T18:30:00+08:00", evidence: "Quiz on Thursday 6:30pm" }] };
    expect(parseActions(raw, posted)).toEqual([
      { title: "In-person quiz", dueAt: Date.parse("2026-08-20T18:30:00+08:00"), evidence: "Quiz on Thursday 6:30pm" },
    ]);
  });
  it("drops actions with unparseable dates", () => {
    const raw = { found: true, actions: [{ title: "x", due_at: "next Thursday-ish", evidence: "e" }] };
    expect(parseActions(raw, posted)).toEqual([]);
  });
  it("drops dates outside the -30d/+365d sanity window", () => {
    const raw = { found: true, actions: [
      { title: "ancient", due_at: "2024-01-01T10:00:00+08:00", evidence: "e" },
      { title: "far future", due_at: "2029-01-01T10:00:00+08:00", evidence: "e" },
      { title: "fine", due_at: "2026-09-01T10:00:00+08:00", evidence: "e" },
    ]};
    expect(parseActions(raw, posted)!.map((a) => a.title)).toEqual(["fine"]);
  });
  it("returns [] for found=false", () => {
    expect(parseActions({ found: false, actions: [] }, posted)).toEqual([]);
  });
  it("returns null on schema mismatch (caller retries later)", () => {
    expect(parseActions({ deadlines: [] }, posted)).toBeNull();
  });
});

describe("createCompatActionExtractor", () => {
  it("sends the posted date as reference and returns parsed actions", async () => {
    const fetchFn = vi.fn(async () =>
      chat('{"found":true,"actions":[{"title":"Lab closes","due_at":"2026-08-17T23:59:00+08:00","evidence":"open till 23:59 tonight"}]}'));
    const out = await createCompatActionExtractor(cfg, fetchFn as never)(ann);
    expect(out).toEqual([{ title: "Lab closes", dueAt: Date.parse("2026-08-17T23:59:00+08:00"), evidence: "open till 23:59 tonight" }]);
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1].content).toContain("2026-08-17");
  });
  it("returns [] when nothing is found (item is done forever)", async () => {
    const fetchFn = vi.fn(async () => chat('{"found":false,"actions":[]}'));
    expect(await createCompatActionExtractor(cfg, fetchFn as never)(ann)).toEqual([]);
  });
  it("returns null on HTTP failure (retry later)", async () => {
    const fetchFn = vi.fn(async () => new Response("x", { status: 500 }));
    expect(await createCompatActionExtractor(cfg, fetchFn as never)(ann)).toBeNull();
  });
  it("returns null on non-JSON model output (retry later)", async () => {
    const fetchFn = vi.fn(async () => chat("I could not find any."));
    expect(await createCompatActionExtractor(cfg, fetchFn as never)(ann)).toBeNull();
  });
});

describe("isDuplicateAction", () => {
  const quiz = { title: "In-person quiz", dueAt: Date.parse("2026-08-20T18:30:00+08:00") };
  it("flags an existing same-module item due within 48h sharing a distinctive word", () => {
    expect(isDuplicateAction(quiz, [{ title: "Quiz 4", dueAt: Date.parse("2026-08-20T23:59:00+08:00") }])).toBe(true);
  });
  it("allows items sharing a word but far apart in time", () => {
    expect(isDuplicateAction(quiz, [{ title: "Quiz 5", dueAt: Date.parse("2026-09-20T18:30:00+08:00") }])).toBe(false);
  });
  it("allows items close in time with no shared distinctive word", () => {
    expect(isDuplicateAction(quiz, [{ title: "Essay draft", dueAt: Date.parse("2026-08-20T20:00:00+08:00") }])).toBe(false);
  });
  it("ignores existing items without a due date", () => {
    expect(isDuplicateAction(quiz, [{ title: "Quiz admin", dueAt: null }])).toBe(false);
  });
});
