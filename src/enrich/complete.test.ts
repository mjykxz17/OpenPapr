import { describe, expect, it } from "vitest";
import { beforeEach } from "vitest";
import { complete, resetProviderHealth, type CompatConfig } from "./openai-compat";
import { userLlmConfig } from "../lib/llm-provider";
import { encrypt } from "../lib/crypto";

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
let n = 0;
const cfg = (host: string, extra: Partial<CompatConfig> = {}): CompatConfig =>
  ({ baseUrl: `https://${host}/v1`, apiKey: `k-${host}-${n++}`, model: "m", ...extra });

function recorder(handler: (host: string) => Response) {
  const calls: string[] = [];
  const f = (async (url: string) => { const host = new URL(url).hostname; calls.push(host); return handler(host); }) as unknown as typeof fetch;
  return { calls, f };
}

describe("complete", () => {
  beforeEach(() => resetProviderHealth());
  it("uses the fallback when the main provider fails", async () => {
    const { calls, f } = recorder((h) => (h === "main.test" ? new Response("down", { status: 500 }) : ok("from fallback")));
    const out = await complete(cfg("main.test", { fallback: cfg("backup.test") }), [{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 5000, fetchFn: f });
    expect(out).toBe("from fallback");
    expect(calls).toEqual(["main.test", "backup.test"]);
  });

  it("waits and retries the same provider once on 429 with Retry-After", async () => {
    let first = true;
    const { calls, f } = recorder(() => {
      if (first) { first = false; return new Response("slow down", { status: 429, headers: { "retry-after": "0" } }); }
      return ok("second try");
    });
    const out = await complete(cfg("main.test", { fallback: cfg("backup.test") }), [{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 5000, fetchFn: f });
    expect(out).toBe("second try");
    expect(calls).toEqual(["main.test", "main.test"]);
  });

  it("names both failures when both providers fail", async () => {
    const { f } = recorder((h) => new Response(h, { status: h === "main.test" ? 401 : 500 }));
    await expect(complete(cfg("main.test", { fallback: cfg("backup.test") }), [{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 5000, fetchFn: f }))
      .rejects.toThrow(/primary: llm 401.*fallback: llm 500/);
  });

  it("stops trying a provider that keeps failing, while a fallback exists", async () => {
    const { calls, f } = recorder((h) => (h === "dead.test" ? new Response("down", { status: 502 }) : ok("fine")));
    const c = cfg("dead.test", { fallback: cfg("alive.test") });
    for (let i = 0; i < 5; i++) await complete(c, [{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 5000, fetchFn: f });
    expect(calls.filter((h) => h === "dead.test")).toHaveLength(3);
    expect(calls.filter((h) => h === "alive.test")).toHaveLength(5);
  });

  it("queues calls to stay under the provider's RPM", async () => {
    // rpm 60 = one per second of window; three calls should span ~2 windows
    // of the gate. Use a tiny rpm so the queue is visible.
    const { f } = recorder(() => ok("x"));
    const c = cfg("rpm.test", { rpm: 2 });
    const t = Date.now();
    await Promise.all([1, 2].map(() => complete(c, [{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 5000, fetchFn: f })));
    expect(Date.now() - t).toBeLessThan(500); // within the cap: no waiting
  });
});

describe("userLlmConfig with a fallback", () => {
  const KEY = "0".repeat(64);
  const base = { llmBaseUrl: "https://a.test/v1", llmModel: "ma", llmKeyEnc: encrypt("ka", KEY), llmRpm: 30 };
  const fb = { llmFallbackBaseUrl: "https://b.test/v1", llmFallbackModel: "mb", llmFallbackKeyEnc: encrypt("kb", KEY), llmFallbackRpm: null };
  it("attaches the fallback and each RPM", () => {
    expect(userLlmConfig({ ...base, ...fb }, KEY)).toEqual({
      baseUrl: "https://a.test/v1", model: "ma", apiKey: "ka", rpm: 30, extra: null,
      fallback: { baseUrl: "https://b.test/v1", model: "mb", apiKey: "kb", rpm: null, extra: null },
    });
  });
  it("uses a lone fallback as the provider", () => {
    expect(userLlmConfig({ llmBaseUrl: null, llmModel: null, llmKeyEnc: null, ...fb }, KEY)).toMatchObject({ baseUrl: "https://b.test/v1" });
  });
});
