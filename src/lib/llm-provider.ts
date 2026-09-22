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

type UserLlmColumns = { llmBaseUrl: string | null; llmModel: string | null; llmKeyEnc: string | null };

// The student's own provider, or null when they have not set one (or it can
// no longer be decrypted, which only happens if SECRET_KEY was rotated).
export function userLlmConfig(user: UserLlmColumns, secretHex: string): CompatConfig | null {
  if (!user.llmBaseUrl || !user.llmModel || !user.llmKeyEnc) return null;
  try {
    return { baseUrl: user.llmBaseUrl, model: user.llmModel, apiKey: decrypt(user.llmKeyEnc, secretHex) };
  } catch {
    return null;
  }
}

type SharedLlmEnv = { OPENAI_COMPAT_BASE_URL?: string; OPENAI_COMPAT_API_KEY?: string; OPENAI_COMPAT_MODEL: string };

export function sharedLlmConfig(env: SharedLlmEnv): CompatConfig | null {
  return env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_API_KEY
    ? { baseUrl: env.OPENAI_COMPAT_BASE_URL, apiKey: env.OPENAI_COMPAT_API_KEY, model: env.OPENAI_COMPAT_MODEL }
    : null;
}

// OpenAI's newer models refuse max_tokens and any non-default temperature;
// everyone else still expects max_tokens. Only OpenAI's own host gets the
// newer spelling — gateways that proxy OpenAI translate it themselves.
export function tokenParams(baseUrl: string, maxTokens: number, temperature?: number): Record<string, number> {
  let host = "";
  try { host = new URL(baseUrl).hostname; } catch { /* leave empty */ }
  if (host === "api.openai.com") return { max_completion_tokens: maxTokens };
  return temperature === undefined ? { max_tokens: maxTokens } : { max_tokens: maxTokens, temperature };
}
