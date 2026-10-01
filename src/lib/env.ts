import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_PATH: z.string().default("data/openpapr.db"),
  // Encrypts stored credentials (Canvas + Microsoft tokens). Rotating this
  // makes every stored token undecryptable, so it is effectively permanent.
  SECRET_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "SECRET_KEY must be 64 hex chars (openssl rand -hex 32)"),
  // Signs session cookies. Separate from SECRET_KEY so sessions can be revoked
  // — rotate this and everyone is signed out, with stored credentials intact.
  // Falls back to SECRET_KEY when unset, which keeps older deployments working
  // but means revocation would also break credentials; set it in production.
  SESSION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "SESSION_KEY must be 64 hex chars (openssl rand -hex 32)").optional(),
  APP_PASSWORD: z.string().min(8),
  CANVAS_BASE_URL: z.string().url().default("https://canvas.nus.edu.sg"),
  MS_CLIENT_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),
  OPENAI_COMPAT_BASE_URL: z.string().url().optional(),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
  OPENAI_COMPAT_MODEL: z.string().default("agnes-2.5-flash"),
  // Requests per minute allowed on the shared key; unset = no cap.
  OPENAI_COMPAT_RPM: z.coerce.number().int().positive().optional(),
  // Embedding model on the shared provider, for "ask your material". Unset:
  // a known default for the host if there is one, else word search alone.
  EMBED_MODEL: z.string().optional(),
  // The public demo account: on unless set to "0"; whose AI key it borrows
  // (a user id; that person's own key, else the shared one); and how many AI
  // calls it may make a day, across every visitor.
  DEMO_ENABLED: z.string().optional(),
  DEMO_AI_USER: z.coerce.number().int().positive().default(1),
  DEMO_DAILY_CALLS: z.coerce.number().int().nonnegative().default(150),
  // AI calls a month each student may make on the shared key before the
  // app asks them for their own. Their own key is never limited.
  SHARED_MONTHLY_CALLS: z.coerce.number().int().nonnegative().default(300),
  // Public API key for reading NUSMods review comments from Disqus. Optional:
  // without it module profiles are built without student reviews.
  DISQUS_API_KEY: z.string().optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(raw);
}

// The key that signs and verifies session cookies. Kept distinct from the
// credential-encryption key so the two can be rotated independently.
export function sessionSigningKey(env: Pick<Env, "SECRET_KEY" | "SESSION_KEY">): string {
  return env.SESSION_KEY ?? env.SECRET_KEY;
}
