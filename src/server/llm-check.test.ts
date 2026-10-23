import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAddressLookup } from "@/lib/llm-address";
import { checkLlmProvider } from "./llm-check";

const cfg = { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k" };
const reply = (status: number, body: unknown) =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
const resolvesTo = (address: string) => setAddressLookup(async () => [{ address }]);

describe("checkLlmProvider", () => {
  beforeEach(() => resolvesTo("104.18.2.1"));
  afterEach(() => setAddressLookup(null));

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
  it("never echoes a body that is not a JSON error", async () => {
    const r = await checkLlmProvider(cfg, reply(500, "<html><title>Admin</title>db password: hunter2</html>"));
    expect(r).toEqual({ ok: false, error: "The provider answered 500" });
  });
  it("reports an unreachable host", async () => {
    const fail = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await checkLlmProvider(cfg, fail)).toEqual({ ok: false, error: "could not reach that base URL" });
  });
  it("refuses a name that resolves to a private address, before sending the key", async () => {
    resolvesTo("10.0.0.7");
    let called = false;
    const spy = (async () => { called = true; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await checkLlmProvider({ ...cfg, baseUrl: "https://10.0.0.7.nip.io/v1" }, spy))
      .toEqual({ ok: false, error: "that base URL points at a private network address" });
    expect(called).toBe(false);
  });
  it("sends the key as a bearer token to chat/completions, refusing redirects", async () => {
    let seen: { url: string; auth: string | null; redirect?: RequestRedirect } | null = null;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization"), redirect: init.redirect };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await checkLlmProvider({ ...cfg, baseUrl: "https://api.example.com/v1/" }, spy);
    expect(seen).toEqual({ url: "https://api.example.com/v1/chat/completions", auth: "Bearer k", redirect: "error" });
  });
});
