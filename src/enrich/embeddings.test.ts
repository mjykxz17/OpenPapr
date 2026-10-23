import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { embedTexts, resetEmbeddingHealth } from "./embeddings";
import { setAddressLookup } from "../lib/llm-address";

const cfg = { baseUrl: "https://emb.test/v1", apiKey: "k", model: "m" };
const vectors = (n: number) => new Response(JSON.stringify({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: [3, 4] })) }), { status: 200 });

describe("embedTexts", () => {
  beforeEach(() => resetEmbeddingHealth());
  afterEach(() => setAddressLookup(null));

  it("refuses redirects", async () => {
    let redirect: RequestRedirect | undefined;
    const f = (async (_url: string, init: RequestInit) => { redirect = init.redirect; return vectors(1); }) as unknown as typeof fetch;
    const [v] = await embedTexts(cfg, "e", ["x"], f);
    expect(redirect).toBe("error");
    expect(v![0]).toBeCloseTo(0.6);
    expect(v![1]).toBeCloseTo(0.8);
  });

  it("refuses a student's URL that resolves to a private address, without sending anything", async () => {
    setAddressLookup(async () => [{ address: "fdaa:0:1::3" }]);
    let called = false;
    const f = (async () => { called = true; return vectors(1); }) as unknown as typeof fetch;
    await expect(embedTexts({ ...cfg, vetAddress: true }, "e", ["x"], f)).rejects.toThrow("embeddings blocked: that base URL points at a private network address");
    expect(called).toBe(false);
  });

  it("keeps the provider's JSON error message but never a raw body", async () => {
    const json = (async () => new Response(JSON.stringify({ error: { message: "no such model" } }), { status: 404 })) as unknown as typeof fetch;
    await expect(embedTexts(cfg, "e", ["x"], json)).rejects.toThrow("embeddings 404: no such model");
    const html = (async () => new Response("<html>secret internal page</html>", { status: 502 })) as unknown as typeof fetch;
    const err = await embedTexts(cfg, "e", ["x"], html).catch((e: Error) => e);
    expect((err as Error).message).toBe("embeddings 502");
  });
});
