import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJson, chatText, complete, isNoAnswer, isOutOfBudget, isTimeout, jsonTimeoutMs, lastWholeParagraph,
  refusesImages, resetImageRefusals, resetProviderHealth, type CompatConfig,
} from "./openai-compat";

// A thinking model spends its hidden reasoning out of max_tokens, so a reply
// can stop at the budget with half an answer, or none.
const reply = (content: string | null, finish = "stop") =>
  Response.json({ choices: [{ message: { content, reasoning: "thinking…" }, finish_reason: finish }] });
let n = 0;
const cfg = (host: string, extra: Partial<CompatConfig> = {}): CompatConfig =>
  ({ baseUrl: `https://${host}/v1`, apiKey: `k-${host}-${n++}`, model: "m", ...extra });

// Answers in turn from the list, recording each call's host and budget.
function scripted(...replies: (() => Response)[]) {
  const calls: { host: string; maxTokens: number }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ host: new URL(url).hostname, maxTokens: JSON.parse(String(init.body)).max_tokens });
    return (replies.shift() ?? (() => reply("unexpected call")))();
  }) as unknown as typeof fetch;
  return { calls, f };
}
const ask = (c: CompatConfig, f: typeof fetch) => complete(c, [{ role: "user", content: "hi" }], { maxTokens: 300, timeoutMs: 5000, fetchFn: f });

describe("complete, when the model stops at its token budget", () => {
  beforeEach(() => resetProviderHealth());

  it("fails when the whole budget went on reasoning", async () => {
    const { f } = scripted(() => reply("", "length"));
    const err = await ask(cfg("think.test"), f).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/ran out of its token budget before answering/);
    expect(isNoAnswer(err)).toBe(true);
  });

  it("fails on a null or whitespace-only reply, whatever the finish reason", async () => {
    for (const r of [() => reply(null, "length"), () => reply("  \n ", "stop"), () => Response.json({ choices: [{ message: {} }] })]) {
      const { f } = scripted(r);
      await expect(ask(cfg("blank.test"), f)).rejects.toThrow(/llm: the model/);
    }
  });

  it("goes on to the fallback when the main provider answers with nothing", async () => {
    const { calls, f } = scripted(() => reply("", "length"), () => reply("from fallback"));
    expect(await ask(cfg("main.test", { fallback: cfg("backup.test") }), f)).toBe("from fallback");
    expect(calls.map((c) => c.host)).toEqual(["main.test", "backup.test"]);
  });

  it("still returns a cut-off reply that has text", async () => {
    const { f } = scripted(() => reply("Half an ans", "length"));
    expect(await ask(cfg("cut.test"), f)).toBe("Half an ans");
  });
});

describe("chatText, when the reply is cut off", () => {
  beforeEach(() => resetProviderHealth());
  const opts = (f: typeof fetch, onCut?: () => void) => ({ maxTokens: 8000, timeoutMs: 5000, fetchFn: f, onCut });

  it("asks again with twice the budget and uses the full reply", async () => {
    let cut = false;
    const { calls, f } = scripted(() => reply("First para.\n\nSecond, stopped mid", "length"), () => reply("First para.\n\nSecond, whole.", "stop"));
    expect(await chatText(cfg("t.test"), "sys", "user", opts(f, () => { cut = true; }))).toBe("First para.\n\nSecond, whole.");
    expect(calls.map((c) => c.maxTokens)).toEqual([8000, 16000]);
    expect(cut).toBe(false);
  });

  it("never asks for more than 64,000 tokens", async () => {
    const { calls, f } = scripted(() => reply("a\n\nb", "length"), () => reply("whole", "stop"));
    await chatText(cfg("t.test"), "sys", "user", { maxTokens: 40_000, timeoutMs: 5000, fetchFn: f });
    expect(calls.map((c) => c.maxTokens)).toEqual([40_000, 64_000]);
  });

  it("still cut: keeps the whole paragraphs and says it was cut", async () => {
    let cut = 0;
    const { calls, f } = scripted(
      () => reply("### 1.1 A\n\nOne whole paragraph.\n\nTwo, stopped", "length"),
      () => reply("### 1.1 A\n\nOne whole paragraph.\n\nTwo whole.\n\nThree, stopp", "length"),
    );
    const out = await chatText(cfg("t.test"), "sys", "user", opts(f, () => { cut++; }));
    expect(out).toBe("### 1.1 A\n\nOne whole paragraph.\n\nTwo whole.");
    expect(cut).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("keeps the first reply when the second try fails outright", async () => {
    let cut = false;
    const { f } = scripted(() => reply("Kept.\n\nLost half", "length"), () => reply("", "length"));
    expect(await chatText(cfg("t.test"), "sys", "user", opts(f, () => { cut = true; }))).toBe("Kept.");
    expect(cut).toBe(true);
  });

  it("does not retry a reply that finished", async () => {
    const { calls, f } = scripted(() => reply("Done.", "stop"));
    expect(await chatText(cfg("t.test"), "sys", "user", opts(f))).toBe("Done.");
    expect(calls).toHaveLength(1);
  });

  it("fails on an empty reply instead of returning nothing, after one try with twice the budget", async () => {
    const { calls, f } = scripted(() => reply("", "length"), () => reply("", "length"));
    await expect(chatText(cfg("t.test"), "sys", "user", opts(f))).rejects.toThrow(/ran out of its token budget/);
    expect(calls.map((c) => c.maxTokens)).toEqual([8000, 16000]);
  });

  it("asks again with twice the budget when the reasoning spent all of it", async () => {
    let cut = false;
    const { calls, f } = scripted(() => reply("", "length"), () => reply("The answer.", "stop"));
    expect(await chatText(cfg("t.test"), "sys", "user", opts(f, () => { cut = true; }))).toBe("The answer.");
    expect(calls.map((c) => c.maxTokens)).toEqual([8000, 16000]);
    expect(cut).toBe(false);
  });

  it("trims and says so when the bigger try after an empty one is cut too", async () => {
    let cut = false;
    const { f } = scripted(() => reply("", "length"), () => reply("Kept.\n\nLost half", "length"));
    expect(await chatText(cfg("t.test"), "sys", "user", opts(f, () => { cut = true; }))).toBe("Kept.");
    expect(cut).toBe(true);
  });

  it("does not ask for more after an empty reply that finished normally, or a dead host", async () => {
    for (const r of [() => reply("", "stop"), () => new Response("down", { status: 500 })]) {
      const { calls, f } = scripted(r);
      await expect(chatText(cfg("t.test"), "sys", "user", opts(f))).rejects.toThrow();
      expect(calls).toHaveLength(1);
    }
  });

  it("gives the bigger try time in step with its budget", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const { f } = scripted(() => reply("a\n\nb", "length"), () => reply("whole", "stop"));
      await chatText(cfg("t.test"), "sys", "user", { maxTokens: 8000, timeoutMs: 5000, fetchFn: f });
      expect(timeout.mock.calls.map((c) => c[0])).toEqual([5000, 10_000]);
    } finally {
      timeout.mockRestore();
    }
  });
});

describe("the provider breaker", () => {
  beforeEach(() => resetProviderHealth());

  it("does not count empty replies against a provider: the budget was short, not the provider", async () => {
    // Small budgets get all-reasoning empty replies; big ones get answers.
    const hosts: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const host = new URL(url).hostname;
      hosts.push(host);
      if (host === "backup.test") return reply("FALLBACK");
      return JSON.parse(String(init.body)).max_tokens <= 2048 ? reply("", "length") : reply("PRIMARY");
    }) as unknown as typeof fetch;
    const c = cfg("main.test", { fallback: cfg("backup.test") });
    for (let i = 0; i < 4; i++) await chatJson(c, f, "sys", "user", 1024).catch(() => null);
    hosts.length = 0;
    expect(await chatText(c, "sys", "user", { maxTokens: 16_000, timeoutMs: 5000, fetchFn: f })).toBe("PRIMARY");
    expect(hosts).toEqual(["main.test"]);
  });

  it("still skips a provider that keeps failing outright", async () => {
    const hosts: string[] = [];
    const f = (async (url: string) => {
      const host = new URL(url).hostname;
      hosts.push(host);
      return host === "backup.test" ? reply("FALLBACK") : new Response("down", { status: 500 });
    }) as unknown as typeof fetch;
    const c = cfg("main.test", { fallback: cfg("backup.test") });
    for (let i = 0; i < 3; i++) await ask(c, f);
    hosts.length = 0;
    expect(await ask(c, f)).toBe("FALLBACK");
    expect(hosts).toEqual(["backup.test"]);
  });
});

describe("an image refusal", () => {
  beforeEach(() => { resetProviderHealth(); resetImageRefusals(); });
  afterEach(() => resetImageRefusals());
  const withImage = [{ role: "user" as const, content: [{ type: "text" as const, text: "see" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,AA==" } }] }];
  const refuse = () => Response.json({ error: { message: "image input is not supported" } }, { status: 400 });

  it("is remembered for the fallback that refused, never the primary that failed for another reason", async () => {
    const main = cfg("main.test"), backup = cfg("backup.test");
    const f = (async (url: string) => (new URL(url).hostname === "main.test" ? new Response("timeout", { status: 504 }) : refuse())) as unknown as typeof fetch;
    await expect(complete({ ...main, fallback: backup }, withImage, { maxTokens: 300, timeoutMs: 5000, fetchFn: f })).rejects.toThrow(/fallback: llm 400/);
    expect(refusesImages(main)).toBe(false);
    expect(refusesImages(backup)).toBe(true);
  });

  it("is remembered for the primary when the primary refused", async () => {
    const main = cfg("main.test"), backup = cfg("backup.test");
    const f = (async (url: string) => (new URL(url).hostname === "main.test" ? refuse() : reply("ok"))) as unknown as typeof fetch;
    expect(await complete({ ...main, fallback: backup }, withImage, { maxTokens: 300, timeoutMs: 5000, fetchFn: f })).toBe("ok");
    expect(refusesImages(main)).toBe(true);
    expect(refusesImages(backup)).toBe(false);
  });

  it("is not recorded from a request that carried no image", async () => {
    const main = cfg("main.test");
    await ask(main, (async () => refuse()) as unknown as typeof fetch).catch(() => null);
    expect(refusesImages(main)).toBe(false);
  });
});

describe("telling failures apart", () => {
  it("knows a reply that ran out of budget from one that was only empty", () => {
    expect(isOutOfBudget(new Error("primary: llm: the model ran out of its token budget before answering | fallback: llm 500"))).toBe(true);
    expect(isOutOfBudget(new Error("llm: the model's reply was cut off at its token budget"))).toBe(true);
    expect(isOutOfBudget(new Error("llm: the model returned an empty reply"))).toBe(false);
  });
  it("knows a timeout", () => {
    expect(isTimeout(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(true);
    expect(isTimeout(new Error("primary: The operation was aborted due to timeout | fallback: fetch failed"))).toBe(true);
    expect(isTimeout(new Error("llm 500"))).toBe(false);
  });
  it("gives a JSON request time in step with its budget", () => {
    expect(jsonTimeoutMs(1024)).toBe(180_000);
    expect(jsonTimeoutMs(12_000)).toBe(600_000);
  });
});

describe("chatJson, when the reply is cut off", () => {
  beforeEach(() => resetProviderHealth());

  it("fails rather than returning half a JSON object", async () => {
    const { f } = scripted(() => reply('{"title": "x", "sections": [{"heading"', "length"));
    const err = await chatJson(cfg("j.test"), f, "sys", "user", 400).catch((e: Error) => e);
    expect(isNoAnswer(err)).toBe(true);
  });

  it("fails on an empty reply", async () => {
    const { f } = scripted(() => reply("", "length"));
    await expect(chatJson(cfg("j.test"), f, "sys", "user", 400)).rejects.toThrow(/token budget/);
  });

  it("still returns null for a whole reply that is not JSON", async () => {
    const { f } = scripted(() => reply("I cannot help with that.", "stop"));
    expect(await chatJson(cfg("j.test"), f, "sys", "user", 400)).toBeNull();
  });
});

describe("lastWholeParagraph", () => {
  it("cuts back to the last blank line", () => {
    expect(lastWholeParagraph("A.\n\nB.\n\nC, half")).toBe("A.\n\nB.");
  });
  it("never cuts inside a code fence, so none is left open", () => {
    expect(lastWholeParagraph("A.\n\n```\ncode\n\nmore code")).toBe("A.");
    expect(lastWholeParagraph("A.\n\n````md\n```\ninner\n```\n\nstill inside")).toBe("A.");
  });
  it("leaves text with no paragraph break as it is", () => {
    expect(lastWholeParagraph("only one paragraph, cut")).toBe("only one paragraph, cut");
  });
});
