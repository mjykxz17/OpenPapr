import { describe, expect, it } from "vitest";
import { encrypt } from "./crypto";
import { checkBaseUrl, presetFor, providerDetail, secretHint, sharedLlmConfig, tokenParams, userLlmConfig } from "./llm-provider";

const KEY = "0".repeat(64);

describe("checkBaseUrl", () => {
  it("accepts a provider URL and trims the trailing slash", () => {
    expect(checkBaseUrl("https://api.openai.com/v1/")).toEqual({ ok: true, url: "https://api.openai.com/v1" });
  });
  it("drops query and fragment", () => {
    expect(checkBaseUrl("https://openrouter.ai/api/v1?x=1#y")).toEqual({ ok: true, url: "https://openrouter.ai/api/v1" });
  });
  it.each([
    "http://api.openai.com/v1",
    "https://localhost:3000/v1",
    "https://127.0.0.1/v1",
    "https://10.0.0.4/v1",
    "https://192.168.1.2/v1",
    "https://172.20.0.1/v1",
    "https://169.254.169.254/latest",
    "https://openpapr.internal/v1",
    "https://[::1]/v1",
    "https://[fdaa::3]/v1",
    "https://[::ffff:10.0.0.1]/v1",
    "https://[::ffff:7f00:1]/v1",
    "https://100.64.0.1/v1",
    "https://2130706433/v1",
    "https://ollama.local/v1",
    "https://user:pw@api.openai.com/v1",
    "not a url",
  ])("refuses %s", (raw) => {
    expect(checkBaseUrl(raw, false).ok).toBe(false);
  });
  it("lets a self-hoster who opted in use a local model over plain HTTP", () => {
    expect(checkBaseUrl("http://localhost:11434/v1/", true)).toEqual({ ok: true, url: "http://localhost:11434/v1" });
    expect(checkBaseUrl("https://10.0.0.4/v1", true).ok).toBe(true);
    expect(checkBaseUrl("ftp://10.0.0.4/v1", true).ok).toBe(false);
  });
});

describe("providerDetail", () => {
  it("keeps an OpenAI-style error message, clipped", () => {
    expect(providerDetail(JSON.stringify({ error: { message: "Incorrect   API key\nprovided" } }))).toBe("Incorrect API key provided");
    expect(providerDetail(JSON.stringify({ error: "model not found" }))).toBe("model not found");
    expect(providerDetail(JSON.stringify({ error: { message: "x".repeat(500) } }))).toHaveLength(160);
  });
  it("never echoes a raw body", () => {
    expect(providerDetail("<html><body>internal admin page</body></html>")).toBe("");
    expect(providerDetail("secret-token=abc123")).toBe("");
    expect(providerDetail(JSON.stringify({ error: { message: { nested: "object" } } }))).toBe("");
  });
});

describe("secretHint", () => {
  it("shows only the last four characters", () => {
    expect(secretHint("sk-abcdefghijklmnop1234")).toBe("••••1234");
  });
  it("hides a short secret entirely", () => {
    expect(secretHint("abcd")).toBe("••••");
  });
});

describe("presetFor", () => {
  it("recognises a preset base URL with or without a trailing slash", () => {
    expect(presetFor("https://api.anthropic.com/v1/")).toBe("anthropic");
    expect(presetFor("https://example.com/v1")).toBe("custom");
    expect(presetFor(null)).toBe("custom");
  });
});

describe("userLlmConfig", () => {
  it("decrypts a saved provider, marked for an address check on every call", () => {
    const row = { llmBaseUrl: "https://api.openai.com/v1", llmModel: "m", llmKeyEnc: encrypt("sk-1", KEY) };
    expect(userLlmConfig(row, KEY)).toEqual({ baseUrl: "https://api.openai.com/v1", model: "m", apiKey: "sk-1", rpm: null, extra: null, vetAddress: true });
  });
  it("is null when any part is missing", () => {
    expect(userLlmConfig({ llmBaseUrl: "https://x.dev", llmModel: null, llmKeyEnc: encrypt("k", KEY) }, KEY)).toBeNull();
  });
  it("is null when the key cannot be decrypted", () => {
    const row = { llmBaseUrl: "https://x.dev", llmModel: "m", llmKeyEnc: encrypt("k", KEY) };
    expect(userLlmConfig(row, "1".repeat(64))).toBeNull();
  });
});

describe("sharedLlmConfig", () => {
  it("needs both the URL and the key", () => {
    expect(sharedLlmConfig({ OPENAI_COMPAT_MODEL: "m", OPENAI_COMPAT_BASE_URL: "https://x.dev" })).toBeNull();
    expect(sharedLlmConfig({ OPENAI_COMPAT_MODEL: "m", OPENAI_COMPAT_BASE_URL: "https://x.dev", OPENAI_COMPAT_API_KEY: "k" }))
      .toEqual({ baseUrl: "https://x.dev", apiKey: "k", model: "m", rpm: null, embedModel: null });
  });
});

describe("tokenParams", () => {
  it("uses max_completion_tokens and no temperature for OpenAI itself", () => {
    expect(tokenParams("https://api.openai.com/v1", 100, 0.3)).toEqual({ max_completion_tokens: 100 });
  });
  it("keeps max_tokens and temperature everywhere else", () => {
    expect(tokenParams("https://openrouter.ai/api/v1", 100, 0.3)).toEqual({ max_tokens: 100, temperature: 0.3 });
    expect(tokenParams("https://api.anthropic.com/v1", 100)).toEqual({ max_tokens: 100 });
  });
});

import { parseExtra as _parseExtra, requestBody as _requestBody, requestHeaders as _requestHeaders } from "./llm-provider";
describe("extra request options", () => {
  it("accepts a JSON object and refuses fields the app sets", () => {
    expect(_parseExtra("")).toEqual({ ok: true, value: null });
    expect(_parseExtra('{"reasoning":{"effort":"low"}}')).toEqual({ ok: true, value: { reasoning: { effort: "low" } } });
    expect(_parseExtra("[1]").ok).toBe(false);
    expect(_parseExtra("{nope").ok).toBe(false);
    const r = _parseExtra('{"model":"x","max_tokens":5}');
    expect(r.ok === false && r.error).toMatch(/model, max_tokens/);
  });
  it("adds fields without overriding the app's", () => {
    expect(_requestBody({ model: "m", extra: { top_p: 0.9, temperature: 1 } }, { max_tokens: 10, temperature: 0.2 }, [{ role: "user" }]))
      .toEqual({ top_p: 0.9, temperature: 0.2, model: "m", max_tokens: 10, messages: [{ role: "user" }] });
  });
  it("names the app to OpenRouter only", () => {
    expect(_requestHeaders({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" })["X-Title"]).toBe("OpenPapr");
    expect(_requestHeaders({ baseUrl: "https://api.openai.com/v1", apiKey: "k" })["X-Title"]).toBeUndefined();
  });
});
