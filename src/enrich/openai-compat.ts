import { z } from "zod";
import type { LlmScore } from "./llm";
import type { ExtractedComponent, WeightageSourceText } from "./weightage";
import { createHash } from "node:crypto";
import { tokenParams } from "../lib/llm-provider";
import { gateFor } from "../lib/rate-gate";

// OpenAI-compatible provider (Agnes agrouter). Same contracts as ./llm and
// ./weightage, but JSON is requested in the prompt and validated with zod —
// no server-side structured outputs. Both functions stay fail-open.

export interface CompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  // Requests per minute allowed on this key; calls beyond it queue.
  rpm?: number | null;
  // Tried when this provider fails.
  fallback?: CompatConfig | null;
}

const EmailScore = z.object({ important: z.boolean(), score: z.number(), reason: z.string() });
const WeightageResult = z.object({
  found: z.boolean(),
  components: z.array(z.object({ name: z.string(), weight_pct: z.number(), evidence: z.string() })),
});

export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

type Message = { role: "system" | "user"; content: string };

const gateKey = (cfg: CompatConfig) => createHash("sha256").update(`${cfg.baseUrl}\n${cfg.apiKey}`).digest("hex").slice(0, 24);

// Seconds from a Retry-After header, if it asks for a short wait.
function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const s = Number(h);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(h) - Date.now();
  return ms >= 0 && ms <= 60_000 ? ms : null;
}

async function callOnce(cfg: CompatConfig, messages: Message[], params: Record<string, number>, timeoutMs: number, fetchFn: typeof fetch): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await gateFor(gateKey(cfg), cfg.rpm).acquire();
    const res = await fetchFn(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, ...params, messages }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Rate-limited or briefly overloaded, with a short wait suggested: wait
    // once and try the same provider again before giving up on it.
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      const wait = retryAfterMs(res) ?? (res.status === 429 ? 5_000 : null);
      if (wait !== null) { await res.body?.cancel().catch(() => {}); await new Promise((r) => setTimeout(r, wait)); continue; }
    }
    if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

// A provider that has just failed several times in a row is skipped for a
// few minutes while a fallback exists, instead of costing every call a
// failed round trip (and its share of the RPM budget) first.
const BREAK_AFTER = 3;
const BREAK_MS = 3 * 60_000;
const health = new Map<string, { fails: number; until: number }>();
const isBroken = (key: string, now: number) => (health.get(key)?.until ?? 0) > now;
function recordResult(key: string, ok: boolean, now: number): void {
  if (ok) { health.delete(key); return; }
  const h = health.get(key) ?? { fails: 0, until: 0 };
  h.fails++;
  if (h.fails >= BREAK_AFTER) { h.until = now + BREAK_MS; h.fails = 0; }
  health.set(key, h);
}
export function resetProviderHealth(): void { health.clear(); }

// Which models actually answered for a config — the fallback's, when it
// stood in — so a guide can say what really wrote it.
const served = new Map<string, Set<string>>();
export function startServedLog(cfg: CompatConfig): void { served.set(gateKey(cfg), new Set()); }
export function modelsServed(cfg: CompatConfig): string[] { return [...(served.get(gateKey(cfg)) ?? [])]; }

// One completion: the student's provider, then their fallback if it fails
// (any failure — down, timed out, out of credit, key revoked). The error that
// reaches the caller names both when both fail.
export async function complete(
  cfg: CompatConfig, messages: Message[],
  opts: { maxTokens: number; temperature?: number; timeoutMs: number; fetchFn?: typeof fetch },
): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;
  const chain: CompatConfig[] = [cfg, ...(cfg.fallback ? [cfg.fallback] : [])];
  const errors: string[] = [];
  for (const [i, p] of chain.entries()) {
    const key = gateKey(p);
    const last = i === chain.length - 1;
    if (!last && isBroken(key, Date.now())) { errors.push("primary: skipped after repeated failures"); continue; }
    try {
      const out = await callOnce(p, messages, tokenParams(p.baseUrl, opts.maxTokens, opts.temperature), opts.timeoutMs, fetchFn);
      recordResult(key, true, Date.now());
      served.get(gateKey(cfg))?.add(p.model);
      return out;
    } catch (err) {
      recordResult(key, false, Date.now());
      const msg = String(err instanceof Error ? err.message : err);
      errors.push(chain.length > 1 ? `${i === 0 ? "primary" : "fallback"}: ${msg}` : msg);
    }
  }
  throw new Error(errors.join(" | "));
}

export async function chatJson(cfg: CompatConfig, fetchFn: typeof fetch, system: string, user: string, maxTokens: number, timeoutMs = 180_000): Promise<unknown | null> {
  const text = await complete(cfg, [{ role: "system", content: system }, { role: "user", content: user }], { maxTokens, timeoutMs, fetchFn });
  return extractJson(text);
}

// Prose completion, for generated long-form content. chatJson is the wrong
// shape for a study guide: it hunts for the first { and last } and would
// mangle markdown. Carries a timeout because the shared client has none and a
// stalled generation would otherwise hang a script indefinitely.
export async function chatText(
  cfg: CompatConfig,
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<string> {
  const { maxTokens = 20_000, temperature = 0.3, timeoutMs = 600_000, fetchFn = fetch } = opts;
  return complete(cfg, [{ role: "system", content: system }, { role: "user", content: user }], { maxTokens, temperature, timeoutMs, fetchFn });
}

const SCORER_SYSTEM = `You triage university email for an NUS undergraduate. Important: anything from professors or the university that affects their modules, grades, deadlines, exams, or enrolment. Garbage: newsletters, event promotion, mass CC blasts, vendor marketing. Reply with ONLY a JSON object, no prose, no code fences: {"important": boolean, "score": number 0..1 (1 = must see today), "reason": "one short line a student can read at a glance"}`;

export function createCompatScorer(cfg: CompatConfig, fetchFn: typeof fetch = fetch) {
  return async (mail: { sender: string | null; title: string; body: string | null }): Promise<LlmScore> => {
    try {
      const raw = await chatJson(cfg, fetchFn, SCORER_SYSTEM,
        `From: ${mail.sender ?? "unknown"}\nSubject: ${mail.title}\n\n${(mail.body ?? "").slice(0, 2000)}`, 1024);
      const parsed = EmailScore.safeParse(raw);
      if (!parsed.success) return { triage: "unscored", importance: null, reason: "llm unavailable" };
      const { score, reason } = parsed.data;
      const triage = score >= 0.6 ? "important" : score <= 0.2 ? "garbage" : "ambiguous";
      return { triage, importance: score, reason };
    } catch {
      return { triage: "unscored", importance: null, reason: "llm unavailable" };
    }
  };
}

const WEIGHTAGE_SYSTEM = `You extract assessment component weightage from university course materials. Report only weightings explicitly stated in the sources, quoting the exact sentence as evidence. If the sources present more than one alternative breakdown (e.g. a current scheme and one marked preliminary, tentative, or to-be-discussed), extract ONLY the currently-operative scheme — one scheme, summing to roughly 100 — and ignore the alternatives entirely. If the sources do not state a complete weightage breakdown, set found=false and return no components — never guess or fill gaps. Reply with ONLY a JSON object, no prose, no code fences: {"found": boolean, "components": [{"name": string, "weight_pct": number, "evidence": "verbatim quote"}]}`;

export function createCompatWeightageExtractor(cfg: CompatConfig, fetchFn: typeof fetch = fetch) {
  return async (texts: WeightageSourceText[]): Promise<ExtractedComponent[] | null> => {
    if (texts.length === 0) return null;
    try {
      const raw = await chatJson(cfg, fetchFn, WEIGHTAGE_SYSTEM,
        texts.map((t) => `=== ${t.label} ===\n${t.text.slice(0, 20_000)}`).join("\n\n")
          + "\n\nExtract the assessment weightage breakdown for this module.", 2048);
      const parsed = WeightageResult.safeParse(raw);
      if (!parsed.success || !parsed.data.found || parsed.data.components.length === 0) return null;
      const sum = parsed.data.components.reduce((s, c) => s + c.weight_pct, 0);
      if (sum < 90 || sum > 110) return null;
      return parsed.data.components.map((c) => ({ name: c.name, weightPct: c.weight_pct, evidence: c.evidence }));
    } catch {
      return null;
    }
  };
}
