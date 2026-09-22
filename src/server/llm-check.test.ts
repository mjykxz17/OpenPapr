import { describe, expect, it } from "vitest";
import { checkLlmProvider } from "./llm-check";

const cfg = { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k" };
const reply = (status: number, body: unknown) =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("checkLlmProvider", () => {
  it("passes on a 200 even with no text", async () => {
    expect(await checkLlmProvider(cfg, reply(200, { choices: [{ message: { content: "" } }] }))).toEqual({ ok: true });
  });
  it("explains a rejected key with the provider's message", async () => {
    const r = await checkLlmProvider(cfg, reply(401, { error: { message: "Incorrect API key provided" } }));
    expect(r).toEqual({ ok: false, error: "The provider rejected that key: Incorrect API key provided" });
  });
  it("points at the model name on a 404", async () => {
    const r = await checkLlmProvider(cfg, reply(404, "not found"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/model name/);
  });
  it("reports an unreachable host", async () => {
    const fail = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await checkLlmProvider(cfg, fail)).toEqual({ ok: false, error: "could not reach that base URL" });
  });
  it("sends the key as a bearer token to chat/completions", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await checkLlmProvider({ ...cfg, baseUrl: "https://api.example.com/v1/" }, spy);
    expect(seen).toEqual({ url: "https://api.example.com/v1/chat/completions", auth: "Bearer k" });
  });
});
