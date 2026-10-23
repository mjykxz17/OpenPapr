import { z } from "zod";
import type { LlmScore } from "./llm";
import type { ExtractedComponent, WeightageSourceText } from "./weightage";
import { createHash } from "node:crypto";
import { checkBaseUrlAddress } from "../lib/llm-address";
import { providerDetail, requestBody, requestHeaders, tokenParams } from "../lib/llm-provider";
import { gateFor } from "../lib/rate-gate";
import { fenceRoles } from "../lib/md-fences";

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
  // Extra request-body fields (provider routing, reasoning effort, …).
  extra?: Record<string, unknown> | null;
  // The embedding model on this provider, for "ask your material"; when
  // unset, a known default for the host is used, or word search alone.
  embedModel?: string | null;
  // Who the call is for and whose key pays, for the usage count.
  owner?: { userId: number; shared: boolean } | null;
  // Set on a URL a student typed in: its host is resolved and refused if
  // private before every call. The host's own configured URL is trusted.
  vetAddress?: boolean;
}

// Throws before any request goes out when a student's base URL now points at
// a private address.
export async function assertPublicBaseUrl(cfg: CompatConfig, label: string): Promise<void> {
  if (!cfg.vetAddress) return;
  const check = await checkBaseUrlAddress(cfg.baseUrl);
  if (!check.ok) throw new Error(`${label} blocked: ${check.error}`);
}

// Told about every successful call that has an owner; the worker and the web
// server each point it at the database.
type UsageListener = (owner: { userId: number; shared: boolean }) => void;
let usageListener: UsageListener | null = null;
export function setUsageListener(fn: UsageListener | null): void { usageListener = fn; }

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

// Content is text, or (for models that read images) text and images.
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Message = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

const gateKey = (cfg: CompatConfig) => createHash("sha256").update(`${cfg.baseUrl}\n${cfg.apiKey}`).digest("hex").slice(0, 24);

// Seconds from a Retry-After header, if it asks for a short wait.
function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const s = Number(h);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(h) - Date.now();
  return ms >= 0 && ms <= 60_000 ? ms : null;
}

const IMAGE_WORDS = /\b(image|vision|multimodal|multi-modal|image_url|content type|content part)\b/i;

// Where a provider would say it can't take images: the whole JSON error
// (its message, param or code), or the start of a plain-text body. Never an
// HTML page, whose markup mentions images for unrelated reasons (og:image,
// background-image…).
function refusalText(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: unknown } | null;
    return JSON.stringify(j?.error ?? j);
  } catch { /* not JSON */ }
  return /^\s*</.test(body) ? "" : body.slice(0, 200);
}

// The status and the provider's own error message, never its raw body. A
// 4xx that refuses images gets a fixed phrase saying so, so a caller can
// retry with text alone even when the message itself doesn't say it.
async function errorFor(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  const message = providerDetail(body);
  const refusesImages = res.status >= 400 && res.status < 500
    && !IMAGE_WORDS.test(message) && IMAGE_WORDS.test(refusalText(body));
  const hint = "image input is not supported";
  const detail = refusesImages ? (message ? `${message} (${hint})` : hint) : message;
  return detail ? `llm ${res.status}: ${detail}` : `llm ${res.status}`;
}

// Why the model stopped. "length" (OpenAI and most compatible gateways) or
// "max_tokens" (some Anthropic-style ones) means it hit the token budget —
// and on a thinking model the hidden reasoning spends that same budget, so a
// reply can stop mid-sentence or never start at all.
type Reply = { text: string; cut: boolean };
const CUT_REASONS = new Set(["length", "max_tokens"]);
const NO_BUDGET = "llm: the model ran out of its token budget before answering";
const EMPTY = "llm: the model returned an empty reply";
const CUT_JSON = "llm: the model's reply was cut off at its token budget";

// A reply that never came, or stopped at the budget — worth one more try
// where a caller retries, unlike a refused key or a dead host.
export const isNoAnswer = (err: unknown) =>
  /llm: the model(?: ran out of its token budget| returned an empty reply|'s reply was cut off)/.test(String(err instanceof Error ? err.message : err));

async function callOnce(cfg: CompatConfig, messages: Message[], params: Record<string, number>, timeoutMs: number, fetchFn: typeof fetch): Promise<Reply> {
  for (let attempt = 0; ; attempt++) {
    await assertPublicBaseUrl(cfg, "llm");
    await gateFor(gateKey(cfg), cfg.rpm).acquire();
    // A redirect could lead anywhere, the private network included, so the
    // URL that was checked is the only one ever called.
    const res = await fetchFn(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: requestHeaders(cfg),
      body: JSON.stringify(requestBody(cfg, params, messages)),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    // Rate-limited or briefly overloaded, with a short wait suggested: wait
    // once and try the same provider again before giving up on it.
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      const wait = retryAfterMs(res) ?? (res.status === 429 ? 5_000 : null);
      if (wait !== null) { await res.body?.cancel().catch(() => {}); await new Promise((r) => setTimeout(r, wait)); continue; }
    }
    if (!res.ok) throw new Error(await errorFor(res));
    const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string | null }[] };
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    const cut = CUT_REASONS.has(String(choice?.finish_reason ?? ""));
    // Nothing to show is a failure, never an empty success: it sends the
    // call on to the fallback provider and to the caller's own retries.
    if (!text.trim()) throw new Error(cut ? NO_BUDGET : EMPTY);
    return { text, cut };
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
  return (await completion(cfg, messages, opts)).text;
}

// complete(), also saying whether the reply stopped at the token budget.
async function completion(
  cfg: CompatConfig, messages: Message[],
  opts: { maxTokens: number; temperature?: number; timeoutMs: number; fetchFn?: typeof fetch },
): Promise<Reply> {
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
      if (cfg.owner) { try { usageListener?.(cfg.owner); } catch { /* counting must never fail a call */ } }
      return out;
    } catch (err) {
      recordResult(key, false, Date.now());
      const msg = String(err instanceof Error ? err.message : err);
      errors.push(chain.length > 1 ? `${i === 0 ? "primary" : "fallback"}: ${msg}` : msg);
    }
  }
  throw new Error(errors.join(" | "));
}

// JSON cut off at the budget is broken JSON, so it fails like an empty reply
// instead of coming back as null, which callers read as "the model answered
// with something unusable".
export async function chatJson(cfg: CompatConfig, fetchFn: typeof fetch, system: string, user: string | ContentPart[], maxTokens: number, timeoutMs = 180_000): Promise<unknown | null> {
  const { text, cut } = await completion(cfg, [{ role: "system", content: system }, { role: "user", content: user }], { maxTokens, timeoutMs, fetchFn });
  if (cut) throw new Error(CUT_JSON);
  return extractJson(text);
}

// An error from a provider whose model can't take images ("image input is
// not supported", "invalid content type"…), as opposed to any other failure.
export const isImageRefusal = (err: unknown) =>
  IMAGE_WORDS.test(String(err instanceof Error ? err.message : err))
  && /llm 4\d\d/.test(String(err instanceof Error ? err.message : err));

// Models that have refused an image, for the life of the process, so later
// calls go out in text alone instead of paying for a refused request first.
// Keyed by provider, key and model: another model on the same key may well
// read images.
const noImages = new Set<string>();
const imageKey = (cfg: CompatConfig) => `${gateKey(cfg)}:${cfg.model}`;
export const refusesImages = (cfg: CompatConfig) => noImages.has(imageKey(cfg));
export function rememberImageRefusal(cfg: CompatConfig): void { noImages.add(imageKey(cfg)); }
export function resetImageRefusals(): void { noImages.clear(); }

// Prose completion, for generated long-form content. chatJson is the wrong
// shape for a study guide: it hunts for the first { and last } and would
// mangle markdown. Carries a timeout because the shared client has none and a
// stalled generation would otherwise hang a script indefinitely.
//
// A reply cut off at the budget is asked for once more with twice the room.
// Still cut, it comes back trimmed to its last whole paragraph and onCut is
// told, so the caller can say so instead of storing half a sentence.
const MAX_PROSE_TOKENS = 64_000;

export async function chatText(
  cfg: CompatConfig,
  system: string,
  user: string | ContentPart[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number; fetchFn?: typeof fetch; onCut?: () => void } = {},
): Promise<string> {
  const { maxTokens = 20_000, temperature = 0.3, timeoutMs = 600_000, fetchFn = fetch } = opts;
  const messages: Message[] = [{ role: "system", content: system }, { role: "user", content: user }];
  const first = await completion(cfg, messages, { maxTokens, temperature, timeoutMs, fetchFn });
  if (!first.cut) return first.text;
  let last = first;
  const more = Math.min(maxTokens * 2, MAX_PROSE_TOKENS);
  if (more > maxTokens) {
    // A second try that fails outright still leaves the first one's text.
    last = await completion(cfg, messages, { maxTokens: more, temperature, timeoutMs, fetchFn }).catch(() => first);
    if (!last.cut) return last.text;
  }
  opts.onCut?.();
  return lastWholeParagraph(last.text);
}

// The text up to its last blank line outside a code fence, so a cut reply
// neither ends mid-sentence nor leaves a fence open. With no such line, the
// text as it came.
export function lastWholeParagraph(text: string): string {
  const lines = text.split("\n");
  const { roles } = fenceRoles(lines);
  let end = -1, seen = false;
  for (const [i, line] of lines.entries()) {
    if (roles[i] === "text" && line.trim() === "" && seen) end = i;
    if (line.trim()) seen = true;
  }
  return end === -1 ? text : lines.slice(0, end).join("\n").trimEnd();
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
