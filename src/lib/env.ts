import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_PATH: z.string().default("data/openpapr.db"),
  SECRET_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "SECRET_KEY must be 64 hex chars (openssl rand -hex 32)"),
  APP_PASSWORD: z.string().min(8),
  CANVAS_BASE_URL: z.string().url().default("https://canvas.nus.edu.sg"),
  MS_CLIENT_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),
  OPENAI_COMPAT_BASE_URL: z.string().url().optional(),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
  OPENAI_COMPAT_MODEL: z.string().default("agnes-2.5-flash"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(raw);
}
