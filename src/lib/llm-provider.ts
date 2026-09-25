import { decrypt } from "./crypto";
import type { CompatConfig } from "../enrich/openai-compat";

export { LLM_PRESETS, presetFor } from "./llm-presets";

// The server sends the key to whatever URL is stored, so the URL is checked
// before anything is saved: HTTPS only, and never an address that resolves
// inside the deployment's own network. Hostname checks cannot stop DNS that
// points a public name at a private address, but they stop the obvious cases
// and keep a typo from shipping a key over plain HTTP.
export function checkBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "that base URL is not a valid address" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "the base URL must start with https://" };
  if (u.username || u.password) return { ok: false, error: "put the key in the key field, not in the URL" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost =
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")
    || /^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
    || host === "::1" || host === "::" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
  if (privateHost) return { ok: false, error: "that base URL points at a private network address" };
  u.search = "";
  u.hash = "";
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
}

// Enough of a secret to recognise it, never enough to use it.
export function secretHint(secret: string): string {
  const s = secret.trim();
  return s.length <= 8 ? "••••" : `••••${s.slice(-4)}`;
}

type UserLlmColumns = {
  llmBaseUrl: string | null; llmModel: string | null; llmKeyEnc: string | null; llmRpm?: number | null;
  llmFallbackBaseUrl?: string | null; llmFallbackModel?: string | null; llmFallbackKeyEnc?: string | null; llmFallbackRpm?: number | null;
  llmExtraJson?: string | null; llmFallbackExtraJson?: string | null;
};

// --- extra request options ----------------------------------------------------
// A JSON object merged into every request body. It can add fields (OpenRouter's
// provider routing, reasoning effort, top_p…) but never replace the ones the
// app sets for each call.
const RESERVED = new Set(["model", "messages", "stream", "max_tokens", "max_completion_tokens", "n", "tools", "tool_choice", "response_format"]);
export const EXTRA_MAX_CHARS = 2000;
export function parseExtra(text: string | null | undefined): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  const t = (text ?? "").trim();
  if (!t) return { ok: true, value: null };
  if (t.length > EXTRA_MAX_CHARS) return { ok: false, error: `extra options are limited to ${EXTRA_MAX_CHARS} characters` };
  let v: unknown;
  try { v = JSON.parse(t); } catch { return { ok: false, error: "extra options must be valid JSON, like {\"reasoning\": {\"effort\": \"low\"}}" }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "extra options must be a JSON object" };
  const bad = Object.keys(v).filter((k) => RESERVED.has(k));
  if (bad.length) return { ok: false, error: `OpenPapr sets ${bad.join(", ")} itself — leave ${bad.length > 1 ? "them" : "it"} out` };
  return { ok: true, value: v as Record<string, unknown> };
}

export function requestBody(cfg: { model: string; extra?: Record<string, unknown> | null }, params: Record<string, number>, messages: unknown[]): Record<string, unknown> {
  return { ...(cfg.extra ?? {}), model: cfg.model, ...params, messages };
}

// OpenRouter shows which app sent a request when these are present.
export function requestHeaders(cfg: { baseUrl: string; apiKey: string }): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" };
  try {
    if (new URL(cfg.baseUrl).hostname.endsWith("openrouter.ai")) { h["HTTP-Referer"] = "https://openpapr.fly.dev"; h["X-Title"] = "OpenPapr"; }
  } catch { /* checked elsewhere */ }
  return h;
}

function provider(baseUrl: string | null | undefined, model: string | null | undefined, keyEnc: string | null | undefined, rpm: number | null | undefined, secretHex: string, extraJson?: string | null): CompatConfig | null {
  if (!baseUrl || !model || !keyEnc) return null;
  try {
    const extra = parseExtra(extraJson);
    return { baseUrl, model, apiKey: decrypt(keyEnc, secretHex), rpm: rpm ?? null, extra: extra.ok ? extra.value : null };
  } catch {
    return null;
  }
}

// The student's own provider with its fallback attached, or null when they
// have not set one (or it can no longer be decrypted, which only happens if
// SECRET_KEY was rotated). A fallback without a primary stands in as primary.
export function userLlmConfig(user: UserLlmColumns, secretHex: string): CompatConfig | null {
  const primary = provider(user.llmBaseUrl, user.llmModel, user.llmKeyEnc, user.llmRpm, secretHex, user.llmExtraJson);
  const fallback = provider(user.llmFallbackBaseUrl, user.llmFallbackModel, user.llmFallbackKeyEnc, user.llmFallbackRpm, secretHex, user.llmFallbackExtraJson);
  if (!primary) return fallback;
  return fallback ? { ...primary, fallback } : primary;
}

// Just one slot, for the account page and for "leave the key blank to keep".
export function userLlmSlot(user: UserLlmColumns, slot: "primary" | "fallback", secretHex: string): CompatConfig | null {
  return slot === "primary"
    ? provider(user.llmBaseUrl, user.llmModel, user.llmKeyEnc, user.llmRpm, secretHex, user.llmExtraJson)
    : provider(user.llmFallbackBaseUrl, user.llmFallbackModel, user.llmFallbackKeyEnc, user.llmFallbackRpm, secretHex, user.llmFallbackExtraJson);
}

type SharedLlmEnv = { OPENAI_COMPAT_BASE_URL?: string; OPENAI_COMPAT_API_KEY?: string; OPENAI_COMPAT_MODEL: string; OPENAI_COMPAT_RPM?: number };

export function sharedLlmConfig(env: SharedLlmEnv): CompatConfig | null {
  return env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_API_KEY
    ? { baseUrl: env.OPENAI_COMPAT_BASE_URL, apiKey: env.OPENAI_COMPAT_API_KEY, model: env.OPENAI_COMPAT_MODEL, rpm: env.OPENAI_COMPAT_RPM ?? null }
    : null;
}

export const RPM_MAX = 100_000;

// OpenAI's newer models refuse max_tokens and any non-default temperature;
// everyone else still expects max_tokens. Only OpenAI's own host gets the
// newer spelling — gateways that proxy OpenAI translate it themselves.
export function tokenParams(baseUrl: string, maxTokens: number, temperature?: number): Record<string, number> {
  let host = "";
  try { host = new URL(baseUrl).hostname; } catch { /* leave empty */ }
  if (host === "api.openai.com") return { max_completion_tokens: maxTokens };
  return temperature === undefined ? { max_tokens: maxTokens } : { max_tokens: maxTokens, temperature };
}
