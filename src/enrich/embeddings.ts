import type { CompatConfig } from "./openai-compat";
import { requestHeaders } from "../lib/llm-provider";

// Embeddings for "ask your material": text in, a unit-length vector out, from
// the same provider the student's chat goes to. Only the primary provider is
// used, since vectors from two models cannot be compared. A provider without
// embeddings is remembered for a while and the app falls back to word search.

const DEFAULTS: Record<string, string> = {
  "api.openai.com": "text-embedding-3-small",
  "openrouter.ai": "openai/text-embedding-3-small",
  "api.mistral.ai": "mistral-embed",
  "api.together.xyz": "BAAI/bge-base-en-v1.5",
};

export function embedModelFor(cfg: CompatConfig | null): string | null {
  if (!cfg) return null;
  if (cfg.embedModel) return cfg.embedModel;
  try { return DEFAULTS[new URL(cfg.baseUrl).hostname] ?? null; } catch { return null; }
}

const unavailable = new Map<string, number>();
const key = (cfg: CompatConfig, model: string) => `${cfg.baseUrl}|${model}`;
const RETRY_AFTER = 6 * 3_600_000;
export function embeddingsUsable(cfg: CompatConfig | null, now = Date.now()): string | null {
  const model = embedModelFor(cfg);
  if (!cfg || !model) return null;
  return (unavailable.get(key(cfg, model)) ?? 0) > now ? null : model;
}
export function resetEmbeddingHealth(): void { unavailable.clear(); }

export function normalize(v: number[] | Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  const len = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / len;
  return out;
}

export const toBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b: Buffer | Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// Embeds up to a batch of texts. Throws when the provider refuses; a 4xx
// marks it as having no embeddings for a few hours.
export async function embedTexts(cfg: CompatConfig, model: string, texts: string[], fetchFn: typeof fetch = fetch): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const res = await fetchFn(`${cfg.baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: requestHeaders(cfg),
    body: JSON.stringify({ model, input: texts.map((t) => t.slice(0, 6000)) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500 && res.status !== 429) unavailable.set(key(cfg, model), Date.now() + RETRY_AFTER);
    throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const data = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
  const rows = (data.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (rows.length !== texts.length || rows.some((r) => !Array.isArray(r.embedding) || !r.embedding.length)) {
    unavailable.set(key(cfg, model), Date.now() + RETRY_AFTER);
    throw new Error("embeddings: unexpected response");
  }
  return rows.map((r) => normalize(r.embedding!));
}
