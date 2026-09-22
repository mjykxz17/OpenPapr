import type { Db } from "@/db/client";
import { getUser } from "@/db/repo";
import { loadEnv } from "@/lib/env";
import { sharedLlmConfig, userLlmConfig } from "@/lib/llm-provider";

// Whether a study guide can be generated for this user: their own provider,
// or the deployment's shared OpenAI-compatible one. Mirrors the worker's
// choice so the button is never offered for a run that is certain to fail.
export function canGenerateGuides(db: Db, userId: number): boolean {
  const env = loadEnv();
  const user = getUser(db, userId);
  return Boolean((user && userLlmConfig(user, env.SECRET_KEY)) || sharedLlmConfig(env));
}
