import { describe, expect, it, vi } from "vitest";
import { createCompatScorer, createCompatWeightageExtractor, extractJson } from "./openai-compat";

const cfg = { baseUrl: "https://agrouter.example/v1", apiKey: "sk-test", model: "agnes-2.5-flash" };
const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const mail = { sender: "prof@nus.edu.sg", title: "Midterm venue", body: "MPSH2" };

describe("extractJson", () => {
  it("parses plain JSON with leading noise", () => {
    expect(extractJson('\n\nSure: {"a":1}')).toEqual({ a: 1 });
  });
  it("parses fenced JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("returns null on garbage", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("createCompatScorer", () => {
  it("posts to chat/completions with bearer auth and the model", async () => {
    const fetchFn = vi.fn(async () => chat('{"important":true,"score":0.9,"reason":"exam"}'));
    await createCompatScorer(cfg, fetchFn as never)(mail);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agrouter.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string).model).toBe("agnes-2.5-flash");
  });
  it("maps a high score to important", async () => {
    const fetchFn = vi.fn(async () => chat('\n{"important":true,"score":0.9,"reason":"exam logistics"}'));
    expect(await createCompatScorer(cfg, fetchFn as never)(mail)).toEqual({
      triage: "important", importance: 0.9, reason: "exam logistics",
    });
  });
  it("maps a low score to garbage", async () => {
    const fetchFn = vi.fn(async () => chat('{"important":false,"score":0.1,"reason":"promo"}'));
    expect((await createCompatScorer(cfg, fetchFn as never)(mail)).triage).toBe("garbage");
  });
  it("maps mid scores to ambiguous", async () => {
    const fetchFn = vi.fn(async () => chat('{"important":false,"score":0.4,"reason":"unclear"}'));
    expect((await createCompatScorer(cfg, fetchFn as never)(mail)).triage).toBe("ambiguous");
  });
  it("fails open on HTTP errors", async () => {
    const fetchFn = vi.fn(async () => new Response("overloaded", { status: 529 }));
    expect(await createCompatScorer(cfg, fetchFn as never)(mail)).toEqual({
      triage: "unscored", importance: null, reason: "llm unavailable",
    });
  });
  it("fails open on non-JSON content", async () => {
    const fetchFn = vi.fn(async () => chat("I cannot help with that."));
    expect((await createCompatScorer(cfg, fetchFn as never)(mail)).triage).toBe("unscored");
  });
  it("fails open on schema-mismatched JSON", async () => {
    const fetchFn = vi.fn(async () => chat('{"important":"yes","score":"high"}'));
    expect((await createCompatScorer(cfg, fetchFn as never)(mail)).triage).toBe("unscored");
  });
});

describe("createCompatWeightageExtractor", () => {
  const good = '{"found":true,"components":[{"name":"Final","weight_pct":40,"evidence":"Final 40%"},{"name":"Project","weight_pct":60,"evidence":"project (60%)"}]}';
  it("returns camelCased components when weights sum to ~100", async () => {
    const fetchFn = vi.fn(async () => chat(good));
    const out = await createCompatWeightageExtractor(cfg, fetchFn as never)([{ label: "syllabus", text: "..." }]);
    expect(out).toEqual([
      { name: "Final", weightPct: 40, evidence: "Final 40%" },
      { name: "Project", weightPct: 60, evidence: "project (60%)" },
    ]);
  });
  it("returns null when the sum is far from 100", async () => {
    const bad = '{"found":true,"components":[{"name":"Final","weight_pct":40,"evidence":"x"}]}';
    const fetchFn = vi.fn(async () => chat(bad));
    expect(await createCompatWeightageExtractor(cfg, fetchFn as never)([{ label: "s", text: "x" }])).toBeNull();
  });
  it("returns null when found=false", async () => {
    const fetchFn = vi.fn(async () => chat('{"found":false,"components":[]}'));
    expect(await createCompatWeightageExtractor(cfg, fetchFn as never)([{ label: "s", text: "x" }])).toBeNull();
  });
  it("returns null with no sources without calling the LLM", async () => {
    const fetchFn = vi.fn();
    expect(await createCompatWeightageExtractor(cfg, fetchFn as never)([])).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("returns null on errors", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("boom"); });
    expect(await createCompatWeightageExtractor(cfg, fetchFn as never)([{ label: "s", text: "x" }])).toBeNull();
  });
});
