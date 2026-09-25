import type { CompatConfig } from "@/enrich/openai-compat";
import { requestBody, requestHeaders, tokenParams } from "@/lib/llm-provider";

export type LlmCheck = { ok: true } | { ok: false; error: string };

function providerMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === "string" ? j.error : j.error?.message ?? j.message;
    if (m) return m.slice(0, 240);
  } catch { /* not JSON */ }
  return body.replace(/\s+/g, " ").trim().slice(0, 240);
}

// One tiny completion, shaped exactly like the worker's real calls, so a key
// that passes here is a key the study-guide generator can use. A 200 is the
// pass mark: reasoning models may spend a small budget thinking and return no
// text, which says nothing about the key.
export async function checkLlmProvider(cfg: CompatConfig, fetchFn: typeof fetch = fetch): Promise<LlmCheck> {
  let res: Response;
  try {
    res = await fetchFn(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: requestHeaders(cfg),
      body: JSON.stringify(requestBody(cfg, tokenParams(cfg.baseUrl, 64), [{ role: "user", content: "Reply with the single word OK." }])),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    return { ok: false, error: timeout ? "the provider did not answer within 20 seconds" : "could not reach that base URL" };
  }
  if (res.ok) return { ok: true };
  const detail = providerMessage(await res.text().catch(() => ""));
  const lead =
    res.status === 401 || res.status === 403 ? "The provider rejected that key"
    : res.status === 404 ? "Endpoint or model not found — check the base URL and model name"
    : res.status === 429 ? "The key works but is rate-limited or out of credit"
    : res.status === 400 ? "The provider refused the request — often a wrong model name"
    : `The provider answered ${res.status}`;
  return { ok: false, error: detail ? `${lead}: ${detail}` : lead };
}
